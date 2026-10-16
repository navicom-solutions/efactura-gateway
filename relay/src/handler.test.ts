import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handle, LIMITS, type RelayDeps, type ReportStore, type StoredReport } from './handler.js';
import { formatReport, telegramNotifier } from './notify.js';

const memoryStore = (): ReportStore & { rows: StoredReport[] } => {
  const rows: StoredReport[] = [];
  return {
    rows,
    countSince: async (field, value, since) => rows.filter((r) => r[field] === value && r.received_at >= since).length,
    findDuplicate: async (instance, summary, since) =>
      rows.find((r) => r.instance === instance && r.summary.toLowerCase() === summary.toLowerCase() && r.received_at >= since)
        ?.id ?? null,
    insert: async (r) => void rows.push(r),
    recent: async (limit) => [...rows].reverse().slice(0, limit),
  };
};

const setup = (overrides: Partial<RelayDeps> = {}) => {
  const store = memoryStore();
  const notified: StoredReport[] = [];
  const deferred: Array<Promise<unknown>> = [];
  let seq = 0;
  const deps: RelayDeps = {
    store,
    notifiers: [async (r) => void notified.push(r)],
    adminToken: 'admin-secret',
    now: () => new Date('2026-10-16T10:00:00Z'),
    newId: () => `R-${++seq}`,
    hash: async (v) => `h-${v}`,
    defer: (work) => void deferred.push(work),
    log: () => undefined,
    ...overrides,
  };
  return { deps, store, notified, settle: () => Promise.all(deferred) };
};

const report = (overrides: Record<string, unknown> = {}) => ({
  kind: 'bug',
  summary: 'search ignores buyer_idno',
  details: 'Buyer 1003600012345 appeared anyway',
  gateway_version: '1.1.0',
  instance: '0123456789abcdef',
  ...overrides,
});

const post = (body: unknown, ip = '1.2.3.4') =>
  new Request('https://relay.test/v1/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('feedback relay', () => {
  it('stores a masked report, notifies and returns its id', async () => {
    const { deps, store, notified, settle } = setup();
    const res = await handle(post(report()), deps);
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { id: 'R-1', duplicate: false });
    await settle();
    assert.equal(store.rows[0]?.details, 'Buyer [idno] appeared anyway');
    assert.equal(store.rows[0]?.ip_hash, 'h-1.2.3.4');
    assert.equal(notified[0]?.id, 'R-1');
  });

  it('rejects malformed, oversized and invalid bodies', async () => {
    const { deps, store } = setup();
    for (const body of ['not json', report({ kind: 'spam' }), report({ details: 'x'.repeat(LIMITS.bodyBytes) })]) {
      assert.equal((await handle(post(body), deps)).status, 400);
    }
    assert.equal(store.rows.length, 0);
  });

  it('returns the existing id for a duplicate without notifying again', async () => {
    const { deps, notified, settle } = setup();
    await handle(post(report()), deps);
    const res = await handle(post(report({ summary: 'Search ignores BUYER_IDNO' })), deps);
    assert.deepEqual(await res.json(), { id: 'R-1', duplicate: true });
    await settle();
    assert.equal(notified.length, 1);
  });

  it('rate-limits per instance and per IP', async () => {
    const { deps } = setup();
    for (let i = 0; i < LIMITS.perInstancePerDay; i++) {
      assert.equal((await handle(post(report({ summary: `problem number ${i}` })), deps)).status, 201);
    }
    assert.equal((await handle(post(report({ summary: 'one more problem' })), deps)).status, 429);

    const byIp = setup();
    for (let i = 0; i < LIMITS.perIpPerDay; i++) {
      const instance = i.toString(16).padStart(16, '0');
      await handle(post(report({ instance, summary: `problem number ${i}` })), byIp.deps);
    }
    const res = await handle(post(report({ instance: 'ffffffffffffffff', summary: 'new one' })), byIp.deps);
    assert.equal(res.status, 429);
  });

  it('keeps the report when a notifier fails', async () => {
    const logged: string[] = [];
    const { deps, store, settle } = setup({
      notifiers: [async () => Promise.reject(new Error('telegram down'))],
      log: (msg) => void logged.push(msg),
    });
    assert.equal((await handle(post(report()), deps)).status, 201);
    await settle();
    assert.equal(store.rows.length, 1);
    assert.deepEqual(logged, ['notify failed']);
  });

  it('lists reports only with the admin token', async () => {
    const { deps } = setup();
    await handle(post(report()), deps);
    const list = (token?: string) =>
      handle(
        new Request('https://relay.test/v1/reports?limit=5', {
          headers: token ? { authorization: `Bearer ${token}` } : {},
        }),
        deps,
      );
    assert.equal((await list()).status, 401);
    assert.equal((await list('wrong')).status, 401);
    const ok = await list('admin-secret');
    assert.equal(((await ok.json()) as { reports: unknown[] }).reports.length, 1);
    assert.equal((await handle(new Request('https://relay.test/v1/reports'), { ...deps, adminToken: undefined })).status, 401);
  });

  it('formats a readable notification and posts it to Telegram', async () => {
    const { deps, store } = setup();
    await handle(post(report({ tool: 'efactura_search_invoices', error_code: 'UPSTREAM_TIMEOUT' })), deps);
    const stored = store.rows[0]!;
    const text = formatReport(stored);
    assert.match(text, /^efactura-gateway Bug: search ignores buyer_idno\n\nBuyer \[idno\] appeared anyway\n\nTool: efactura_search_invoices · Error: UPSTREAM_TIMEOUT\n/);
    assert.match(text, /Report R-1$/);

    const calls: Array<{ url: string; body: { chat_id: string; text: string } }> = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response('{}');
    }) as typeof fetch;
    await telegramNotifier('BOT', '42', fakeFetch)(stored);
    assert.equal(calls[0]?.url, 'https://api.telegram.org/botBOT/sendMessage');
    assert.deepEqual([calls[0]?.body.chat_id, calls[0]?.body.text], ['42', text]);
  });
});
