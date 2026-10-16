# efactura-gateway — e-Factura Moldova REST JSON API & MCP Server

**Open-source e-Factura API for Moldova.** `efactura-gateway` turns the SFS e-Factura SOAP
service into a clean **REST/JSON API** and an **MCP server**, so you can issue, search and
track electronic invoices (facturi fiscale electronice) from any language, or let
**Claude, ChatGPT, Cursor and other LLMs** do it for you, without touching SOAP or XML.

Built and open-sourced by **Navicom Solutions Ltd.**

[![CI](https://github.com/navicom-solutions/efactura-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/navicom-solutions/efactura-gateway/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-%E2%89%A522-339933)
![MCP](https://img.shields.io/badge/MCP-server-8A2BE2)

**Keywords:** e-Factura Moldova · eFactura API · e-Factura JSON · e-Factura REST ·
e-Factura MCP · MCP e-Factura · SFS e-Factura integration · factura electronică Moldova ·
API e-Factura SFS · электронная фактура Молдова

---

## Contents

- [Why this exists](#why-this-exists)
- [What you get](#what-you-get)
- [Quick start](#quick-start)
- [REST/JSON API](#using-the-rest-api)
- [e-Factura MCP server for Claude, ChatGPT and LLMs](#using-it-with-claude-chatgpt-and-other-llms)
- [Design principles](#design-principles)
- [FAQ](#faq)
- [Română](#română--pe-scurt)
- [Contributing](#contributing) · [License](#license)

---

## Why this exists

Every business in Moldova that issues VAT invoices has to integrate with
[eFactura](https://e-factura.sfs.md) run by the State Tax Service (SFS). The official
interface is a WCF **SOAP** service with WS-Security headers, deeply nested XML
contracts, and next to no client libraries. In practice that means:

- **Weeks of integration work** before you post your first invoice — hand-built XML
  envelopes, namespace juggling, Romanian-only docs.
- **No usable SDKs** for modern stacks (Node, Python, Go, low-code tools, AI agents).
- **Month-end outages.** The service slows to ~30s responses and drops connections
  under load — often *after* it has already accepted your invoice. Naive retries create
  **duplicate fiscal invoices**, which are painful to cancel.

`efactura-gateway` hides all of that behind a small, predictable JSON API, and makes
writes safe to retry.

## What you get

- **Clean REST/JSON API** for search, get, serial assignment, posting, accepted/rejected
  lists, and taxpayer lookup, with an **OpenAPI 3.1 spec** and interactive docs.
- **Duplicate-proof posting.** Every invoice post goes through an idempotency ledger.
  Upstream timeouts are marked *ambiguous* and are never blindly retried; re-sending the
  same request returns the original result.
- **Smart read retries** with exponential backoff and full jitter for safe operations.
- **Async posting (optional).** `Prefer: respond-async` returns `202` + `job_id`
  instantly; a BullMQ/Redis worker does the slow SOAP call.
- **MCP server for LLMs** at `/mcp`, with OAuth 2.1 + PKCE so each user connects their
  own eFactura account. Works with Claude, ChatGPT connectors, Cursor, and other MCP clients.
- **Multi-tenant.** Use one default SFS account, or pass per-request credentials.
- **Machine-readable errors.** Every response carries `code` and `retry_safe`, so clients
  know whether repeating a call is safe.
- **Production-ready Docker image**, health checks, structured JSON logs (pino).

## Quick start

### Docker

```bash
cp .env.example .env        # set API_KEY, EFACTURA_USERNAME, EFACTURA_PASSWORD
docker compose up --build
curl http://localhost:3000/health
```

Add Redis and async posting with `docker compose --profile queue up --build` and
`QUEUE_ENABLED=true`.

### Node

```bash
npm ci
cp .env.example .env
npm run dev
```

Requires Node.js 22+.

## Using the REST API

```bash
curl -X POST http://localhost:3000/v1/invoices/search \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"actor_role": 1, "status": 8}'
```

**OpenAPI 3.1 spec:** `GET /openapi.json` · **Interactive API reference:** `GET /docs`.
Import the spec into Postman, Insomnia, ChatGPT Actions, or any OpenAPI code generator to
get a typed e-Factura client in your language.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Public |
| GET | `/openapi.json`, `/docs` | Public — OpenAPI spec and API reference |
| POST | `/v1/invoices/search` | Filters: number, serial, external id, IDNOs, date ranges |
| POST | `/v1/invoices/get` | `{ "seria", "number" }` — includes the parsed invoice |
| POST | `/v1/invoices/assign-serials` | `{ "count", "invoiceType" }` |
| POST | `/v1/invoices/new` | Requires `Idempotency-Key` or `additional_information.id` |
| GET | `/v1/jobs/:id` | Status of an async post |
| POST | `/v1/invoices/accepted` | `{ "actor_role": 1\|2\|3 }` |
| POST | `/v1/invoices/rejected` | `{ "actor_role": 1\|2\|3 }` |
| GET | `/v1/taxpayer/:idno` | Taxpayer registry lookup |

Headers:

```http
Authorization: Bearer <API_KEY>
X-Provider-Credentials: <base64(username:password)>   # optional, per-request SFS account
Idempotency-Key: <stable id>                          # POST /invoices/new
Prefer: respond-async                                 # optional, needs QUEUE_ENABLED
X-Confirm-Absent: true                                # only after reconciling an ambiguous post
```

Before posting invoices in production, read [docs/RESILIENCE.md](docs/RESILIENCE.md):
it explains exactly what to do when SFS times out mid-post.

`/api/v1/*` is kept as an alias for clients built against the original PHP gateway.

## Using it with Claude, ChatGPT and other LLMs

### e-Factura MCP server

The gateway is a remote [Model Context Protocol](https://modelcontextprotocol.io) server.
Point your client at `https://<your-host>/mcp`:

```json
{
  "mcpServers": {
    "efactura": { "url": "https://efactura.example.com/mcp" }
  }
}
```

The client discovers the OAuth endpoints automatically. Each user signs in with their own
eFactura credentials on a consent page; those are stored encrypted and never reach the LLM.

Available tools: `efactura_search_invoices`, `efactura_get_invoice`,
`efactura_post_invoice`, `efactura_job_status`, `efactura_assign_serials`,
`efactura_get_taxpayer`, `efactura_list_accepted`, `efactura_list_rejected`.

Example prompts:

- *"Which invoices did suppliers reject this month?"*
- *"Is IDNO 1015600027437 registered for eFactura?"*
- *"Issue an invoice to ACME SRL for 3 hours of consulting at 500 MDL/hour, VAT 20%."*

Server-side scripts can skip OAuth and use `Authorization: Bearer <API_KEY>` on `/mcp`.

## Design principles

The codebase follows the ideas of *Functional Programming in Scala* by Chiusano and
Bjarnason (the "Red Book"), adapted to TypeScript:

- **Errors are values.** Fallible work returns `Either<AppError, A>`
  ([src/fp/result.ts](src/fp/result.ts)) instead of throwing. Every failure is typed,
  carries an HTTP status, and says whether it is safe to retry.
- **Pure core, effects at the edges.** XML building, parsing and validation are pure
  functions. Network, SQLite and Redis live behind small interfaces.
- **Explicit dependencies.** Services are plain functions that receive their
  collaborators (`SoapClient`, `IdempotencyStore`, `InvoiceQueue`), so tests swap in
  fakes without mocking frameworks.
- **Make illegal states unrepresentable.** Inputs are parsed with Zod at the boundary;
  past that point, the types guarantee valid data.
- **Total, explicit write semantics.** A write is *succeeded*, *failed*, or *ambiguous* —
  never "probably fine".

```text
src/
  config/     env parsing (Zod)
  domain/     types, schemas, typed errors
  fp/         Either and combinators
  soap/       envelope, client, backoff, response parsers
  xml/        invoice XML builder/parser (pure)
  services/   invoice use-cases + idempotency ledger
  queue/      BullMQ async posts
  oauth/      OAuth 2.1 server, encrypted credential store
  mcp/        MCP JSON-RPC endpoint + tools
  http/       Fastify app and routes
```

## Configuration

All settings come from environment variables; see [.env.example](.env.example). The
important ones:

| Variable | Purpose |
|----------|---------|
| `API_KEY` | Bearer key for REST (and server-side MCP) |
| `EFACTURA_USERNAME` / `EFACTURA_PASSWORD` | Default SFS account |
| `PUBLIC_URL` | External URL, used for OAuth metadata |
| `ENCRYPTION_KEY` / `TOKEN_SIGNING_KEY` | Required in production for MCP/OAuth and the queue |
| `QUEUE_ENABLED` / `REDIS_URL` | Async posting |
| `MCP_ENABLED` | Toggle `/mcp` and OAuth routes |

Security model: [docs/SECURITY.md](docs/SECURITY.md).

## Development

```bash
npm run typecheck
npm test                  # unit + HTTP inject tests, no network needed
SMOKE=1 SMOKE_BASE_URL=http://127.0.0.1:3000/v1 SMOKE_API_KEY=... npm test   # live smoke
```

## FAQ

### What is e-Factura in Moldova?

e-Factura is the national electronic invoicing system of the Republic of Moldova, operated by
the State Tax Service (Serviciul Fiscal de Stat, SFS). VAT payers use it to issue, sign,
accept and reject fiscal invoices (facturi fiscale) electronically.

### Is there a REST or JSON API for e-Factura?

Not officially. SFS exposes only a SOAP web service. `efactura-gateway` gives you an
e-Factura **REST API with JSON** requests and responses that you self-host in front of the
official service.

### Can I use e-Factura with Claude, ChatGPT or other AI assistants?

Yes. The built-in **e-Factura MCP server** (`/mcp`) lets any client that supports the Model
Context Protocol search invoices, look up taxpayers and issue invoices through natural
language. Each user authorizes with their own e-Factura account via OAuth.

### Which programming languages can I use?

Any language that can send HTTP requests: JavaScript/TypeScript, Python, PHP, C#, Java, Go,
1C, low-code platforms like n8n, Make and Zapier, or plain `curl`.

### How does it prevent duplicate invoices when SFS times out?

Every post requires an idempotency key. If SFS times out mid-request, the post is marked
*ambiguous* and is never retried automatically; sending the same request again returns the
stored result. See [docs/RESILIENCE.md](docs/RESILIENCE.md).

### Is this an official SFS product?

No. It is an independent open-source project by Navicom Solutions Ltd. It uses the public
SFS e-Factura web service with your own credentials.

### Can I connect several companies (multi-tenant)?

Yes. Configure a default account, or send per-request credentials with the
`X-Provider-Credentials` header. MCP users each connect their own account.

## Română — pe scurt

**efactura-gateway** este un API REST/JSON open-source și un server MCP pentru sistemul
**e-Factura Moldova** (SFS). În loc să integrați serviciul SOAP oficial, trimiteți cereri
JSON simple pentru a emite, căuta și urmări facturi fiscale electronice, sau conectați
e-Factura direct la **Claude, ChatGPT** și alți asistenți AI prin MCP.

- Integrare e-Factura în câteva minute, din orice limbaj de programare
- Protecție împotriva facturilor duplicate la timeout-urile SFS de la sfârșit de lună
- Server MCP e-Factura cu autentificare OAuth pentru fiecare utilizator
- Găzduire proprie cu Docker; licență AGPL-3.0, licență comercială disponibilă

Dezvoltat și publicat open-source de **Navicom Solutions Ltd.**

## Contributing

PRs are welcome. We hold contributions to the same standard as the existing code:
typed errors as values, no hidden side effects, tests for every behavior change. Read
[CONTRIBUTING.md](CONTRIBUTING.md) for the PR format before opening one.

## License

`efactura-gateway` is licensed under the **GNU AGPL-3.0** ([LICENSE](LICENSE)). You can use,
modify and self-host it freely. If you offer a modified version as a network service,
you must publish your changes under the same license.

Need to embed it in a closed-source product or offer it as a hosted service without
AGPL obligations? Commercial licenses and support are available from Navicom Solutions Ltd.

## About

Navicom Solutions Ltd. builds software. We open-sourced
`efactura-gateway` so that local companies, accountants and developers can adopt
e-invoicing faster, and plug it straight into the AI tools they already use.

If `efactura-gateway` saves you time, please ⭐ the repository so other Moldovan
developers can find it.

*Not affiliated with or endorsed by the State Tax Service of the Republic of Moldova.
"e-Factura" is a service of SFS.*
