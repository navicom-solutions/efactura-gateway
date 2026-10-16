import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Env } from '../config/env.js';
import {
  decrypt,
  encrypt,
  nowSeconds,
  randomId,
  safeEqual,
  verifyPkceS256,
} from './crypto.js';
import { renderConsentPage, renderErrorPage } from './consent.js';
import type { OAuthStore } from './store.js';
import type { CredentialCheck, CredentialVerifier } from './verify-credentials.js';

const ACCESS_PREFIX = 'efat_at_';

const CREDENTIAL_ERRORS: Record<Exclude<CredentialCheck, 'valid'>, { message: string; invalid: boolean }> = {
  rejected: { message: 'Incorrect username or password.', invalid: true },
  unavailable: { message: "Couldn't reach e-Factura. Please try again in a moment.", invalid: false },
};
const REFRESH_PREFIX = 'efat_rt_';
const DEFAULT_SCOPE = 'efactura:read efactura:write';

export const mcpResourceUrl = (env: Env): string => `${env.PUBLIC_URL.replace(/\/$/, '')}/mcp`;

export const registerOAuthRoutes = (
  app: FastifyInstance,
  env: Env,
  store: OAuthStore,
  verifyCredentials: CredentialVerifier,
): void => {
  const issuer = env.PUBLIC_URL.replace(/\/$/, '');
  const resource = mcpResourceUrl(env);

  const asMeta = () => ({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    scopes_supported: DEFAULT_SCOPE.split(' '),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  });

  const prMeta = () => ({
    resource,
    authorization_servers: [issuer],
    scopes_supported: DEFAULT_SCOPE.split(' '),
    bearer_methods_supported: ['header'],
    resource_name: 'eFactura MCP',
  });

  const serveJson = (reply: FastifyReply, payload: unknown) =>
    reply.header('Cache-Control', 'public, max-age=300').header('Access-Control-Allow-Origin', '*').send(payload);

  app.get('/.well-known/oauth-authorization-server', async (_req, reply) => serveJson(reply, asMeta()));
  app.get('/.well-known/openid-configuration', async (_req, reply) => serveJson(reply, asMeta()));
  app.get('/.well-known/oauth-protected-resource', async (_req, reply) => serveJson(reply, prMeta()));
  app.get('/.well-known/oauth-protected-resource/mcp', async (_req, reply) => serveJson(reply, prMeta()));
  app.get('/oauth/authorization-server', async (_req, reply) => serveJson(reply, asMeta()));
  app.get('/oauth/protected-resource', async (_req, reply) => serveJson(reply, prMeta()));

  app.get('/connect', async (_req, reply) => {
    reply.type('text/html').send(
      renderConsentPage({
        publicUrl: issuer,
        clientName: 'Manual connect',
        clientId: 'manual',
        redirectUri: `${issuer}/connect/done`,
        state: 'manual',
        codeChallenge: 'manual',
        codeChallengeMethod: 'S256',
        scope: DEFAULT_SCOPE,
        resource,
        error: 'Use an MCP client (Claude/Cursor) to start OAuth. This page is informational.',
      }),
    );
  });

  app.post('/register', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      return reply.status(400).send({ error: 'invalid_redirect_uri', error_description: 'redirect_uris required' });
    }
    const clientId = randomId(16);
    const client = store.createClient({
      client_id: clientId,
      client_secret_hash: null,
      client_name: typeof body.client_name === 'string' ? body.client_name : 'MCP Client',
      redirect_uris: redirectUris.map(String),
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
      scope: DEFAULT_SCOPE,
    });
    return reply.status(201).send({
      client_id: client.client_id,
      client_id_issued_at: client.created_at,
      redirect_uris: client.redirect_uris,
      grant_types: client.grant_types,
      token_endpoint_auth_method: 'none',
      client_name: client.client_name,
    });
  });

  app.get('/authorize', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const clientId = q.client_id ?? '';
    const redirectUri = q.redirect_uri ?? '';
    const state = q.state ?? '';
    const challenge = q.code_challenge ?? '';
    const method = q.code_challenge_method ?? 'S256';
    const scope = q.scope ?? DEFAULT_SCOPE;
    const res = q.resource ?? resource;

    const client = store.getClient(clientId);
    if (!client || !client.redirect_uris.includes(redirectUri)) {
      return reply
        .type('text/html')
        .status(400)
        .send(renderErrorPage('Invalid client', 'Unknown client_id or redirect_uri.'));
    }
    if (method !== 'S256' || !challenge) {
      return reply.type('text/html').status(400).send(renderErrorPage('PKCE required', 'S256 code_challenge required.'));
    }

    return reply.type('text/html').send(
      renderConsentPage({
        publicUrl: issuer,
        clientName: client.client_name ?? clientId,
        clientId,
        redirectUri,
        state,
        codeChallenge: challenge,
        codeChallengeMethod: method,
        scope,
        resource: res,
      }),
    );
  });

  app.post('/authorize', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const client = store.getClient(body.client_id ?? '');
    if (!client || !client.redirect_uris.includes(body.redirect_uri ?? '')) {
      return reply.type('text/html').status(400).send(renderErrorPage('Invalid client', 'Bad client or redirect.'));
    }
    const username = (body.username ?? '').trim();
    const password = body.password ?? '';
    const retryConsent = ({ message, invalid }: { message: string; invalid: boolean }) =>
      reply.type('text/html').send(
        renderConsentPage({
          publicUrl: issuer,
          clientName: client.client_name ?? client.client_id,
          clientId: body.client_id,
          redirectUri: body.redirect_uri,
          state: body.state ?? '',
          codeChallenge: body.code_challenge,
          codeChallengeMethod: body.code_challenge_method ?? 'S256',
          scope: body.scope ?? DEFAULT_SCOPE,
          resource: body.resource ?? resource,
          username,
          error: message,
          invalid,
        }),
      );
    if (!username || !password) {
      return retryConsent({ message: 'Enter your username and password.', invalid: true });
    }

    const check = await verifyCredentials({ username, password });
    if (check !== 'valid') return retryConsent(CREDENTIAL_ERRORS[check]);

    const conn = store.createConnection(username, encrypt(password, env.ENCRYPTION_KEY), username);
    const code = randomId(24);
    store.saveAuthCode(
      {
        code,
        client_id: client.client_id,
        connection_id: conn.id,
        redirect_uri: body.redirect_uri,
        code_challenge: body.code_challenge,
        code_challenge_method: body.code_challenge_method ?? 'S256',
        scope: body.scope ?? DEFAULT_SCOPE,
        resource: body.resource ?? resource,
        expires_at: nowSeconds() + 600,
      },
      env.TOKEN_SIGNING_KEY,
    );

    const u = new URL(body.redirect_uri);
    u.searchParams.set('code', code);
    if (body.state) u.searchParams.set('state', body.state);
    u.searchParams.set('iss', issuer);
    return reply.redirect(u.toString());
  });

  app.post('/token', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const grant = body.grant_type;

    if (grant === 'authorization_code') {
      const codeRow = store.consumeAuthCode(body.code ?? '', env.TOKEN_SIGNING_KEY);
      if (!codeRow) {
        return reply.status(400).send({ error: 'invalid_grant', error_description: 'Invalid or expired code' });
      }
      if (codeRow.client_id !== body.client_id || codeRow.redirect_uri !== body.redirect_uri) {
        return reply.status(400).send({ error: 'invalid_grant', error_description: 'client/redirect mismatch' });
      }
      if (!verifyPkceS256(body.code_verifier ?? '', codeRow.code_challenge)) {
        return reply.status(400).send({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
      }
      return issueTokens(reply, env, store, codeRow.client_id, codeRow.connection_id, codeRow.scope, codeRow.resource ?? resource);
    }

    if (grant === 'refresh_token') {
      const rt = body.refresh_token ?? '';
      const row = store.getRefreshToken(rt, env.TOKEN_SIGNING_KEY);
      if (!row) {
        return reply.status(400).send({ error: 'invalid_grant', error_description: 'Invalid refresh token' });
      }
      store.revokeRefreshToken(rt, env.TOKEN_SIGNING_KEY);
      return issueTokens(reply, env, store, row.client_id, row.connection_id, row.scope, row.resource ?? resource);
    }

    return reply.status(400).send({ error: 'unsupported_grant_type' });
  });
};

