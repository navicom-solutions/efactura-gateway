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
- [Contributing](#contributing) · [Disclaimer](#disclaimer) · [License](#license)

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

### eFactura API credentials

The gateway signs in to SFS with an **eFactura API user**, not your personal login.
Create one once per company:

1. Log in to [efactura.sfs.md](https://efactura.sfs.md).
2. Open **Setări → Utilizatorii Companiei**
   ([direct link](https://efactura.sfs.md/default.aspx#MySettings/CompanyUsers)) and click
   **Creează utilizator API**.
3. Fill in email, username and password, choose the **API User** role, and register.

Use that username and password:

- **Claude, ChatGPT and other MCP clients:** on the *Connect Moldova eFactura* page that
  opens when you connect (see below). Nothing is configured on the server.
- **REST API:** per request in the `X-Provider-Credentials` header, or once on the server
  as `EFACTURA_USERNAME` / `EFACTURA_PASSWORD`.

### One-click deploy (no coding needed)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/navicom-solutions/efactura-gateway)

You need: an [eFactura API user](#efactura-api-credentials) and a card for Render (the
Starter instance with a 1 GB disk costs about $7/month at the time of writing).

**1. Deploy the gateway (about 5 minutes)**

1. Click **Deploy to Render** above and sign up (GitHub, Google or email).
2. Render shows the `efactura-gateway` blueprint. Click **Deploy Blueprint**. There is
   nothing to fill in: secrets are generated for you.
3. Wait until the service shows **Live**. Copy its address from the top of the page, for
   example `https://efactura-gateway-abcd.onrender.com`.
4. Check it works: open `https://<your-address>/health` in a browser. You should see
   `"ok":true` and your address as `public_url`.

**2. Connect it to Claude**

1. In [claude.ai](https://claude.ai) open **Settings → Connectors → Add custom connector**
   (custom connectors may require a paid Claude plan).
2. Name it `eFactura` and paste `https://<your-address>/mcp` as the URL. Click **Add**.
3. Click **Connect**. A page titled *Connect Moldova eFactura* opens: enter the
   [API user's](#efactura-api-credentials) username and password, then **Continue**. The
   gateway checks them with SFS before connecting.
4. In a new chat, enable the eFactura connector from the tools menu and ask, for example,
   *"Show invoices rejected this month"*.

Your eFactura password stays on your server, encrypted; Claude only receives invoice data.
Colleagues can add the same URL and sign in with their own API users. ChatGPT,
Cursor and other MCP clients connect the same way using the `/mcp` URL.

**Optional:** to use your own domain, add it under the service's **Settings → Custom
Domains** in Render and set the `PUBLIC_URL` environment variable to it. To let REST
callers use one default eFactura account, set `EFACTURA_USERNAME` and `EFACTURA_PASSWORD`.
The REST API key is in **Environment → `API_KEY`**.

Other hosts work too, as long as `/app/data` is on persistent storage. Avoid platforms
with only an ephemeral filesystem (Heroku, DigitalOcean App Platform): losing the ledger on
redeploy defeats duplicate-invoice protection.

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
`efactura_get_taxpayer`, `efactura_list_accepted`, `efactura_list_rejected`,
`efactura_report_issue`.

On connect, the server sends the assistant usage instructions: what the codes mean, how
to page through large results, and when a confirmation is needed before posting.

Example prompts:

- *"Which invoices did suppliers reject this month?"*
- *"Is IDNO 1015600027437 registered for eFactura?"*
- *"Issue an invoice to ACME SRL for 3 hours of consulting at 500 MDL/hour, VAT 20%."*

Server-side scripts can skip OAuth and use `Authorization: Bearer <API_KEY>` on `/mcp`.

### Issue reports from the assistant

When a tool fails or a feature is missing, the assistant can offer to send a short report
to the maintainers with `efactura_report_issue`. It shows you the report first and sends
it only after you agree.

- **Sent:** report type, a one-line summary, a short description, the tool name and error
  code, the gateway version, and an anonymous id of your deployment.
- **Never sent:** invoices, SFS responses, credentials or tokens.
- Emails, IDNOs, IBANs, phone numbers, invoice numbers and secrets are masked before
  sending.
- Reports are limited to 10 per deployment per day.
- To turn it off, set `FEEDBACK_ENABLED=false`. The tool then no longer appears.

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
  feedback/   issue report contract, masking, relay client
  http/       Fastify app and routes
relay/        Cloudflare Worker that receives issue reports
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
| `FEEDBACK_ENABLED` / `FEEDBACK_URL` | [Issue reports](#issue-reports-from-the-assistant); `false` opts out |

Security model: [docs/SECURITY.md](docs/SECURITY.md).

## Development

```bash
npm run typecheck
npm test                  # unit + HTTP inject tests, no network needed
SMOKE=1 SMOKE_BASE_URL=http://127.0.0.1:3000/v1 SMOKE_API_KEY=... npm test   # live smoke
```

### Feedback relay

[relay/](relay) is a Cloudflare Worker that stores issue reports in D1 and notifies you by
Telegram and/or email. To run your own (free plan is enough):

```bash
npm ci && cd relay && npm ci
npx wrangler login
npx wrangler d1 create efactura-feedback      # paste database_id into wrangler.toml
npm run migrate
npx wrangler secret put ADMIN_TOKEN           # for GET /v1/reports
npx wrangler secret put TELEGRAM_BOT_TOKEN    # from @BotFather
npx wrangler secret put TELEGRAM_CHAT_ID
npm run deploy
```

Point the gateway at it with `FEEDBACK_URL=https://<worker-host>/v1/reports`. For email,
see the comments in [relay/wrangler.toml](relay/wrangler.toml). List stored reports with
`curl -H "Authorization: Bearer <ADMIN_TOKEN>" https://<worker-host>/v1/reports`.

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

**Instalare fără programare:**

1. Pe [efactura.sfs.md](https://efactura.sfs.md) mergeți la **Setări → Utilizatorii Companiei**
   ([link direct](https://efactura.sfs.md/default.aspx#MySettings/CompanyUsers)) și apăsați
   **Creează utilizator API**: email, utilizator, parolă, rolul **API User**, înregistrați.
2. Apăsați **Deploy to Render** (mai sus), creați un cont și apăsați **Deploy Blueprint**.
3. Când serviciul este **Live**, copiați adresa lui (de ex. `https://efactura-gateway-abcd.onrender.com`).
4. În Claude: **Settings → Connectors → Add custom connector**, adresa `https://<adresa>/mcp`.
5. Apăsați **Connect** și introduceți utilizatorul și parola API de la pasul 1. Gata.

Software-ul este oferit „ca atare”, fără garanții; îl folosiți pe propria răspundere.
Facturile emise prin el au valoare juridică. Detalii în [Disclaimer](#disclaimer).

Dezvoltat și publicat open-source de **Navicom Solutions Ltd.**

## Contributing

PRs are welcome. We hold contributions to the same standard as the existing code:
typed errors as values, no hidden side effects, tests for every behavior change. Read
[CONTRIBUTING.md](CONTRIBUTING.md) for the PR format before opening one.

## Disclaimer

**Use at your own risk.** `efactura-gateway` is provided "as is", without warranty of any
kind, as stated in sections 15–16 of the [license](LICENSE). Navicom Solutions Ltd. is not
liable for invoices issued, rejected, duplicated or lost, for penalties, or for any other
damage resulting from its use.

- Invoices posted through the gateway are legally binding documents. You are responsible
  for their content and for checking them in [efactura.sfs.md](https://efactura.sfs.md).
- AI assistants can make mistakes. Review every invoice an assistant prepares before
  allowing it to post.
- You are responsible for securing your deployment, your API keys and your SFS credentials,
  and for complying with tax and data protection law.
- SFS can change or interrupt its service at any time; the gateway may stop working until
  it is updated.

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
