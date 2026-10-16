# Contributing to efactura-gateway

Thanks for contributing to efactura-gateway. This project handles
fiscal documents, so we review for correctness first and style second.

## Before you start

- **Bugs:** open an issue with steps to reproduce, the request you sent (with credentials
  removed), and the response.
- **Features:** open an issue first so we can agree on the approach. Unrequested large
  refactors are usually declined.
- **Security issues:** do not open a public issue; see [docs/SECURITY.md](docs/SECURITY.md).

## Coding standards

We follow the *Functional Programming in Scala* ("Red Book") style described in the
README. Concretely, a PR is expected to:

1. **Return errors as values.** Fallible functions return `Either<AppError, A>`. Do not
   `throw` for expected failures; reserve exceptions for programmer errors.
2. **Keep the core pure.** XML, parsing, validation and mapping code must not do I/O.
   Effects go through injected interfaces (`SoapClient`, `IdempotencyStore`, `InvoiceQueue`).
3. **Never auto-retry writes.** Anything that can create an invoice must go through the
   idempotency ledger and must treat timeouts as ambiguous.
4. **Validate at the boundary** with Zod; don't re-check types deeper in.
5. **Stay small and focused** (DRY, single responsibility). One concern per PR; don't
   reformat or refactor unrelated code.
6. **Match the surrounding code**: naming, file layout, comment density. Comments explain
   constraints the code can't show, not what the next line does.
7. **No new dependencies** without discussing them in the issue first.

## Tests

- Every behavior change needs a test. Use `node:test` and Fastify `inject`; fake SOAP with
  `createSoapStub` from `src/test/helpers.ts`. Tests must not hit the network.
- `npm run typecheck` and `npm test` must pass. CI runs both.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(invoices): support credit-note creation motive
fix(soap): treat HTML error pages as parse errors
docs: clarify X-Confirm-Absent flow
```

## Pull request format

Title in Conventional Commit form. The description must use this template (pre-filled
from `.github/pull_request_template.md`):

```markdown
## What
One or two sentences on the change.

## Why
The problem it solves; link the issue (Closes #123).

## How
Key design decisions, especially around error handling and side effects.

## Upstream impact
Does this change what is sent to SFS? Could it create, alter or duplicate invoices?

## Tests
- [ ] Added/updated tests covering the change
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Verified against SFS test environment (if upstream behavior changed)
```

PRs that skip the template or fail CI won't be reviewed until fixed.

## License of contributions

By submitting a PR you agree that your contribution is licensed under the project's
AGPL-3.0 license, and you grant Navicom Solutions Ltd. the right to also distribute it
under a commercial license. This lets us keep offering commercial licenses that fund
development. If you can't agree to this, please say so in the PR before we review it.
