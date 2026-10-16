# Security model

## Gateway auth (REST)

- Callers authenticate with `Authorization: Bearer <API_KEY>` (constant-time comparison).
- Optional `X-Provider-Credentials: base64(username:password)` overrides the SFS SOAP
  credentials for that request only (multi-tenant mode). Credentials are never logged.

## MCP auth (`/mcp`)

- OAuth 2.1 authorization code flow with **PKCE S256 required**, dynamic client
  registration (`/register`), and discovery via `/.well-known/oauth-authorization-server`
  and `/.well-known/oauth-protected-resource`.
- The consent page collects the user's own SFS eFactura credentials. They are stored
  AES-256-GCM encrypted (`ENCRYPTION_KEY`); tokens, codes and refresh tokens are stored
  only as HMAC-SHA256 hashes (`TOKEN_SIGNING_KEY`).
- Authorization codes are single-use (10 min). Refresh tokens rotate on every use.
- The gateway `API_KEY` is also accepted on `/mcp` and maps to the default
  `EFACTURA_USERNAME` / `EFACTURA_PASSWORD`.

## Async queue

- Jobs carry SFS credentials AES-256-GCM encrypted at rest in Redis.
- Jobs run with `attempts: 1`; a failed or ambiguous post is never retried automatically.

## Public endpoints

- `GET /health`, `GET /v1/health`, `GET /api/v1/health`
- `GET /openapi.json`, `GET /docs`
- OAuth discovery, `/register`, `/authorize`, `/token`

Everything under `/v1` and `/api/v1` requires the API key.

## Operational guidance

- Never commit `.env`. Generate keys with `openssl rand -hex 32`.
- `ENCRYPTION_KEY` and `TOKEN_SIGNING_KEY` are mandatory when `NODE_ENV=production`.
  Rotating `ENCRYPTION_KEY` invalidates stored MCP connections.
- Bind to loopback and terminate TLS at a reverse proxy.
- Rate limiting is not built in; apply it at the proxy, especially on `/authorize` and `/token`.

## Reporting a vulnerability

Use GitHub's private **"Report a vulnerability"** button on the repository's Security tab.
Please do not open public issues for security reports. We aim to respond within 3 business days.
