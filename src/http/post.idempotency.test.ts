import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { upstreamTimeout } from '../domain/errors.js';
import { left, right } from '../fp/result.js';
import {
  authHeader,
  buildTestApp,
  createSoapStub,
  FIXTURES,
  samplePostBody,
  type SoapStub,
} from '../test/helpers.js';

type Ctx = ReturnType<typeof buildTestApp>;

const postWithoutExternalId = (): typeof samplePostBody => {
  const body = structuredClone(samplePostBody);
  const doc = { ...body.documents[0]! };
  Reflect.deleteProperty(doc, 'additional_information');
  return { ...body, documents: [doc] };
};

describe('POST /invoices/new idempotency', () => {
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

  const setup = (soap: SoapStub): Ctx => {
    const ctx = buildTestApp({ soap });
    apps.push(ctx.app);
    ctxs.push(ctx);
    return ctx;
  };

  it('400 when Idempotency-Key and external id are both missing', async () => {
    const soap = createSoapStub(FIXTURES.postOk);
    const { app } = setup(soap);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers: authHeader(),
      payload: postWithoutExternalId(),
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /Idempotency-Key/);
    assert.equal(soap.calls.length, 0);
  });

  it('uses documents[].additional_information.id as key when header absent', async () => {
    const soap = createSoapStub(FIXTURES.postOk);
    const { app } = setup(soap);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers: authHeader(),
      payload: samplePostBody,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(soap.calls.length, 1);
  });

  it('marks write timeout as ambiguous and does not call SOAP again on blind retry', async () => {
    const soap = createSoapStub(FIXTURES.postOk);
    soap.handler = async (meta) => {
      if (meta.isWrite) return left(upstreamTimeout('simulated SFS hang', true));
      return left(upstreamTimeout('n/a', false));
    };
    const { app } = setup(soap);

    const headers = {
      ...authHeader(),
      'idempotency-key': 'amb-key-1',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers,
      payload: samplePostBody,
    });
    assert.equal(first.statusCode, 504);
    assert.equal(first.json().retry_safe, false);
    assert.equal(first.json().code, 'UPSTREAM_TIMEOUT_AMBIGUOUS');
    assert.equal(soap.calls.length, 1);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers,
      payload: samplePostBody,
    });
    assert.equal(second.statusCode, 504);
    assert.equal(second.json().code, 'WRITE_AMBIGUOUS');
    assert.equal(soap.calls.length, 1, 'must not re-post after ambiguous');
  });

  it('replays cached success for the same Idempotency-Key', async () => {
    const soap = createSoapStub(FIXTURES.postOk);
    const { app } = setup(soap);
    const headers = {
      ...authHeader(),
      'idempotency-key': 'ok-key-1',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers,
      payload: samplePostBody,
    });
    assert.equal(first.statusCode, 200);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers,
      payload: samplePostBody,
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().code, 'POSTED');
    assert.equal(soap.calls.length, 1, 'replay must not hit SOAP again');
  });

  it('409 when same key is reused with a different body', async () => {
    const soap = createSoapStub(FIXTURES.postOk);
    const { app } = setup(soap);
    const headers = {
      ...authHeader(),
      'idempotency-key': 'conflict-key',
    };

    await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers,
      payload: samplePostBody,
    });

    const other = structuredClone(samplePostBody);
    other.documents[0]!.notes = 'different body';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers,
      payload: other,
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(soap.calls.length, 1);
  });

  it('X-Confirm-Absent: true reopens ambiguous and allows one more SOAP call', async () => {
    const soap = createSoapStub(FIXTURES.postOk);
    let writes = 0;
    soap.handler = async (meta) => {
      if (meta.isWrite) {
        writes += 1;
        if (writes === 1) return left(upstreamTimeout('first hang', true));
        return right(FIXTURES.postOk);
      }
      return left(upstreamTimeout('n/a', false));
    };
    const { app } = setup(soap);
    const key = 'confirm-absent-1';

    const first = await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers: { ...authHeader(), 'idempotency-key': key },
      payload: samplePostBody,
    });
    assert.equal(first.statusCode, 504);

    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers: { ...authHeader(), 'idempotency-key': key },
      payload: samplePostBody,
    });
    assert.equal(blocked.statusCode, 504);
    assert.equal(soap.calls.length, 1);

    const confirmed = await app.inject({
      method: 'POST',
      url: '/v1/invoices/new',
      headers: {
        ...authHeader(),
        'idempotency-key': key,
        'x-confirm-absent': 'true',
      },
      payload: samplePostBody,
    });
    assert.equal(confirmed.statusCode, 200);
    assert.equal(confirmed.json().code, 'POSTED');
    assert.equal(soap.calls.length, 2);
  });
});
