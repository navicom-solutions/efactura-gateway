import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ACTOR_ROLES, describeCodes, INVOICE_STATUSES } from '../domain/codes.js';
import {
  ActorRoleSchema,
  AssignSerialsSchema,
  GetInvoiceSchema,
  parseBody,
  PostInvoiceSchema,
  SearchInvoicesSchema,
  type ApiEnvelope,
} from '../domain/types.js';
import type { FeedbackSender } from '../feedback/client.js';
import { FeedbackReportSchema } from '../feedback/report.js';
import { isLeft } from '../fp/result.js';
import type { ProviderCredentials } from '../soap/credentials.js';
import {
  newRequestId,
  resolveIdempotencyKey,
  type InvoiceServices,
} from '../services/invoices.js';
import type { InvoiceQueue } from '../queue/invoice-jobs.js';
import {
  compactInvoiceRow,
  countByStatus,
  fitToBudget,
  INVOICE_ITEMS_DEFAULT,
  PAGE_DEFAULT,
  PAGE_MAX,
  pagedResult,
  toolError,
  toolResult,
  type ToolResult,
} from './shape.js';

type ToolAnnotations = {
  readonly title: string;
  readonly readOnlyHint: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint: boolean;
};

type ToolContext = {
  readonly services: InvoiceServices;
  readonly creds: ProviderCredentials;
  readonly queue: InvoiceQueue | null;
  readonly feedback: FeedbackSender | null;
  readonly requestId: string;
};

type ToolDef<S extends ZodTypeAny> = {
  readonly name: string;
  readonly description: string;
  readonly input: S;
  readonly annotations: ToolAnnotations;
  readonly run: (args: z.output<S>, ctx: ToolContext) => Promise<ToolResult>;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
};

const READ: Omit<ToolAnnotations, 'title'> = { readOnlyHint: true, openWorldHint: true };

const ActorRoleInput = ActorRoleSchema.shape.actor_role.describe(
  `Side to look from: ${describeCodes(ACTOR_ROLES)}. Use 1 for invoices the company issued, 2 for invoices it received.`,
);

const PageInput = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGE_MAX)
    .default(PAGE_DEFAULT)
    .describe(`Page size (1-${PAGE_MAX}).`),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Index of the first result. Pass next_offset from the previous page.'),
});

const dateRange = (what: string) => `${what} range {from, to}, both YYYY-MM-DD, inclusive.`;

const SearchInput = SearchInvoicesSchema.extend({
  actor_role: ActorRoleInput,
  status: SearchInvoicesSchema.shape.status.describe(`Invoice status: ${describeCodes(INVOICE_STATUSES)}.`),
  number: SearchInvoicesSchema.shape.number.describe('Invoice number, exact match.'),
  serial: SearchInvoicesSchema.shape.serial.describe('Invoice seria, e.g. EAA.'),
  id: SearchInvoicesSchema.shape.id.describe('External id set when the invoice was posted (e.g. CRM id).'),
  supplier_idno: SearchInvoicesSchema.shape.supplier_idno.describe('Supplier IDNO (13 digits).'),
  buyer_idno: SearchInvoicesSchema.shape.buyer_idno.describe('Buyer IDNO (13 digits).'),
  transporter_idno: SearchInvoicesSchema.shape.transporter_idno.describe('Transporter IDNO (13 digits).'),
  issued_on: SearchInvoicesSchema.shape.issued_on.describe(
    `${dateRange('Issue date')} Strongly recommended: unfiltered searches can return thousands of invoices and take 20+ seconds.`,
  ),
  delivered_on: SearchInvoicesSchema.shape.delivered_on.describe(dateRange('Delivery date')),
  registered_on: SearchInvoicesSchema.shape.registered_on.describe(dateRange('SFS registration date')),
}).merge(PageInput);

const ListInput = z.object({ actor_role: ActorRoleInput }).merge(PageInput);

const GetInput = GetInvoiceSchema.extend({
  seria: GetInvoiceSchema.shape.seria.describe('Invoice seria, e.g. EAA.'),
  number: GetInvoiceSchema.shape.number.describe('Invoice number.'),
  max_items: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(INVOICE_ITEMS_DEFAULT)
    .describe('Maximum invoice lines to return; items_total reports the full count.'),
});

const AssignInput = AssignSerialsSchema.extend({
  count: AssignSerialsSchema.shape.count.describe('How many serial numbers to reserve. Each one is consumed in SFS.'),
  invoiceType: AssignSerialsSchema.shape.invoiceType.describe(
    'SFS invoice type code. Leave 0 unless the user names another type.',
  ),
});

const TaxpayerInput = z.object({
  idno: z.string().min(1).describe('Company IDNO (fiscal code, 13 digits).'),
});

const JobInput = z.object({ job_id: z.string().min(1).describe('job_id returned by efactura_post_invoice.') });

