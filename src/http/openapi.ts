import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Env } from '../config/env.js';
import {
  ActorRoleSchema,
  AssignSerialsSchema,
  GetInvoiceSchema,
  PostInvoiceSchema,
  SearchInvoicesSchema,
} from '../domain/types.js';

type JsonObject = Record<string, unknown>;

const API_VERSION = '1.1.0';

const toSchema = (schema: ZodTypeAny): JsonObject => {
  const { $schema: _ignored, ...rest } = zodToJsonSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
  }) as JsonObject;
  return rest;
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const jsonBody = (schemaName: string, example?: unknown) => ({
  required: true,
  content: { 'application/json': { schema: ref(schemaName), ...(example ? { example } : {}) } },
});

const envelopeResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('ApiEnvelope') } },
});

const errorResponses = {
  '400': envelopeResponse('Validation error or upstream business rejection'),
  '401': envelopeResponse('Missing or invalid API key'),
  '502': envelopeResponse('Upstream SFS network/HTTP/parse error (see `retry_safe`)'),
  '504': envelopeResponse('Upstream SFS timeout (see `retry_safe`)'),
};

const header = (name: string, description: string, required = false) => ({
  name,
  in: 'header',
  required,
  description,
  schema: { type: 'string' },
});

const providerCredentials = header(
  'X-Provider-Credentials',
  'Optional per-request SFS account: base64("username:password"). Overrides the default account.',
);

const readOperation = (
  summary: string,
  description: string,
  operationId: string,
  bodySchema?: string,
  example?: unknown,
) => ({
  tags: ['Invoices'],
  summary,
  description,
  operationId,
  parameters: [providerCredentials],
  ...(bodySchema ? { requestBody: jsonBody(bodySchema, example) } : {}),
  responses: { '200': envelopeResponse('Success'), ...errorResponses },
});

const healthPath = {
  get: {
    tags: ['Health'],
    summary: 'Liveness check',
    operationId: 'health',
    security: [],
    responses: { '200': { description: 'Service is up' } },
  },
};

