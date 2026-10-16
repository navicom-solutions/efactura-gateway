import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { Env } from '../config/env.js';
import { authError, notFoundError, validationError, type AppError } from '../domain/errors.js';
import {
  ActorRoleSchema,
  AssignSerialsSchema,
  errEnvelope,
  GetInvoiceSchema,
  okEnvelope,
  parseBody,
  PostInvoiceSchema,
  SearchInvoicesSchema,
  type ApiEnvelope,
} from '../domain/types.js';
import { createFeedbackSender, type FeedbackSender } from '../feedback/client.js';
import { isLeft } from '../fp/result.js';
import { registerMcpRoutes } from '../mcp/http.js';
import { buildOpenApiDocument } from './openapi.js';
import { safeEqual } from '../oauth/crypto.js';
import { registerOAuthRoutes } from '../oauth/routes.js';
import { createCredentialVerifier } from '../oauth/verify-credentials.js';
import { createOAuthStore, type OAuthStore } from '../oauth/store.js';
import { createInvoiceQueue, type InvoiceQueue } from '../queue/invoice-jobs.js';
import { parseProviderCredentialsHeader, type ProviderCredentials } from '../soap/credentials.js';
import { createSoapClient, type SoapClient } from '../soap/client.js';
import {
  createInvoiceServices,
  newRequestId,
  resolveIdempotencyKey,
  type InvoiceServices,
} from '../services/invoices.js';
import type { IdempotencyStore } from '../services/idempotency.js';

export type AppLog = (
  level: 'info' | 'warn' | 'error' | 'debug',
  msg: string,
  meta?: Record<string, unknown>,
) => void;

export type AppDeps = {
  readonly env: Env;
  readonly log: AppLog;
  /** Inject for tests; defaults to live SOAP client. */
  readonly soap?: SoapClient;
  /** Inject for tests; defaults to SQLite store at env.DATABASE_PATH. */
  readonly idempotencyStore?: IdempotencyStore;
  /** Inject for tests; defaults to SQLite store at env.OAUTH_DATABASE_PATH when MCP_ENABLED. */
  readonly oauthStore?: OAuthStore;
  /** Inject for tests (null disables); defaults to BullMQ when QUEUE_ENABLED. */
  readonly queue?: InvoiceQueue | null;
  /** Inject for tests (null disables); defaults to the relay at FEEDBACK_URL when FEEDBACK_ENABLED. */
  readonly feedback?: FeedbackSender | null;
};

const defaultFeedback = (env: Env): FeedbackSender | null =>
  env.FEEDBACK_ENABLED && env.FEEDBACK_URL
    ? createFeedbackSender({ url: env.FEEDBACK_URL, publicUrl: env.PUBLIC_URL })
    : null;

const send = (reply: FastifyReply, statusCode: number, body: ApiEnvelope) =>
  reply.status(statusCode).send(body);

const requireAuth = (env: Env, req: FastifyRequest): EitherAuth => {
  const raw = req.headers.authorization ?? '';
  const key = raw.replace(/^Bearer\s+/i, '').trim();
  if (!key || !safeEqual(key, env.API_KEY)) return { ok: false as const, err: authError() };
  return { ok: true as const };
};

type EitherAuth = { ok: true } | { ok: false; err: AppError };

const resolveCreds = (env: Env, req: FastifyRequest): ProviderCredentials => {
  const fromHeader = parseProviderCredentialsHeader(
    typeof req.headers['x-provider-credentials'] === 'string'
      ? req.headers['x-provider-credentials']
      : undefined,
  );
  if (fromHeader) return fromHeader;
  return { username: env.EFACTURA_USERNAME, password: env.EFACTURA_PASSWORD };
};

const requestIdOf = (req: FastifyRequest): string => {
  const h = req.headers['x-request-id'];
  return typeof h === 'string' && h.length > 0 ? h : newRequestId();
};

const headerString = (req: FastifyRequest, name: string): string | undefined => {
  const h = req.headers[name];
  return typeof h === 'string' ? h : undefined;
};

const API_REFERENCE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>efactura-gateway — e-Factura Moldova REST API reference</title>
<meta name="description" content="REST/JSON API and MCP server for Moldova SFS e-Factura."/></head>
<body><script id="api-reference" data-url="/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script></body></html>`;

