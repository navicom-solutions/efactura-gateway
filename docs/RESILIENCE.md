# Resilience & idempotency

Moldova's SFS eFactura SOAP endpoint is often overloaded at month-end: HTTP 500s,
~30s stalls, and responses that never arrive **after** the invoice was already
accepted. Blind retries create **duplicate invoices**.

## Rules baked into this service

| Operation | Auto-retry / backoff | On timeout / 5xx |
|-----------|----------------------|------------------|
| Search / get / taxpayer / accepted / rejected / assign-serials | Yes (exponential + full jitter) | Safe to retry |
| `POST /v1/invoices/new` | **Never** | Marked `retry_safe: false`, ledger status `ambiguous` |

## Required for POST

1. Send `Idempotency-Key: <stable-key>` **or** set `documents[].additional_information.id` (your external id).
2. On `504` with `code: UPSTREAM_TIMEOUT_AMBIGUOUS` / `WRITE_AMBIGUOUS`:
   - **Do not** POST again yet
   - Search / get by external id or serial
   - If found → treat as success (a replay returns the cached body once the ledger has `succeeded`)
   - If confirmed absent → POST again with the **same** key and header `X-Confirm-Absent: true`
3. Same key + different body → `409 IDEMPOTENCY_CONFLICT`

## Async posts

With `QUEUE_ENABLED=true`, send `Prefer: respond-async` to get `202` + `job_id`
immediately, then poll `GET /v1/jobs/:id`. The job runs through the same ledger, so the
rules above still apply; re-sending the same key returns the existing job.

## Response fields

Error envelopes include:

- `retry_safe` — whether the client may repeat the exact call
- `code` — machine-readable reason (`UPSTREAM_TIMEOUT_AMBIGUOUS`, etc.)

## Ledger

SQLite at `DATABASE_PATH`. Mount it on a persistent volume so it survives container rebuilds.
