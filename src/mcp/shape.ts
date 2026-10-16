import { invoiceStatusLabel } from '../domain/codes.js';

export const PAGE_DEFAULT = 25;
export const PAGE_MAX = 100;
export const INVOICE_ITEMS_DEFAULT = 50;
/** Upper bound for one tool result (~5k tokens); larger pages are shrunk to fit. */
export const RESPONSE_BUDGET_CHARS = 20_000;

export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError: boolean };

type Json = Record<string, unknown>;

export const toolResult = (payload: unknown, isError = false): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(payload) }],
  isError,
});

const AMBIGUOUS_HINT =
  'SFS may already have registered this invoice. Do not post again. Search for it (efactura_search_invoices) and re-post with the same idempotency_key and confirm_absent=true only if it is absent.';

const ERROR_HINTS: Record<string, string> = {
  VALIDATION_ERROR: 'Fix the arguments described in message and call again.',
  NOT_FOUND: 'Check seria and number, or locate the invoice with efactura_search_invoices.',
  UPSTREAM_TIMEOUT: 'SFS was slow. Safe to retry; narrow the filters (for example issued_on) for searches.',
  UPSTREAM_NETWORK: 'Safe to retry in a moment.',
  UPSTREAM_HTTP: 'SFS returned an error. Safe to retry later; if it persists, the API user may lack access.',
  UPSTREAM_PARSE: 'Safe to retry.',
  UPSTREAM_BUSINESS: 'SFS rejected the request. Explain the message to the user.',
  IDEMPOTENCY_CONFLICT: 'This idempotency_key was used for a different invoice. Use a new key for a new invoice.',
  WRITE_AMBIGUOUS: AMBIGUOUS_HINT,
  UPSTREAM_TIMEOUT_AMBIGUOUS: AMBIGUOUS_HINT,
  UPSTREAM_NETWORK_AMBIGUOUS: AMBIGUOUS_HINT,
  UPSTREAM_5XX_AMBIGUOUS: AMBIGUOUS_HINT,
  QUEUE_DISABLED: 'Async jobs are disabled on this server; post with async=false.',
};

export type ErrorLike = {
  readonly code?: string;
  readonly message: string;
  readonly retrySafe?: boolean;
  readonly retry_safe?: boolean;
};

export const toolError = (err: ErrorLike): ToolResult => {
  const code = err.code ?? 'ERROR';
  const retrySafe = err.retrySafe ?? err.retry_safe ?? false;
  return toolResult(
    {
      success: false,
      code,
      message: err.message,
      retry_safe: retrySafe,
      hint: ERROR_HINTS[code] ?? (retrySafe ? 'Safe to retry.' : 'Do not retry automatically; tell the user.'),
    },
    true,
  );
};

/**
 * Serializes `build(n)` for the largest n ≤ requested that fits the response budget,
 * halving on overflow. `build` receives the item count to include.
 */
export const fitToBudget = (requested: number, build: (count: number, reduced: boolean) => Json): ToolResult => {
  let count = requested;
  for (;;) {
    const text = JSON.stringify(build(count, count < requested));
    if (text.length <= RESPONSE_BUDGET_CHARS || count <= 1) return { content: [{ type: 'text', text }], isError: false };
    count = Math.max(1, Math.floor(count / 2));
  }
};

export type PageArgs = { readonly limit: number; readonly offset: number };

export const pagedResult = <T>(rows: readonly T[], page: PageArgs, extra: Json = {}): ToolResult =>
  fitToBudget(page.limit, (limit, reduced) => {
    const items = rows.slice(page.offset, page.offset + limit);
    const end = page.offset + items.length;
    const hasMore = end < rows.length;
    return {
      success: true,
      ...extra,
      total: rows.length,
      offset: page.offset,
      returned: items.length,
      has_more: hasMore,
      next_offset: hasMore ? end : null,
      ...(reduced ? { note: `Page shortened to ${limit} items to fit the response size limit.` } : {}),
      results: items,
    };
  });

const isPlaceholderTimestamp = (ts: string): boolean => ts === '' || ts.startsWith('0001-01-01');

/** Invoice list row without SFS transport fields (per-row Status, placeholder timestamps, empty messages). */
export const compactInvoiceRow = (row: Json): Json => {
  const status = Number(row.invoiceStatus ?? 0);
  const message = String(row.message ?? '');
  const timeStamp = String(row.timeStamp ?? '');
  return {
    seria: row.seria,
    number: row.number,
    status,
    status_label: invoiceStatusLabel(status),
    ...(message ? { message } : {}),
    ...(isPlaceholderTimestamp(timeStamp) ? {} : { timestamp: timeStamp }),
  };
};

export const countByStatus = (rows: readonly Json[]): Record<string, number> =>
  rows.reduce<Record<string, number>>((acc, row) => {
    const label = String(row.status_label);
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