/** RFC 7240 hint; ignored (sync post) when the queue is disabled. */
const prefersAsync = (req: FastifyRequest): boolean =>
  /\brespond-async\b/i.test(headerString(req, 'prefer') ?? '');

export const buildApp = (deps: AppDeps): { app: FastifyInstance; services: InvoiceServices } => {
  const { env, log } = deps;
  const soap = deps.soap ?? createSoapClient(env, log);
  const services = createInvoiceServices(env, soap, log, deps.idempotencyStore);
  const queue =
    deps.queue !== undefined
      ? deps.queue
      : env.QUEUE_ENABLED
        ? createInvoiceQueue(env, services, log)
        : null;
  const ownsQueue = deps.queue === undefined && queue !== null;

  const app = Fastify({
    logger: false,
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: true,
  });

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    },
  );

  if (ownsQueue) app.addHook('onClose', async () => queue?.close());

  const base = env.BASE_PATH; // e.g. /v1

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    const isHealth = path === '/health' || path === `${base}/health` || path === '/api/v1/health';
    if (isHealth) return;

    const underApi =
      (base && path.startsWith(base)) || path.startsWith('/api/v1');
    if (!underApi) return;

    const auth = requireAuth(env, req);
    if (!auth.ok) {
      return send(reply, 401, errEnvelope(requestIdOf(req), auth.err));
    }
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'api-efactura',
    public_url: env.PUBLIC_URL,
    base_path: env.BASE_PATH,
  }));

  if (base) {
    app.get(`${base}/health`, async () => ({
      ok: true,
      service: 'api-efactura',
      public_url: env.PUBLIC_URL,
      base_path: env.BASE_PATH,
    }));
  }
  const openApiDocument = buildOpenApiDocument(env);
  app.get('/openapi.json', async (_req, reply) =>
    reply.header('Access-Control-Allow-Origin', '*').send(openApiDocument),
  );
  app.get('/docs', async (_req, reply) => reply.type('text/html').send(API_REFERENCE_HTML));

  app.get('/api/v1/health', async () => ({
    ok: true,
    service: 'api-efactura',
    public_url: env.PUBLIC_URL,
    base_path: '/api/v1',
  }));

  const mountRoutes = (prefix: string) => {
    const p = (path: string) => `${prefix}${path}`;

    app.post(p('/invoices/search'), async (req, reply) => {
      const requestId = requestIdOf(req);
      const parsed = parseBody(SearchInvoicesSchema, req.body);
      if (isLeft(parsed)) return send(reply, 400, errEnvelope(requestId, parsed.left));
      const result = await services.search(parsed.right, resolveCreds(env, req), requestId);
      if (isLeft(result)) return send(reply, result.left.statusCode, errEnvelope(requestId, result.left));
      return send(reply, 200, result.right);
    });

    app.post(p('/invoices/get'), async (req, reply) => {
      const requestId = requestIdOf(req);
      const parsed = parseBody(GetInvoiceSchema, req.body);
      if (isLeft(parsed)) return send(reply, 400, errEnvelope(requestId, parsed.left));
      const result = await services.getBySeria(parsed.right, resolveCreds(env, req), requestId);
      if (isLeft(result)) return send(reply, result.left.statusCode, errEnvelope(requestId, result.left));
      return send(reply, 200, result.right);
    });

    app.post(p('/invoices/assign-serials'), async (req, reply) => {
      const requestId = requestIdOf(req);
      const parsed = parseBody(AssignSerialsSchema, req.body);
      if (isLeft(parsed)) return send(reply, 400, errEnvelope(requestId, parsed.left));
      const result = await services.assignSerials(parsed.right, resolveCreds(env, req), requestId);
      if (isLeft(result)) return send(reply, result.left.statusCode, errEnvelope(requestId, result.left));
      return send(reply, 200, result.right);
    });

    app.post(p('/invoices/new'), async (req, reply) => {
      const requestId = requestIdOf(req);
      const parsed = parseBody(PostInvoiceSchema, req.body);
      if (isLeft(parsed)) return send(reply, 400, errEnvelope(requestId, parsed.left));

      const idempotencyKey = headerString(req, 'idempotency-key');
      const confirmAbsent =
        String(req.headers['x-confirm-absent'] ?? '').toLowerCase() === 'true';

      if (queue && prefersAsync(req)) {
        const keyE = resolveIdempotencyKey(idempotencyKey, parsed.right);
        if (isLeft(keyE)) return send(reply, 400, errEnvelope(requestId, keyE.left));
        const { jobId, reused } = await queue.enqueue({
          requestId,
          idempotencyKey: keyE.right,
          confirmAbsent,
          creds: resolveCreds(env, req),
          body: parsed.right,
        });
        return send(reply, 202, {
          ...okEnvelope(requestId, [], 0, reused ? 'Already queued' : 'Queued'),
          job_id: jobId,
          code: 'QUEUED',
          retry_safe: true,
        });
      }

      const result = await services.postInvoice(
        parsed.right,
        resolveCreds(env, req),
        requestId,
        idempotencyKey,
        confirmAbsent,
      );
      return send(reply, result.statusCode, result.body);
    });

    app.post(p('/invoices/accepted'), async (req, reply) => {
      const requestId = requestIdOf(req);
      const parsed = parseBody(ActorRoleSchema, req.body);
      if (isLeft(parsed)) return send(reply, 400, errEnvelope(requestId, parsed.left));
      const result = await services.accepted(parsed.right, resolveCreds(env, req), requestId);
      if (isLeft(result)) return send(reply, result.left.statusCode, errEnvelope(requestId, result.left));
      return send(reply, 200, result.right);
    });

    app.post(p('/invoices/rejected'), async (req, reply) => {
      const requestId = requestIdOf(req);
      const parsed = parseBody(ActorRoleSchema, req.body);
      if (isLeft(parsed)) return send(reply, 400, errEnvelope(requestId, parsed.left));
      const result = await services.rejected(parsed.right, resolveCreds(env, req), requestId);
      if (isLeft(result)) return send(reply, result.left.statusCode, errEnvelope(requestId, result.left));
      return send(reply, 200, result.right);
    });

    app.get(p('/taxpayer/:idno'), async (req, reply) => {
      const requestId = requestIdOf(req);
      const idno = (req.params as { idno?: string }).idno ?? '';
      if (!idno) {
        return send(reply, 400, errEnvelope(requestId, validationError('IDNO is required.')));
      }
      const result = await services.taxpayer(idno, resolveCreds(env, req), requestId);
      return send(reply, result.statusCode, result.body);
    });

    app.get(p('/jobs/:id'), async (req, reply) => {
      const requestId = requestIdOf(req);
      const id = (req.params as { id?: string }).id ?? '';
      const job = queue ? await queue.get(id) : null;
      if (!job) return send(reply, 404, errEnvelope(requestId, notFoundError('Job not found')));
      return send(reply, 200, { ...okEnvelope(requestId, job, 1), job_id: job.id });
    });
  };

  if (base) mountRoutes(base);
  // Legacy base path kept for clients built against the original PHP gateway
  mountRoutes('/api/v1');

  if (env.MCP_ENABLED) {
    const oauthStore = deps.oauthStore ?? createOAuthStore(env.OAUTH_DATABASE_PATH);
    if (!deps.oauthStore) app.addHook('onClose', async () => oauthStore.close());
    const verifySoap = deps.soap ?? createSoapClient({ ...env, READ_MAX_RETRIES: 0 }, log);
    registerOAuthRoutes(app, env, oauthStore, createCredentialVerifier(verifySoap));
    const feedback = deps.feedback !== undefined ? deps.feedback : defaultFeedback(env);
    registerMcpRoutes(app, env, oauthStore, services, queue, feedback);
  }

  app.setNotFoundHandler((req, reply) => {
    send(
      reply,
      404,
      errEnvelope(requestIdOf(req), {
        kind: 'not_found',
        message: 'The requested resource was not found',
        statusCode: 404,
        retrySafe: true,
        code: 'NOT_FOUND',
      }),
    );
  });

  app.setErrorHandler((err, req, reply) => {
    log('error', 'unhandled', {
      error: err instanceof Error ? err.message : String(err),
      url: req.url,
    });
    send(
      reply,
      500,
      errEnvelope(requestIdOf(req), {
        kind: 'internal',
        message: 'Internal Server Error',
        statusCode: 500,
        retrySafe: false,
        code: 'INTERNAL',
      }),
    );
  });

  return { app, services };
};
