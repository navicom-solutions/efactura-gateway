import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env.js';
import {
  ambiguousWrite,
  conflictError,
  notFoundError,
  validationError,
  type AppError,
} from '../domain/errors.js';
import {
  errEnvelope,
  okEnvelope,
  type ActorRoleInput,
  type ApiEnvelope,
  type AssignSerialsInput,
  type GetInvoiceInput,
  type PostInvoiceInput,
  type SearchInvoicesInput,
} from '../domain/types.js';
import { isLeft, left, right, type Either } from '../fp/result.js';
import type { SoapClient } from '../soap/client.js';
import type { ProviderCredentials } from '../soap/credentials.js';
import { escapeXml } from '../soap/envelope.js';
import {
  parseAssignSerialsResponse,
  parseGetBySeriaResponse,
  parseInvoiceListResponse,
  parsePostInvoicesResponse,
  parseSearchResponse,
  parseTaxpayerResponse,
} from '../soap/parse.js';
import {
  buildInvoicesXml,
  extractExternalIds,
  hasAttachments,
} from '../xml/invoiceBuilder.js';
import {
  createIdempotencyStore,
  hashRequestBody,
  type IdempotencyStore,
} from './idempotency.js';

export type InvoiceServices = {
  readonly search: (
    input: SearchInvoicesInput,
    creds: ProviderCredentials,
    requestId: string,
  ) => Promise<Either<AppError, ApiEnvelope>>;
  readonly getBySeria: (
    input: GetInvoiceInput,
    creds: ProviderCredentials,
    requestId: string,
  ) => Promise<Either<AppError, ApiEnvelope>>;
  readonly assignSerials: (
    input: AssignSerialsInput,
    creds: ProviderCredentials,
    requestId: string,
  ) => Promise<Either<AppError, ApiEnvelope>>;
  readonly postInvoice: (
    input: PostInvoiceInput,
    creds: ProviderCredentials,
    requestId: string,
    idempotencyKey: string | undefined,
    confirmAbsent: boolean,
  ) => Promise<{ statusCode: number; body: ApiEnvelope }>;
  readonly accepted: (
    input: ActorRoleInput,
    creds: ProviderCredentials,
    requestId: string,
  ) => Promise<Either<AppError, ApiEnvelope>>;
  readonly rejected: (
    input: ActorRoleInput,
    creds: ProviderCredentials,
    requestId: string,
  ) => Promise<Either<AppError, ApiEnvelope>>;
  readonly taxpayer: (
    idno: string,
    creds: ProviderCredentials,
    requestId: string,
  ) => Promise<{ statusCode: number; body: ApiEnvelope }>;
  readonly close: () => void;
};

const formatDateRange = (range: { from: string; to: string }): { start: string; end: string } => {
  const start = new Date(`${range.from}T00:00:00.000Z`).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const end = new Date(`${range.to}T23:59:59.000Z`).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { start, end };
};

const buildSearchBody = (requestId: string, p: SearchInvoicesInput): string => {
  const chunks: string[] = [];
  const push = (name: string, value: string | number | undefined) => {
    if (value === undefined || value === '') return;
    chunks.push(`<ax:${name}>${escapeXml(String(value))}</ax:${name}>`);
  };
  const pushRange = (name: string, range?: { from: string; to: string }) => {
    if (!range) return;
    const { start, end } = formatDateRange(range);
    chunks.push(
      `<ax:${name}><ax:EndDate>${end}</ax:EndDate><ax:StartDate>${start}</ax:StartDate></ax:${name}>`,
    );
  };

  // WSDL order
  push('APIeInvoiceId', p.id);
  push('BuyerIDNO', p.buyer_idno);
  pushRange('DeliveredOn', p.delivered_on);
  push('InvoiceStatus', p.status);
  if (p.invoice_type != null) push('InvoiceType', p.invoice_type);
  pushRange('IssuedOn', p.issued_on);
  push('Number', p.number);
  pushRange('RegisteredOn', p.registered_on);
  push('Seria', p.serial);
  push('SupplierIDNO', p.supplier_idno);
  push('TransporterIDNO', p.transporter_idno);

  return `<tns:SearchInvoices>
    <tns:request>
      <ax:RequestId>${escapeXml(requestId)}</ax:RequestId>
      <ax:ActorRole>${p.actor_role}</ax:ActorRole>
      <ax:Parameters>${chunks.join('')}</ax:Parameters>
    </tns:request>
  </tns:SearchInvoices>`;
};

