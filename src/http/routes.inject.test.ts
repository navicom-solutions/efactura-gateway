import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import {
  authHeader,
  buildTestApp,
  createSoapStub,
  FIXTURES,
  samplePostBody,
  type SoapStub,
} from '../test/helpers.js';

type Ctx = ReturnType<typeof buildTestApp>;

describe('HTTP routes (inject)', () => {
  const apps: FastifyInstance[] = [];
  const ctxs: Ctx[] = [];

  afterEach(async () => {
    while (apps.length) {
      const app = apps.pop();
      if (app) await app.close();
    }
    while (ctxs.length) {
      ctxs.pop()?.cleanup();
    }
  });

  const setup = (fixtureXml: string): Ctx => {
    const soap = createSoapStub(fixtureXml);
    const ctx = buildTestApp({ soap });
    apps.push(ctx.app);
    ctxs.push(ctx);
    return ctx;
  };

  it('GET /health is open', async () => {
    const { app } = setup('<ok/>');
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);
  });

  it('rejects missing API key on /v1 routes', async () => {
    const { app } = setup(FIXTURES.searchOk);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invoices/search',
      payload: { actor_role: 1, status: 8 },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().code, 'UNAUTHORIZED');
  });

  it('rejects wrong API key', async () => {
    const { app } = setup(FIXTURES.searchOk);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invoices/search',
      headers: authHeader('wrong'),
      payload: { actor_role: 1, status: 8 },
    });
    assert.equal(res.statusCode, 401);
  });

  it('POST /v1/invoices/search → 200 with serial+seria', async () => {
    const { app } = setup(FIXTURES.searchOk);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invoices/search',
      headers: authHeader(),
      payload: { actor_role: 1, status: 8 },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.results[0].serial, 'EAA');
    assert.equal(body.results[0].seria, 'EAA');
    assert.ok(body.requestId);
    assert.ok(body.request_id);
  });

  it('POST /api/v1/invoices/search alias works', async () => {
    const { app } = setup(FIXTURES.searchOk);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/invoices/search',
      headers: authHeader(),
      payload: { actor_role: 1, status: 8 },
    });
    assert.equal(res.statusCode, 200);
  });

  it('POST /v1/invoices/search → 400 on bad body', async () => {
    const { app } = setup(FIXTURES.searchOk);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invoices/search',
      headers: authHeader(),
      payload: { status: 8 },
    });
    assert.equal(res.statusCode, 400);
  });

  it('POST /v1/invoices/get → 200', async () => {
    const { app } = setup(FIXTURES.getOk);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invoices/get',
      headers: authHeader(),
      payload: { number: '001', seria: 'EAA' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().results[0].seria, 'EAA');
  });

  it('POST /v1/invoices/assign-serials → 200', async () => {
    const { app } = setup(FIXTURES.assignOk);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invoices/assign-serials',
      headers: authHeader(),
      payload: { count: 1 },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().results[0].number, 'SN002');
  });

  it('POST /v1/invoices/accepted → 200', async () => {
    const { app } = setup(FIXTURES.acceptedOk);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invoices/accepted',
      headers: authHeader(),
      payload: { actor_role: 1 },
    });
    assert.equal(res.statusCode, 200);
  });

  it('POST /v1/invoices/rejected → 200', async () => {
    const { app } = setup(FIXTURES.rejectedOk);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invoices/rejected',
      headers: authHeader(),
      payload: { actor_role: 1 },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().total, 1);
  });

  it('GET /v1/taxpayer/:idno → 200', async () => {
    const { app } = setup(FIXTURES.taxpayerOk);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/taxpayer/1015600027437',
      headers: authHeader(),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.idno, '1015600027437');
  });

  it('POST /v1/invoices/new → 200 with Idempotency-Key', async () => {
    const { app, soap } = setup(FIXTURES.postOk);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers: {
        ...authHeader(),
        'idempotency-key': 'test-key-1',
      },
      payload: samplePostBody,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().code, 'POSTED');
    assert.equal((soap as SoapStub).calls.length, 1);
    assert.equal((soap as SoapStub).calls[0]!.meta.isWrite, true);
  });
});
