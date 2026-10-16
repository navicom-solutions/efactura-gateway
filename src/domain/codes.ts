/** SFS e-Factura enumerations (ActorRole, InvoiceStatus) with English labels. */

export const ACTOR_ROLES = {
  1: 'supplier',
  2: 'buyer',
  3: 'transporter',
} as const satisfies Record<number, string>;

export const INVOICE_STATUSES = {
  0: 'draft',
  1: 'signed by supplier',
  2: 'rejected by buyer',
  3: 'accepted by buyer',
  5: 'cancelled by supplier',
  6: 'archived',
  7: 'sent to buyer',
  8: 'signed by buyer',
  10: 'transported',
} as const satisfies Record<number, string>;

export const invoiceStatusLabel = (code: number): string =>
  (INVOICE_STATUSES as Record<number, string>)[code] ?? 'unknown';

/** "1 = supplier, 2 = buyer, …" for tool descriptions and instructions. */
export const describeCodes = (codes: Record<number, string>): string =>
  Object.entries(codes)
    .map(([code, label]) => `${code} = ${label}`)
    .join(', ');
