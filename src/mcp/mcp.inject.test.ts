import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  authHeader,
  buildTestApp,
  createSoapStub,
  FIXTURES,
} from '../test/helpers.js';

type Ctx = ReturnType<typeof buildTestApp>;

const REDIRECT = 'http://127.0.0.1:33418/callback';
const VERIFIER = 'test-verifier-0123456789abcdefghijklmnopqrstuvwxyz';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

const rpc = (method: string, params?: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  id: 1,
  method,
  params,
});

describe('MCP + OAuth (inject)', () => {
  const apps: FastifyInstance[] = [];
  const ctxs: Ctx[] = [];

  afterEach(async () => {
    while (apps.length) await apps.pop()?.close();
    while (ctxs.length) ctxs.pop()?.cleanup();
  });

  const setup = (fixtureXml: string): Ctx => {
    const ctx = buildTestApp({ soap: createSoapStub(fixtureXml) });
    apps.push(ctx.app);
    ctxs.push(ctx);
    return ctx;
  };

  it('401 with WWW-Authenticate resource metadata when unauthenticated', async () => {
    const { app } = setup('<ok/>');
    const res = await app.inject({ method: 'POST', url: '/mcp', payload: rpc('initialize') });
    assert.equal(res.statusCode, 401);
    assert.match(
      String(res.headers['www-authenticate']),
      /resource_metadata=".*\/\.well-known\/oauth-protected-resource\/mcp"/,
    );
  });

  it('serves OAuth discovery metadata', async () => {
    const { app } = setup('<ok/>');
    const as = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' });
    assert.equal(as.statusCode, 200);
    assert.deepEqual(as.json().code_challenge_methods_supported, ['S256']);

    const pr = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/mcp' });
    assert.equal(pr.statusCode, 200);
    assert.match(pr.json().resource, /\/mcp$/);
  });

  it('initialize + tools/list with gateway API key', async () => {
    const { app } = setup('<ok/>');
    const init = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: authHeader(),
      payload: rpc('initialize'),
    });
    assert.equal(init.statusCode, 200);
    assert.ok(init.json().result.protocolVersion);

    const list = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: authHeader(),
      payload: rpc('tools/list'),
    });
    const names = (list.json().result.tools as Array<{ name: string }>).map((t) => t.name);
    assert.ok(names.includes('efactura_post_invoice'));
    assert.ok(names.includes('efactura_get_taxpayer'));
  });

  it('tools/call efactura_get_taxpayer returns taxpayer data', async () => {
    const { app } = setup(FIXTURES.taxpayerOk);
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: authHeader(),
      payload: rpc('tools/call', {
        name: 'efactura_get_taxpayer',
        arguments: { idno: '1015600027437' },
      }),
    });
    const result = res.json().result;
    assert.equal(result.isError, false);
    assert.equal(JSON.parse(result.content[0].text).data.idno, '1015600027437');
  });

  it('unknown JSON-RPC method → -32601', async () => {
    const { app } = setup('<ok/>');
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: authHeader(),
      payload: rpc('nope'),
    });
    assert.equal(res.json().error.code, -32601);
  });

  it('full OAuth PKCE flow issues a token bound to the user SFS credentials', async () => {
    const { app, soap } = setup(FIXTURES.taxpayerOk);

    const reg = await app.inject({
      method: 'POST',
      url: '/register',
      payload: { client_name: 'Test MCP client', redirect_uris: [REDIRECT] },
    });
    assert.equal(reg.statusCode, 201);
    const clientId = reg.json().client_id as string;

    const consent = await app.inject({
      method: 'GET',
      url: `/authorize?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: REDIRECT,
        state: 'st',
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
      })}`,
    });
    assert.equal(consent.statusCode, 200);
    assert.match(consent.body, /<form/);

    const authorize = await app.inject({
      method: 'POST',
      url: '/authorize',
      headers: FORM,
      payload: new URLSearchParams({
        client_id: clientId,
        redirect_uri: REDIRECT,
        state: 'st',
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
        username: 'sfs-user',
        password: 'sfs-pass',
      }).toString(),
    });
    assert.equal(authorize.statusCode, 302);
    const location = new URL(String(authorize.headers.location));
    assert.equal(location.searchParams.get('state'), 'st');
    const code = location.searchParams.get('code') ?? '';
    assert.ok(code);

    const badPkce = await app.inject({
      method: 'POST',
      url: '/token',
      headers: FORM,
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_verifier: 'wrong',
      }).toString(),
    });
    assert.equal(badPkce.statusCode, 400);

    // Codes are single-use, so a failed exchange burns it; run the flow again.
    const authorize2 = await app.inject({
      method: 'POST',
      url: '/authorize',
      headers: FORM,
      payload: new URLSearchParams({
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
        username: 'sfs-user',
        password: 'sfs-pass',
      }).toString(),
    });
    const code2 = new URL(String(authorize2.headers.location)).searchParams.get('code') ?? '';

    const token = await app.inject({
      method: 'POST',
      url: '/token',
      headers: FORM,
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code2,
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
      }).toString(),
    });
    assert.equal(token.statusCode, 200);
    const { access_token: accessToken, refresh_token: refreshToken } = token.json();
    assert.match(accessToken, /^efat_at_/);

    const call = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: rpc('tools/call', {
        name: 'efactura_get_taxpayer',
        arguments: { idno: '1015600027437' },
      }),
    });
    assert.equal(call.statusCode, 200);
    assert.deepEqual(soap.calls.at(-1)?.creds, { username: 'sfs-user', password: 'sfs-pass' });

    const refreshed = await app.inject({
      method: 'POST',
      url: '/token',
      headers: FORM,
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });
    assert.equal(refreshed.statusCode, 200);

    const reuse = await app.inject({
      method: 'POST',
      url: '/token',
      headers: FORM,
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });
    assert.equal(reuse.statusCode, 400, 'refresh tokens rotate');
  });

  it('rejects /authorize for unregistered redirect_uri', async () => {
    const { app } = setup('<ok/>');
    const reg = await app.inject({
      method: 'POST',
      url: '/register',
      payload: { redirect_uris: [REDIRECT] },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/authorize?${new URLSearchParams({
        client_id: reg.json().client_id,
        redirect_uri: 'https://evil.example/cb',
        code_challenge: CHALLENGE,
      })}`,
    });
    assert.equal(res.statusCode, 400);
  });
});
