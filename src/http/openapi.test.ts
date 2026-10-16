import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { buildTestApp } from '../test/helpers.js';

type Ctx = ReturnType<typeof buildTestApp>;
type Spec = {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
};

describe('OpenAPI document', () => {
  const apps: FastifyInstance[] = [];
  const ctxs: Ctx[] = [];

  afterEach(async () => {
    while (apps.length) await apps.pop()?.close();
    while (ctxs.length) ctxs.pop()?.cleanup();
  });

  const setup = (): Ctx => {
    const ctx = buildTestApp();
    apps.push(ctx.app);
    ctxs.push(ctx);
    return ctx;
  };

  it('is public and declares OpenAPI 3.1', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as Spec).openapi, '3.1.0');
  });

  it('documents only routes that exist on the server', async () => {
    const { app } = setup();
    await app.ready();
    const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json() as Spec;
    for (const [path, ops] of Object.entries(spec.paths)) {
      const url = path.replace(/\{(\w+)\}/g, ':$1');
      for (const method of Object.keys(ops)) {
        assert.ok(
          app.hasRoute({ method: method.toUpperCase() as HTTPMethods, url }),
          `${method.toUpperCase()} ${url} is documented but not registered`,
        );
      }
    }
  });

  it('covers every invoice operation', async () => {
    const { app } = setup();
    const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json() as Spec;
    for (const path of [
      '/v1/invoices/search',
      '/v1/invoices/get',
      '/v1/invoices/assign-serials',
      '/v1/invoices/new',
      '/v1/invoices/accepted',
      '/v1/invoices/rejected',
      '/v1/taxpayer/{idno}',
      '/v1/jobs/{id}',
    ]) {
      assert.ok(spec.paths[path], `missing ${path}`);
    }
  });

  it('derives request schemas from the Zod validators', async () => {
    const { app } = setup();
    const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json() as Spec;
    const post = spec.components.schemas.PostInvoiceRequest?.properties ?? {};
    assert.ok('documents' in post);
    assert.ok('actor_role' in post);
  });

  it('serves the interactive reference at /docs', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/docs' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /data-url="\/openapi\.json"/);
  });
});
