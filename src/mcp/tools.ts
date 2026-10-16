import {
  ActorRoleSchema,
  AssignSerialsSchema,
  GetInvoiceSchema,
  parseBody,
  PostInvoiceSchema,
  SearchInvoicesSchema,
} from '../domain/types.js';
import { isLeft } from '../fp/result.js';
import type { ProviderCredentials } from '../soap/credentials.js';
import {
  newRequestId,
  resolveIdempotencyKey,
  type InvoiceServices,
} from '../services/invoices.js';
import type { InvoiceQueue } from '../queue/invoice-jobs.js';

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'efactura_search_invoices',
    description: 'Search eFactura invoices by actor role, status, and optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        actor_role: { type: 'integer', minimum: 1, maximum: 3 },
        status: { type: 'integer' },
        number: { type: 'string' },
        serial: { type: 'string' },
        id: { type: 'string', description: 'External / CRM id' },
      },
      required: ['actor_role', 'status'],
    },
  },
  {
    name: 'efactura_get_invoice',
    description: 'Get invoice details by seria and number',
    inputSchema: {
      type: 'object',
      properties: { seria: { type: 'string' }, number: { type: 'string' } },
      required: ['seria', 'number'],
    },
  },
  {
    name: 'efactura_post_invoice',
    description:
      'Post a new invoice. Prefer async=true for durability (BullMQ). Requires idempotency_key or documents[].additional_information.id. Never blind-retries on upstream timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        async: { type: 'boolean', default: true },
        idempotency_key: { type: 'string' },
        confirm_absent: { type: 'boolean', default: false },
        actor_role: { type: 'integer' },
        invoices_xml_status: { type: 'integer' },
        documents: { type: 'array' },
      },
      required: ['actor_role', 'invoices_xml_status', 'documents'],
    },
  },
  {
    name: 'efactura_job_status',
    description: 'Get status/result of an async post job',
    inputSchema: {
      type: 'object',
      properties: { job_id: { type: 'string' } },
      required: ['job_id'],
    },
  },
  {
    name: 'efactura_assign_serials',
    description: 'Assign invoice serial numbers from SFS',
    inputSchema: {
      type: 'object',
      properties: { count: { type: 'integer' }, invoiceType: { type: 'integer' } },
      required: ['count'],
    },
  },
  {
    name: 'efactura_get_taxpayer',
    description: 'Lookup taxpayer by IDNO',
    inputSchema: {
      type: 'object',
      properties: { idno: { type: 'string' } },
      required: ['idno'],
    },
  },
  {
    name: 'efactura_list_accepted',
    description: 'List accepted invoices for actor role',
    inputSchema: {
      type: 'object',
      properties: { actor_role: { type: 'integer' } },
      required: ['actor_role'],
    },
  },
  {
    name: 'efactura_list_rejected',
    description: 'List rejected invoices for actor role',
    inputSchema: {
      type: 'object',
      properties: { actor_role: { type: 'integer' } },
      required: ['actor_role'],
    },
  },
];

export const callMcpTool = async (
  name: string,
  args: Record<string, unknown>,
  services: InvoiceServices,
  creds: ProviderCredentials,
  queue: InvoiceQueue | null,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> => {
  const requestId = newRequestId();
  const text = (obj: unknown, isError = false) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }],
    isError,
  });

  try {
    switch (name) {
      case 'efactura_search_invoices': {
        const parsed = parseBody(SearchInvoicesSchema, args);
        if (isLeft(parsed)) return text(parsed.left, true);
        const r = await services.search(parsed.right, creds, requestId);
        return isLeft(r) ? text(r.left, true) : text(r.right);
      }
      case 'efactura_get_invoice': {
        const parsed = parseBody(GetInvoiceSchema, args);
        if (isLeft(parsed)) return text(parsed.left, true);
        const r = await services.getBySeria(parsed.right, creds, requestId);
        return isLeft(r) ? text(r.left, true) : text(r.right);
      }
      case 'efactura_assign_serials': {
        const parsed = parseBody(AssignSerialsSchema, args);
        if (isLeft(parsed)) return text(parsed.left, true);
        const r = await services.assignSerials(parsed.right, creds, requestId);
        return isLeft(r) ? text(r.left, true) : text(r.right);
      }
      case 'efactura_get_taxpayer': {
        const idno = String(args.idno ?? '');
        const r = await services.taxpayer(idno, creds, requestId);
        return text(r.body, !r.body.success);
      }
      case 'efactura_list_accepted': {
        const parsed = parseBody(ActorRoleSchema, args);
        if (isLeft(parsed)) return text(parsed.left, true);
        const r = await services.accepted(parsed.right, creds, requestId);
        return isLeft(r) ? text(r.left, true) : text(r.right);
      }
      case 'efactura_list_rejected': {
        const parsed = parseBody(ActorRoleSchema, args);
        if (isLeft(parsed)) return text(parsed.left, true);
        const r = await services.rejected(parsed.right, creds, requestId);
        return isLeft(r) ? text(r.left, true) : text(r.right);
      }
      case 'efactura_job_status': {
        if (!queue) return text({ error: 'Queue disabled' }, true);
        const jobId = String(args.job_id ?? '');
        const job = await queue.get(jobId);
        return text(job ?? { error: 'not_found' }, !job);
      }
      case 'efactura_post_invoice': {
        const asyncMode = args.async !== false;
        const idempotencyKey =
          typeof args.idempotency_key === 'string' ? args.idempotency_key : undefined;
        const confirmAbsent = args.confirm_absent === true;
        const { async: _a, idempotency_key: _i, confirm_absent: _c, ...rest } = args;
        const parsed = parseBody(PostInvoiceSchema, rest);
        if (isLeft(parsed)) return text(parsed.left, true);

        if (asyncMode && queue) {
          const keyE = resolveIdempotencyKey(idempotencyKey, parsed.right);
          if (isLeft(keyE)) return text(keyE.left, true);
          const { jobId, reused } = await queue.enqueue({
            requestId,
            idempotencyKey: keyE.right,
            confirmAbsent,
            creds,
            body: parsed.right,
          });
          return text({ success: true, job_id: jobId, reused, status: 'queued' });
        }

        const r = await services.postInvoice(
          parsed.right,
          creds,
          requestId,
          idempotencyKey,
          confirmAbsent,
        );
        return text(r.body, !r.body.success);
      }
      default:
        return text({ error: `Unknown tool: ${name}` }, true);
    }
  } catch (err) {
    return text({ error: err instanceof Error ? err.message : String(err) }, true);
  }
};
