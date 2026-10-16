import { ACTOR_ROLES, describeCodes, INVOICE_STATUSES } from '../domain/codes.js';
import { PAGE_DEFAULT, PAGE_MAX } from './shape.js';

/** Sent in the MCP `initialize` result so a client with no prior context can use the tools correctly. */
export const SERVER_INSTRUCTIONS = `efactura-gateway gives you access to Moldova's SFS e-Factura system (electronic VAT invoices) for the company whose API user signed in.

Codes
- actor_role is the side you look from: ${describeCodes(ACTOR_ROLES)}. For "my sales" use 1, for "my purchases" use 2.
- Invoice status: ${describeCodes(INVOICE_STATUSES)}.
- An invoice is identified by seria (letters, e.g. EAA) plus number.
- Dates are YYYY-MM-DD.

Data volume
- Companies often have thousands of invoices. List tools return one page (default ${PAGE_DEFAULT}, max ${PAGE_MAX}) with total, has_more and next_offset. Narrow with filters (issued_on, buyer_idno, supplier_idno, number) before paging, and fetch more pages only when the user needs them.
- Search results include by_status counts over the full result set: use them for "how many" questions instead of paging.
- Unfiltered searches can take 20+ seconds. Pass an issued_on range whenever the user mentions a period.
- Long invoices are trimmed to max_items lines; items_total tells you how many exist.

Safety
- Read tools (search, get, list, taxpayer, job status) are safe to call and retry.
- efactura_post_invoice issues a legally binding fiscal invoice. Call it only after the user confirmed buyer, lines and totals. Always pass idempotency_key (for example the order or CRM id).
- If a post fails with retry_safe=false, SFS may already have registered the invoice. Do not post again: search for it first, and only if it is absent re-post with the same idempotency_key and confirm_absent=true.
- efactura_assign_serials consumes serial numbers in SFS. Call it only when the user is about to issue invoices.

Errors
- Failed calls return success=false with code, message, retry_safe and a hint describing the next step.`;