const PostInput = PostInvoiceSchema.extend({
  actor_role: ActorRoleInput,
  invoices_xml_status: PostInvoiceSchema.shape.invoices_xml_status.describe('0 = new invoice.'),
  idempotency_key: z
    .string()
    .min(1)
    .optional()
    .describe('Unique key for this invoice (e.g. order or CRM id). Re-sending the same key never creates a duplicate.'),
  confirm_absent: z
    .boolean()
    .default(false)
    .describe('Set true only after a search proved that an earlier ambiguous post did not reach SFS.'),
  async: z
    .boolean()
    .default(true)
    .describe('Queue the post and return a job_id (check with efactura_job_status). Falls back to sync if queues are disabled.'),
});

const ReportShape = FeedbackReportSchema.shape;

const ReportInput = z.object({
  kind: ReportShape.kind.describe(
    'bug: a tool failed or returned data that looks wrong; feature_request: the user needs something no tool offers; question: behaviour is unclear.',
  ),
  summary: ReportShape.summary.describe('One line, e.g. "search ignores the buyer_idno filter".'),
  details: ReportShape.details.describe(
    'What was attempted, what happened and what was expected. Describe it in general terms: no company names, IDNOs, invoice numbers, amounts or credentials.',
  ),
  tool: ReportShape.tool.describe('Tool involved, if any.'),
  error_code: ReportShape.error_code.describe('Error code the tool returned, if any.'),
  user_confirmed: z
    .literal(true)
    .describe('Set true only after showing the user this summary and details and they agreed to send it.'),
});

export const REPORT_ISSUE_TOOL = 'efactura_report_issue';

const listRows = (envelope: ApiEnvelope): Array<Record<string, unknown>> =>
  ((envelope.results as Array<Record<string, unknown>> | undefined) ?? []).map(compactInvoiceRow);

type RegisteredTool = Omit<ToolDef<ZodTypeAny>, 'run'> & {
  readonly invoke: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
};

const define = <S extends ZodTypeAny>({ run, ...def }: ToolDef<S>): RegisteredTool => ({
  ...def,
  invoke: async (args, ctx) => {
    const parsed = parseBody(def.input, args);
    return isLeft(parsed) ? toolError(parsed.left) : run(parsed.right, ctx);
  },
});