const issueTokens = (
  reply: FastifyReply,
  env: Env,
  store: OAuthStore,
  clientId: string,
  connectionId: string,
  scope: string | null,
  resource: string,
) => {
  const access = ACCESS_PREFIX + randomId(24);
  const refresh = REFRESH_PREFIX + randomId(24);
  const now = nowSeconds();
  store.saveAccessToken(
    access,
    {
      connection_id: connectionId,
      client_id: clientId,
      scope,
      resource,
      expires_at: now + env.ACCESS_TOKEN_TTL_SECONDS,
    },
    env.TOKEN_SIGNING_KEY,
  );
  store.saveRefreshToken(
    refresh,
    {
      connection_id: connectionId,
      client_id: clientId,
      scope,
      resource,
      expires_at: now + env.REFRESH_TOKEN_TTL_SECONDS,
    },
    env.TOKEN_SIGNING_KEY,
  );
  store.touchConnection(connectionId);
  return reply.send({
    access_token: access,
    token_type: 'Bearer',
    expires_in: env.ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh,
    scope: scope ?? DEFAULT_SCOPE,
  });
};

export type ResolvedMcpAuth =
  | { ok: true; creds: { username: string; password: string } }
  | { ok: false; description: string };

export const resolveMcpBearer = (
  env: Env,
  store: OAuthStore,
  authorization: string | undefined,
): ResolvedMcpAuth => {
  const raw = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!raw) return { ok: false, description: 'Missing bearer token' };

  // Gateway API key may call MCP tools with default env credentials
  if (safeEqual(raw, env.API_KEY)) {
    if (!env.EFACTURA_USERNAME || !env.EFACTURA_PASSWORD) {
      return { ok: false, description: 'API key auth requires default EFACTURA_USERNAME/PASSWORD' };
    }
    return { ok: true, creds: { username: env.EFACTURA_USERNAME, password: env.EFACTURA_PASSWORD } };
  }

  if (!raw.startsWith(ACCESS_PREFIX)) {
    return { ok: false, description: 'Invalid token' };
  }
  const row = store.getAccessToken(raw, env.TOKEN_SIGNING_KEY);
  if (!row) return { ok: false, description: 'Invalid or expired access token' };
  const conn = store.getConnection(row.connection_id);
  if (!conn) return { ok: false, description: 'Connection not found' };
  store.touchConnection(conn.id);
  return {
    ok: true,
    creds: { username: conn.username, password: decrypt(conn.password_encrypted, env.ENCRYPTION_KEY) },
  };
};

export const sendMcpUnauthorized = (reply: FastifyReply, env: Env, description?: string) => {
  const meta = `${env.PUBLIC_URL.replace(/\/$/, '')}/.well-known/oauth-protected-resource/mcp`;
  reply
    .header(
      'WWW-Authenticate',
      `Bearer resource_metadata="${meta}", scope="${DEFAULT_SCOPE}"${description ? `, error="invalid_token", error_description="${description.replace(/"/g, "'")}"` : ''}`,
    )
    .status(401)
    .send({ error: 'unauthorized', error_description: description ?? 'Authentication required' });
};