/** OpenAPI 3.1 document for the REST API; request schemas are derived from the Zod validators. */
export const buildOpenApiDocument = (env: Env): JsonObject => {
  const base = env.BASE_PATH;
  const p = (path: string) => `${base}${path}`;

  return {
    openapi: '3.1.0',
    info: {
      title: 'efactura-gateway — e-Factura Moldova REST API',
      version: API_VERSION,
      summary: 'REST/JSON and MCP gateway for the Moldova SFS e-Factura SOAP service.',
      description: [
        'Issue, search and track Moldovan electronic fiscal invoices (e-Factura) with JSON instead of SOAP.',
        '',
        '**Write safety:** `POST /invoices/new` requires an `Idempotency-Key` (or `documents[].additional_information.id`).',
        'Upstream timeouts are reported as ambiguous (`retry_safe: false`) and are never retried automatically.',
        '',
        '**LLM access:** an MCP server is available at `POST /mcp` (JSON-RPC, OAuth 2.1 + PKCE).',
      ].join('\n'),
      license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
      contact: { name: 'Navicom Solutions Ltd.', url: 'https://github.com/navicom-solutions/efactura-gateway' },
    },
    servers: [{ url: env.PUBLIC_URL.replace(/\/$/, '') }],
    security: [{ apiKey: [] }],
    tags: [
      { name: 'Invoices', description: 'e-Factura invoice operations' },
      { name: 'Taxpayers', description: 'SFS taxpayer registry' },
      { name: 'Jobs', description: 'Async invoice posting (requires QUEUE_ENABLED)' },
      { name: 'Health' },
    ],
    paths: {
      '/health': healthPath,
      [p('/invoices/search')]: {
        post: readOperation(
          'Search invoices',
          'Search e-Factura invoices by actor role and status, with optional number, serial, external id, IDNO and date-range filters. Results include both `serial` and `seria`.',
          'searchInvoices',
          'SearchInvoicesRequest',
          { actor_role: 1, status: 8, serial: 'EAA' },
        ),
      },
      [p('/invoices/get')]: {
        post: readOperation(
          'Get invoice by seria and number',
          'Returns the invoice status and the parsed invoice document.',
          'getInvoice',
          'GetInvoiceRequest',
          { seria: 'EAA', number: '0000001' },
        ),
      },
      [p('/invoices/assign-serials')]: {
        post: readOperation(
          'Reserve invoice serial numbers',
          'Asks SFS to allocate the next serial/number pairs.',
          'assignSerials',
          'AssignSerialsRequest',
          { count: 1, invoiceType: 0 },
        ),
      },
      [p('/invoices/new')]: {
        post: {
          tags: ['Invoices'],
          summary: 'Post (issue) invoices',
          description:
            'Creates invoices in e-Factura. Never auto-retried. Replays with the same key return the stored result; a different body with the same key returns 409. With `Prefer: respond-async` and the queue enabled, returns 202 with a `job_id`.',
          operationId: 'postInvoice',
          parameters: [
            header(
              'Idempotency-Key',
              'Stable key for this invoice. Required unless documents[].additional_information.id is set.',
            ),
            header(
              'X-Confirm-Absent',
              'Send `true` only after verifying an ambiguous post did NOT create the invoice.',
            ),
            header('Prefer', 'Send `respond-async` to enqueue instead of waiting for SFS.'),
            providerCredentials,
          ],
          requestBody: jsonBody('PostInvoiceRequest'),
          responses: {
            '200': envelopeResponse('Posted (`code: POSTED`)'),
            '202': envelopeResponse('Queued (`code: QUEUED`, `job_id`)'),
            '409': envelopeResponse('Idempotency conflict or post already in flight'),
            ...errorResponses,
          },
        },
      },
      [p('/invoices/accepted')]: {
        post: readOperation(
          'List accepted invoices',
          'Invoices accepted by the counterparty for the given actor role.',
          'listAcceptedInvoices',
          'ActorRoleRequest',
          { actor_role: 1 },
        ),
      },
      [p('/invoices/rejected')]: {
        post: readOperation(
          'List rejected invoices',
          'Invoices rejected by the counterparty for the given actor role.',
          'listRejectedInvoices',
          'ActorRoleRequest',
          { actor_role: 1 },
        ),
      },
      [p('/taxpayer/{idno}')]: {
        get: {
          tags: ['Taxpayers'],
          summary: 'Look up a taxpayer by IDNO',
          description: 'Returns registry data and whether the company is an e-Factura actor.',
          operationId: 'getTaxpayer',
          parameters: [
            { name: 'idno', in: 'path', required: true, schema: { type: 'string' }, example: '1015600027437' },
            providerCredentials,
          ],
          responses: {
            '200': envelopeResponse('Taxpayer found'),
            '404': envelopeResponse('Taxpayer not in registry'),
            ...errorResponses,
          },
        },
      },
      [p('/jobs/{id}')]: {
        get: {
          tags: ['Jobs'],
          summary: 'Get async post job status',
          operationId: 'getJob',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': envelopeResponse('Job state and, when finished, the post result'),
            '404': envelopeResponse('Unknown job or queue disabled'),
            '401': errorResponses['401'],
          },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'Gateway API key: `Authorization: Bearer <API_KEY>`',
        },
      },
      schemas: {
        SearchInvoicesRequest: toSchema(SearchInvoicesSchema),
        GetInvoiceRequest: toSchema(GetInvoiceSchema),
        AssignSerialsRequest: toSchema(AssignSerialsSchema),
        ActorRoleRequest: toSchema(ActorRoleSchema),
        PostInvoiceRequest: toSchema(PostInvoiceSchema),
        ApiEnvelope: {
          type: 'object',
          required: ['success', 'requestId', 'timeStamp', 'message', 'total'],
          properties: {
            success: { type: 'boolean' },
            requestId: { type: 'string' },
            request_id: { type: 'string', description: 'Alias of requestId' },
            timeStamp: { type: 'string', format: 'date-time' },
            timestamp: { type: 'string', description: 'Alias of timeStamp' },
            message: { type: 'string' },
            total: { type: 'integer' },
            results: { description: 'Operation-specific payload' },
            data: { description: 'Taxpayer payload (GET /taxpayer)' },
            code: {
              type: 'string',
              description: 'Machine-readable outcome, e.g. POSTED, QUEUED, UPSTREAM_TIMEOUT_AMBIGUOUS',
            },
            retry_safe: { type: 'boolean', description: 'Whether repeating the exact call is safe' },
            job_id: { type: 'string' },
          },
        },
      },
    },
  };
};