const TOOL_DEFS = [
  define({
    name: 'efactura_search_invoices',
    description:
      'Search invoices by status and optional filters. Returns one page of compact rows (seria, number, status) plus total and by_status counts for the whole result.',
    input: SearchInput,
    annotations: { title: 'Search invoices', ...READ },
    run: async ({ limit, offset, ...query }, { services, creds, requestId }) => {
      const r = await services.search(query, creds, requestId);
      if (isLeft(r)) return toolError(r.left);
      const rows = listRows(r.right);
      return pagedResult(rows, { limit, offset }, { by_status: countByStatus(rows) });
    },
  }),
  define({
    name: 'efactura_get_invoice',
    description: 'Get one invoice with parties, totals and lines by seria and number.',
    input: GetInput,
    annotations: { title: 'Get invoice', ...READ },
    run: async ({ max_items, ...input }, { services, creds, requestId }) => {
      const r = await services.getBySeria(input, creds, requestId);
      if (isLeft(r)) return toolError(r.left);
      const found = ((r.right.results as Array<Record<string, unknown>> | undefined) ?? [])[0] ?? {};
      const invoice = (found.invoice ?? {}) as { merchandises?: unknown[] };
      const lines = invoice.merchandises ?? [];
      return fitToBudget(Math.min(max_items, Math.max(lines.length, 1)), (count) => ({
        success: true,
        ...compactInvoiceRow(found),
        invoice: { ...invoice, merchandises: lines.slice(0, count) },
        items_total: lines.length,
        items_returned: Math.min(count, lines.length),
        items_truncated: lines.length > count,
      }));
    },
  }),
  define({
    name: 'efactura_list_accepted',
    description: 'List invoices in the accepted state for the given side, one page at a time.',
    input: ListInput,
    annotations: { title: 'List accepted invoices', ...READ },
    run: async ({ actor_role, limit, offset }, { services, creds, requestId }) => {
      const r = await services.accepted({ actor_role }, creds, requestId);
      return isLeft(r) ? toolError(r.left) : pagedResult(listRows(r.right), { limit, offset });
    },
  }),
  define({
    name: 'efactura_list_rejected',
    description: 'List invoices rejected by the buyer for the given side, one page at a time.',
    input: ListInput,
    annotations: { title: 'List rejected invoices', ...READ },
    run: async ({ actor_role, limit, offset }, { services, creds, requestId }) => {
      const r = await services.rejected({ actor_role }, creds, requestId);
      return isLeft(r) ? toolError(r.left) : pagedResult(listRows(r.right), { limit, offset });
    },
  }),
  define({
    name: 'efactura_get_taxpayer',
    description: 'Look up a company in the SFS registry by IDNO: name, address, VAT code and whether it uses e-Factura.',
    input: TaxpayerInput,
    annotations: { title: 'Look up taxpayer', ...READ },
    run: async ({ idno }, { services, creds, requestId }) => {
      const r = await services.taxpayer(idno, creds, requestId);
      if (r.body.code) return toolError(r.body);
      return toolResult({ success: r.body.success, message: r.body.message, data: r.body.data ?? null });
    },
  }),
  define({
    name: 'efactura_job_status',
    description: 'Status and result of an invoice post queued with async=true.',
    input: JobInput,
    annotations: { title: 'Check post job', ...READ, openWorldHint: false },
    run: async ({ job_id }, { queue }) => {
      if (!queue) return toolError({ code: 'QUEUE_DISABLED', message: 'Async jobs are disabled on this server.' });
      const job = await queue.get(job_id);
      return job
        ? toolResult({ success: true, ...job })
        : toolError({ code: 'NOT_FOUND', message: `No job ${job_id}.`, retrySafe: true });
    },
  }),
  define({
    name: 'efactura_assign_serials',
    description: 'Reserve invoice serial numbers in SFS. Consumes numbers; call only when the user is about to issue invoices.',
    input: AssignInput,
    annotations: {
      title: 'Reserve serial numbers',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    run: async (input, { services, creds, requestId }) => {
      const r = await services.assignSerials(input, creds, requestId);
      if (isLeft(r)) return toolError(r.left);
      const serials = (r.right.results as Array<Record<string, unknown>> | undefined) ?? [];
      return toolResult({ success: true, serials: serials.map(({ seria, number }) => ({ seria, number })) });
    },
  }),
  define({
    name: 'efactura_post_invoice',
    description:
      'Issue a legally binding invoice in SFS. Confirm buyer, lines and totals with the user first, and always pass idempotency_key. Never retried automatically.',
    input: PostInput,
    annotations: {
      title: 'Issue invoice',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    run: async ({ async: asyncMode, idempotency_key, confirm_absent, ...body }, { services, creds, queue, requestId }) => {
      if (asyncMode && queue) {
        const keyE = resolveIdempotencyKey(idempotency_key, body);
        if (isLeft(keyE)) return toolError(keyE.left);
        const { jobId, reused } = await queue.enqueue({
          requestId,
          idempotencyKey: keyE.right,
          confirmAbsent: confirm_absent,
          creds,
          body,
        });
        return toolResult({ success: true, job_id: jobId, reused, status: 'queued' });
      }
      const r = await services.postInvoice(body, creds, requestId, idempotency_key, confirm_absent);
      if (!r.body.success) return toolError(r.body);
      return toolResult({ success: true, message: r.body.message, results: r.body.results, request_id: r.body.requestId });
    },
  }),
  define({
    name: REPORT_ISSUE_TOOL,
    description:
      'Send a bug report or feature request about this gateway to its maintainers. Use when a tool fails unexpectedly, returns data that looks wrong, or the user needs something no tool supports. Show the user the report and send only after they agree. Personal and business data is masked before sending.',
    input: ReportInput,
    annotations: {
      title: 'Report an issue to the maintainers',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    run: async ({ user_confirmed: _confirmed, ...draft }, { feedback }) => {
      if (!feedback) {
        return toolError({ code: 'FEEDBACK_DISABLED', message: 'Issue reporting is turned off on this server.' });
      }
      const r = await feedback(draft);
      if (isLeft(r)) return toolError(r.left);
      const { id, duplicate, report } = r.right;
      return toolResult({
        success: true,
        report_id: id,
        duplicate,
        message: duplicate ? 'This issue was already reported; no new report was created.' : 'Sent to the maintainers.',
        sent: { kind: report.kind, summary: report.summary, details: report.details },
      });
    },
  }),
];

const toInputSchema = (schema: ZodTypeAny): Record<string, unknown> => {
  const { $schema: _ignored, ...rest } = zodToJsonSchema(schema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  return rest;
};

export const MCP_TOOLS: McpTool[] = TOOL_DEFS.map((t) => ({
  name: t.name,
  title: t.annotations.title,
  description: t.description,
  inputSchema: toInputSchema(t.input),
  annotations: t.annotations,
}));

/** Tools to advertise; the report tool is hidden when no feedback relay is configured. */
export const listMcpTools = (feedbackEnabled: boolean): McpTool[] =>
  feedbackEnabled ? MCP_TOOLS : MCP_TOOLS.filter((t) => t.name !== REPORT_ISSUE_TOOL);

const TOOLS_BY_NAME = new Map(TOOL_DEFS.map((t) => [t.name, t]));

export const callMcpTool = async (
  name: string,
  args: Record<string, unknown>,
  services: InvoiceServices,
  creds: ProviderCredentials,
  queue: InvoiceQueue | null,
  feedback: FeedbackSender | null = null,
): Promise<ToolResult> => {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return toolError({ code: 'VALIDATION_ERROR', message: `Unknown tool: ${name}` });
  try {
    return await tool.invoke(args, { services, creds, queue, feedback, requestId: newRequestId() });
  } catch (err) {
    return toolError({ code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) });
  }
};