export const resolveIdempotencyKey = (
  headerKey: string | undefined,
  input: PostInvoiceInput,
): Either<AppError, string> => {
  const fromHeader = headerKey?.trim();
  if (fromHeader) return right(fromHeader);
  const ids = extractExternalIds(input.documents);
  if (ids[0]) return right(ids[0]);
  return left(
    validationError(
      'Missing Idempotency-Key header (or documents[].additional_information.id). Required for POST /invoices/new to prevent duplicate invoices on upstream timeouts.',
    ),
  );
};

export const createInvoiceServices = (
  env: Env,
  soap: SoapClient,
  log: (level: 'info' | 'warn' | 'error' | 'debug', msg: string, meta?: Record<string, unknown>) => void,
  store: IdempotencyStore = createIdempotencyStore(env.DATABASE_PATH),
): InvoiceServices => {
  const search: InvoiceServices['search'] = async (input, creds, requestId) => {
    const xmlE = await soap.call(
      { operation: 'search', requestId, isWrite: false },
      creds,
      buildSearchBody(requestId, input),
    );
    if (isLeft(xmlE)) return xmlE;
    const parsed = parseSearchResponse(xmlE.right);
    if (isLeft(parsed)) return parsed;
    const r = parsed.right;
    return right(
      okEnvelope(r.requestId || requestId, r.results, r.total, r.message),
    );
  };

  const getBySeria: InvoiceServices['getBySeria'] = async (input, creds, requestId) => {
    const body = `<tns:GetInvoicesBySeriaNumber>
      <tns:request>
        <ax:RequestId>${escapeXml(requestId)}</ax:RequestId>
        <ax:SeriaAndNumbers>
          <ax:InvoiceIndentificator>
            <ax:Number>${escapeXml(input.number)}</ax:Number>
            <ax:Seria>${escapeXml(input.seria)}</ax:Seria>
          </ax:InvoiceIndentificator>
        </ax:SeriaAndNumbers>
      </tns:request>
    </tns:GetInvoicesBySeriaNumber>`;

    const xmlE = await soap.call(
      { operation: 'getBySeriaNumber', requestId, isWrite: false },
      creds,
      body,
    );
    if (isLeft(xmlE)) return xmlE;
    const parsed = parseGetBySeriaResponse(xmlE.right);
    if (isLeft(parsed)) return parsed;
    const r = parsed.right;
    if (!r.success) return left(notFoundError(r.message || 'Invoice not found'));
    return right(okEnvelope(r.requestId || requestId, r.results, r.total, r.message));
  };

  const assignSerials: InvoiceServices['assignSerials'] = async (input, creds, requestId) => {
    const body = `<tns:GetSeriaAndNumbers>
      <tns:request>
        <ax:RequestId>${escapeXml(requestId)}</ax:RequestId>
        <ax:Count>${input.count}</ax:Count>
        <ax:InvoiceType>${input.invoiceType}</ax:InvoiceType>
      </tns:request>
    </tns:GetSeriaAndNumbers>`;

    const xmlE = await soap.call(
      { operation: 'getSeriaAndNumbers', requestId, isWrite: false },
      creds,
      body,
    );
    if (isLeft(xmlE)) return xmlE;
    const parsed = parseAssignSerialsResponse(xmlE.right);
    if (isLeft(parsed)) return parsed;
    const r = parsed.right;
    return right(okEnvelope(r.requestId || requestId, r.results, r.total, r.message));
  };

  const accepted: InvoiceServices['accepted'] = async (input, creds, requestId) => {
    const body = `<tns:GetAcceptedInvoices><tns:request><ax:RequestId>${escapeXml(requestId)}</ax:RequestId><ax:ActorRole>${input.actor_role}</ax:ActorRole></tns:request></tns:GetAcceptedInvoices>`;
    const xmlE = await soap.call(
      { operation: 'getAcceptedInvoices', requestId, isWrite: false },
      creds,
      body,
    );
    if (isLeft(xmlE)) return xmlE;
    const parsed = parseInvoiceListResponse(xmlE.right, 'GetAcceptedInvoicesResult');
    if (isLeft(parsed)) return parsed;
    const r = parsed.right;
    return right(okEnvelope(r.requestId || requestId, r.results, r.total, r.message));
  };

  const rejected: InvoiceServices['rejected'] = async (input, creds, requestId) => {
    const body = `<tns:GetRejectedInvoices><tns:request><ax:RequestId>${escapeXml(requestId)}</ax:RequestId><ax:ActorRole>${input.actor_role}</ax:ActorRole></tns:request></tns:GetRejectedInvoices>`;
    const xmlE = await soap.call(
      { operation: 'getRejectedInvoices', requestId, isWrite: false },
      creds,
      body,
    );
    if (isLeft(xmlE)) return xmlE;
    const parsed = parseInvoiceListResponse(xmlE.right, 'GetRejectedInvoicesResult');
    if (isLeft(parsed)) return parsed;
    const r = parsed.right;
    return right(okEnvelope(r.requestId || requestId, r.results, r.total, r.message));
  };

  const taxpayer: InvoiceServices['taxpayer'] = async (idno, creds, requestId) => {
    const sanitized = idno.replace(/[:*?\"<>|]/g, '');
    if (!sanitized) {
      return {
        statusCode: 400,
        body: errEnvelope(requestId, validationError('IDNO cannot be empty after sanitization')),
      };
    }
    const body = `<tns:GetTaxpayersInfo>
      <tns:request>
        <ax:RequestId>${escapeXml(requestId)}</ax:RequestId>
        <ax:FiscalCodes xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
          <b:string>${escapeXml(sanitized)}</b:string>
        </ax:FiscalCodes>
      </tns:request>
    </tns:GetTaxpayersInfo>`;

    const xmlE = await soap.call(
      { operation: 'getTaxpayersInfo', requestId, isWrite: false },
      creds,
      body,
    );
    if (isLeft(xmlE)) {
      return { statusCode: xmlE.left.statusCode, body: errEnvelope(requestId, xmlE.left) };
    }
    const parsed = parseTaxpayerResponse(xmlE.right, requestId);
    if (isLeft(parsed)) {
      return { statusCode: parsed.left.statusCode, body: errEnvelope(requestId, parsed.left) };
    }
    const r = parsed.right;
    const bodyOut: ApiEnvelope = {
      success: r.success,
      requestId,
      request_id: requestId,
      timeStamp: r.timeStamp,
      timestamp: r.timeStamp,
      message: r.message,
      total: r.data ? 1 : 0,
      data: r.data,
    };
    return { statusCode: r.success ? 200 : 404, body: bodyOut };
  };

  /**
   * POST invoices — never auto-retries on timeout/5xx.
   * Uses Idempotency-Key / external id ledger so clients can safely re-call
   * after ambiguous failures (cached success / conflict / ambiguous replay).
   */
  const postInvoice: InvoiceServices['postInvoice'] = async (
    input,
    creds,
    requestId,
    idempotencyKeyHeader,
    confirmAbsent,
  ) => {
    const keyE = resolveIdempotencyKey(idempotencyKeyHeader, input);
    if (isLeft(keyE)) {
      return { statusCode: 400, body: errEnvelope(requestId, keyE.left) };
    }
    const key = keyE.right;
    const reqHash = hashRequestBody(input);
    const begin = store.begin(key, reqHash);

    if (begin.tag === 'conflict') {
      return {
        statusCode: 409,
        body: errEnvelope(
          requestId,
          conflictError('Idempotency-Key already used with a different request body'),
        ),
      };
    }

    if (begin.tag === 'existing') {
      const rec = begin.record;
      if (rec.status === 'succeeded' && rec.responseJson) {
        log('info', 'idempotent_replay_success', { key, request_id: requestId });
        return {
          statusCode: rec.httpStatus ?? 200,
          body: JSON.parse(rec.responseJson) as ApiEnvelope,
        };
      }
      if (rec.status === 'in_flight') {
        return {
          statusCode: 409,
          body: errEnvelope(
            requestId,
            conflictError(
              'A post with this Idempotency-Key is already in flight. Wait, then search before retrying.',
            ),
          ),
        };
      }
      if (rec.status === 'ambiguous') {
        if (confirmAbsent && store.reopenAmbiguous(key, reqHash)) {
          log('warn', 'idempotent_ambiguous_reopened', {
            key,
            request_id: requestId,
            note: 'Client confirmed invoice absent via X-Confirm-Absent',
          });
        } else {
          return {
            statusCode: 504,
            body: errEnvelope(
              requestId,
              ambiguousWrite(
                'Previous post with this Idempotency-Key timed out or got an ambiguous upstream response. Do NOT re-post blindly — search by external id / serial first. If confirmed absent, retry with the SAME Idempotency-Key and header X-Confirm-Absent: true.',
              ),
            ),
          };
        }
      } else if (rec.status === 'failed') {
        if (!store.reopenFailed(key, reqHash)) {
          return {
            statusCode: 409,
            body: errEnvelope(requestId, conflictError('Could not reopen failed idempotency record')),
          };
        }
      }
    }

    const invoicesXml = buildInvoicesXml(input.documents);
    const withAtt = hasAttachments(input.documents);
    const soapBody = withAtt
      ? `<tns:PostInvoicesWithAttachment>
          <tns:request>
            <ax:RequestId>${escapeXml(requestId)}</ax:RequestId>
            <ax:ActorRole>${input.actor_role}</ax:ActorRole>
            <ax:InvoicesXml><![CDATA[${invoicesXml}]]></ax:InvoicesXml>
            <ax:InvoicesXmlStatus>${input.invoices_xml_status}</ax:InvoicesXmlStatus>
          </tns:request>
        </tns:PostInvoicesWithAttachment>`
      : `<tns:PostInvoices>
          <tns:request>
            <ax:RequestId>${escapeXml(requestId)}</ax:RequestId>
            <ax:ActorRole>${input.actor_role}</ax:ActorRole>
            <ax:InvoicesXml><![CDATA[${invoicesXml}]]></ax:InvoicesXml>
            <ax:InvoicesXmlStatus>${input.invoices_xml_status}</ax:InvoicesXmlStatus>
          </tns:request>
        </tns:PostInvoices>`;

    log('info', 'post_invoice_start', {
      request_id: requestId,
      idempotency_key: key,
      documents: input.documents.length,
      with_attachment: withAtt,
    });

    const xmlE = await soap.call(
      {
        operation: withAtt ? 'postInvoicesWithAttachment' : 'postInvoices',
        requestId,
        isWrite: true,
      },
      creds,
      soapBody,
    );

    if (isLeft(xmlE)) {
      const err = xmlE.left;
      if (!err.retrySafe) {
        const body = errEnvelope(requestId, err);
        store.complete(key, 'ambiguous', err.statusCode, JSON.stringify(body));
        log('error', 'post_invoice_ambiguous', {
          request_id: requestId,
          idempotency_key: key,
          code: err.code,
        });
        return { statusCode: err.statusCode, body };
      }
      const body = errEnvelope(requestId, err);
      store.complete(key, 'failed', err.statusCode, JSON.stringify(body));
      return { statusCode: err.statusCode, body };
    }

    const parsed = parsePostInvoicesResponse(xmlE.right, withAtt);
    if (isLeft(parsed)) {
      // Parse failure after HTTP 200 is rare; treat as ambiguous for writes.
      const err = ambiguousWrite(parsed.left.message);
      const body = errEnvelope(requestId, err);
      store.complete(key, 'ambiguous', 504, JSON.stringify(body));
      return { statusCode: 504, body };
    }

    const r = parsed.right;
    const rid = r.requestId || requestId;
    const body: ApiEnvelope = {
      success: r.success,
      requestId: rid,
      request_id: rid,
      timeStamp: r.timeStamp,
      timestamp: r.timeStamp,
      message: r.message,
      total: r.total,
      results: r.results,
      retry_safe: r.success ? false : true,
      code: r.success ? 'POSTED' : 'POST_REJECTED',
    };
    const statusCode = r.success ? 200 : 400;
    store.complete(key, r.success ? 'succeeded' : 'failed', statusCode, JSON.stringify(body));
    log('info', 'post_invoice_done', {
      request_id: requestId,
      idempotency_key: key,
      success: r.success,
      posted: r.results[0]?.total_invoices_posted ?? 0,
    });
    return { statusCode, body };
  };

  return {
    search,
    getBySeria,
    assignSerials,
    postInvoice,
    accepted,
    rejected,
    taxpayer,
    close: () => store.close(),
  };
};

export const newRequestId = (): string => randomUUID();
