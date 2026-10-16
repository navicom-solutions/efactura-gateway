import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import {
  authHeader,
  buildTestApp,
  createFakeQueue,
  createSoapStub,
  FIXTURES,
  samplePostBody,
} from '../test/helpers.js';
import type { InvoiceQueue } from '../queue/invoice-jobs.js';

type Ctx = ReturnType<typeof buildTestApp>;

const ASYNC = { ...authHeader(), prefer: 'respond-async' };

describe('async POST /invoices/new (Prefer: respond-async)', () => {
  const apps: FastifyInstance[] = [];
  const ctxs: Ctx[] = [];

  afterEach(async () => {
    while (apps.length) await apps.pop()?.close();
    while (ctxs.length) ctxs.pop()?.cleanup();
  });

  const setup = (queue: InvoiceQueue | null): Ctx => {
    const ctx = buildTestApp({ soap: createSoapStub(FIXTURES.postOk), queue });
    apps.push(ctx.app);
    ctxs.push(ctx);
    return ctx;
  };

  it('202 with job_id and does not call SOAP inline', async () => {
    const fake = createFakeQueue();
    const { app, soap } = setup(fake.queue);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers: { ...ASYNC, 'idempotency-key': 'async-1' },
      payload: samplePostBody,
    });
    assert.equal(res.statusCode, 202);
    const body = res.json();
    assert.equal(body.code, 'QUEUED');
    assert.match(body.job_id, /^post-[0-9a-f]+$/);
    assert.equal(soap.calls.length, 0);
    assert.equal(fake.enqueued[0]?.idempotencyKey, 'async-1');
  });

  it('re-enqueue with the same key reuses the job', async () => {
    const fake = createFakeQueue();
    const { app } = setup(fake.queue);
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/v1/invoices/new',
        headers: { ...ASYNC, 'idempotency-key': 'async-dup' },
        payload: samplePostBody,
      });
    const first = await send();
    const second = await send();
    assert.equal(first.json().job_id, second.json().job_id);
    assert.equal(second.json().message, 'Already queued');
    assert.equal(fake.enqueued.length, 1);
  });

  it('GET /v1/jobs/:id returns job state; unknown id → 404', async () => {
    const fake = createFakeQueue();
    const { app } = setup(fake.queue);
    const posted = await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers: ASYNC,
      payload: samplePostBody,
    });
    const jobId = posted.json().job_id as string;

    const job = await app.inject({ method: 'GET', url: `/v1/jobs/${jobId}`, headers: authHeader() });
    assert.equal(job.statusCode, 200);
    assert.equal(job.json().results.state, 'waiting');

    const missing = await app.inject({ method: 'GET', url: '/v1/jobs/nope', headers: authHeader() });
    assert.equal(missing.statusCode, 404);
  });

  it('falls back to a synchronous post when the queue is disabled', async () => {
    const { app, soap } = setup(null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers: { ...ASYNC, 'idempotency-key': 'sync-fallback' },
      payload: samplePostBody,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().code, 'POSTED');
    assert.equal(soap.calls.length, 1);
  });

  it('jobs route requires the API key', async () => {
    const { app } = setup(createFakeQueue().queue);
    const res = await app.inject({ method: 'GET', url: '/v1/jobs/x' });
    assert.equal(res.statusCode, 401);
  });
});
