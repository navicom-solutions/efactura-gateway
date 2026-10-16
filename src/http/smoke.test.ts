/**
 * Live upstream smoke — skipped unless SMOKE=1.
 *
 * Requires a running stack or reachable PUBLIC_URL with real credentials:
 *   SMOKE=1 SMOKE_BASE_URL=https://efactura.example.com/v1 \
 *   SMOKE_API_KEY=... SMOKE_IDNO=1015600027437 npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.SMOKE === '1';
const base = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000/v1').replace(/\/$/, '');
const apiKey = process.env.SMOKE_API_KEY ?? process.env.API_KEY ?? '';
const idno = process.env.SMOKE_IDNO ?? '1015600027437';

const authHeaders = (): Record<string, string> => ({
  authorization: `Bearer ${apiKey}`,
  'content-type': 'application/json',
});

describe('live smoke (SMOKE=1)', { skip: !enabled }, () => {
  it('health', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok?: boolean };
    assert.equal(body.ok, true);
  });

  it('taxpayer lookup', async () => {
    assert.ok(apiKey, 'SMOKE_API_KEY or API_KEY required');
    const res = await fetch(`${base}/taxpayer/${idno}`, { headers: authHeaders() });
    assert.ok(res.status === 200 || res.status === 404, `unexpected ${res.status}`);
    const body = (await res.json()) as { requestId?: string; request_id?: string };
    assert.ok(body.requestId || body.request_id);
  });

  it('search (read-only)', async () => {
    assert.ok(apiKey, 'SMOKE_API_KEY or API_KEY required');
    const res = await fetch(`${base}/invoices/search`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ actor_role: 1, status: 8 }),
    });
    assert.ok([200, 400, 503, 504].includes(res.status), `unexpected ${res.status}`);
    const body = (await res.json()) as { success?: boolean; retry_safe?: boolean };
    if (!body.success && res.status >= 500) {
      assert.equal(body.retry_safe, true, 'read failures must be retry_safe');
    }
  });
});
