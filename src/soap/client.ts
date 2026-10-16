import type { Env } from '../config/env.js';
import {
  parseError,
  upstreamHttp,
  upstreamNetwork,
  upstreamTimeout,
  type AppError,
} from '../domain/errors.js';
import { left, right, type Either } from '../fp/result.js';
import { withReadRetries, type BackoffPolicy } from './backoff.js';
import type { ProviderCredentials } from './credentials.js';
import { buildSoapEnvelope, SOAP_ACTIONS, type SoapOperation } from './envelope.js';

export type SoapRequestMeta = {
  readonly operation: SoapOperation;
  readonly requestId: string;
  /** When true, timeouts/5xx are AMBIGUOUS — never auto-retry. */
  readonly isWrite: boolean;
};

export type SoapClient = {
  readonly call: (
    meta: SoapRequestMeta,
    creds: ProviderCredentials,
    bodyXml: string,
  ) => Promise<Either<AppError, string>>;
};

const looksLikeHtml = (body: string): boolean =>
  /<!DOCTYPE html>/i.test(body) || /<html[\s>]/i.test(body);

export const createSoapClient = (
  env: Env,
  log: (level: 'info' | 'warn' | 'error' | 'debug', msg: string, meta?: Record<string, unknown>) => void,
): SoapClient => {
  const readPolicy: BackoffPolicy = {
    maxRetries: env.READ_MAX_RETRIES,
    baseMs: env.READ_BACKOFF_BASE_MS,
    maxMs: env.READ_BACKOFF_MAX_MS,
  };

  const once = async (
    meta: SoapRequestMeta,
    creds: ProviderCredentials,
    bodyXml: string,
  ): Promise<Either<AppError, string>> => {
    const envelope = buildSoapEnvelope(creds, bodyXml);
    const timeoutMs = meta.isWrite ? env.WRITE_TIMEOUT_MS : env.SOAP_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      log('debug', 'soap_request', {
        operation: meta.operation,
        request_id: meta.requestId,
        is_write: meta.isWrite,
        timeout_ms: timeoutMs,
      });

      const res = await fetch(env.EFACTURA_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          Accept: 'text/xml',
          'User-Agent': 'efactura-gateway/1.1',
          Connection: 'keep-alive',
          SOAPAction: SOAP_ACTIONS[meta.operation],
        },
        body: envelope,
        signal: controller.signal,
      });

      const text = await res.text();
      const durationMs = Date.now() - started;

      log('info', 'soap_response', {
        operation: meta.operation,
        request_id: meta.requestId,
        status_code: res.status,
        duration_ms: durationMs,
        is_write: meta.isWrite,
      });

      if (!res.ok) {
        return left(
          upstreamHttp(
            res.status,
            `HTTP Error: ${res.status} Response: ${text.slice(0, 500)}`,
            meta.isWrite,
          ),
        );
      }

      if (looksLikeHtml(text)) {
        return left(
          parseError('Server returned HTML error page instead of XML response'),
        );
      }

      return right(text);
    } catch (err) {
      const durationMs = Date.now() - started;
      const name = err instanceof Error ? err.name : 'Error';
      const message = err instanceof Error ? err.message : String(err);

      if (name === 'AbortError' || /aborted|timeout/i.test(message)) {
        log('error', 'soap_timeout', {
          operation: meta.operation,
          request_id: meta.requestId,
          duration_ms: durationMs,
          is_write: meta.isWrite,
        });
        return left(
          upstreamTimeout(
            `Upstream timeout after ${timeoutMs}ms (${meta.operation})`,
            meta.isWrite,
          ),
        );
      }

      log('error', 'soap_network', {
        operation: meta.operation,
        request_id: meta.requestId,
        error: message,
        is_write: meta.isWrite,
      });
      return left(upstreamNetwork(`Upstream network error: ${message}`, meta.isWrite));
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    call: async (meta, creds, bodyXml) => {
      if (meta.isWrite) {
        // Hard rule: never wrap writes in retry/backoff.
        return once(meta, creds, bodyXml);
      }
      return withReadRetries(
        meta.operation,
        readPolicy,
        () => once(meta, creds, bodyXml),
        (msg, m) => log('warn', msg, { request_id: meta.requestId, ...m }),
      );
    },
  };
};
