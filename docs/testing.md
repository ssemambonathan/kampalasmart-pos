# Testing and verification

Verified on 26 October 2026 against a local production build, seeded PostgreSQL 16 and Redis 7.
All counts below come from actual runs, not estimates.

## Verification matrix

| Suite | Count | Command | Location |
| --- | --- | --- | --- |
| Shared domain unit | 13 | `npm run test:unit -w @kampalasmart/shared` | `packages/shared/src/pricing.spec.ts` |
| API unit | 11 | `npm run test:unit -w @kampalasmart/api` | `apps/api/src/**/*.spec.ts` |
| API integration | 42 | `npm run test:integration` | `apps/api/test/integration/*.e2e-spec.ts` |
| Browser smoke | 3 | `npm run test:e2e` | `apps/web/e2e/smoke.spec.ts` |
| Lint | clean | `npm run lint` | repo-wide ESLint |
| Typecheck | clean | `npm run typecheck` | shared + API + web |
| Production build | success | `npm run build` | shared + API + Next.js |

The integration suite creates and migrates `kampalasmart_test` automatically. It never points at the
development database. Playwright runs against the seeded development database and both running apps.

## Shared unit tests (13)

`packages/shared/src/pricing.spec.ts` covers the money engine used by client and server:

- half-up rounding and canonical decimal serialization; UGX formatting without decimals;
- simple tax-inclusive/exclusive carts, line discounts and exact cart-discount allocation;
- stock checks, negative-stock policy and duplicate-product rejection;
- rejection of invalid quantities and discounts;
- line totals reconciling to the cart total;
- cashier/manager/owner discount caps.

## API unit tests (11)

`apps/api/src/common/auth/auth-guards.spec.ts` (8):

- CSRF guard allows public/safe requests and bearer-authenticated mutations; rejects missing, short
  or mismatched double-submit tokens; accepts a matching token.
- Rate-limit guard ignores undecorated handlers; falls back to the in-memory window and blocks past
  the limit; prefers Redis counters and forwards the retry window; reports remaining allowance.

`apps/api/src/common/csv.spec.ts` (3):

- neutralises spreadsheet formula prefixes (`=`, `+`, `@`, expression-style `-`) while preserving
  ordinary negative amounts;
- quotes separators and embedded quotes and handles null values;
- round-trips a document through the parser.

## API integration tests (42)

Each file boots the real Nest application with a real PostgreSQL database and resets tables between
tests. Auth helpers keep cookies and CSRF tokens.

**`auth.e2e-spec.ts` (9)** — registration hashes the password and returns an owner session; duplicate
emails are rejected; login requires CSRF for mutations; wrong passwords lock the account; logout
revokes the session; server-side role permissions are enforced; tenant isolation protects products
and users; branch-scoped staff cannot sell at another branch; unauthenticated access is 401.

**`sales.e2e-spec.ts` (8)** — server-calculated tax/cost/profit and one stock movement; idempotent
replay returns the original sale; cashier price override is forbidden while manager override works;
cashier discount cap; insufficient stock leaves inventory unchanged; underpayment records nothing;
cash change is stored; cashier sale lists are scoped while managers see the branch.

**`sync.e2e-spec.ts` (9)** — device registration is idempotent; offline sale is repriced and replays
idempotently; tampered cashier prices are rejected while an authorised override is accepted; stock
and catalogue conflicts are recorded against the event; conflict resolution requires
`sync:manage` and is audited; future-dated events and events beyond the offline retention window
fail; payload fields outside the contract are rejected; push requires sales permission and devices
are tenant-scoped; bootstrap returns role-scoped branches and pulls changes.

**`inventory-refunds.e2e-spec.ts` (4)** — adjustments create auditable movements; a cashier refund
waits for approval and restocks exactly once; a repeated refund request is deduplicated until
completion; requester/approver segregation and the owner threshold override are enforced.

**`purchases-transfers.e2e-spec.ts` (5)** — partial receiving and replacement-cost refresh; supplier
return cannot exceed received quantity; only unreceived orders can be cancelled and invalid input is
rejected; transfers move stock only after approval with ledger rows on both branches; transfer
segregation, cancellation and stock availability are enforced.

**`reports.e2e-spec.ts` (7)** — refunds net through totals, cashier and category breakdowns;
inclusive date-only ranges in business time; dashboard built from recorded data; profit explanation
with period comparison and recommendation; stock valuation and net units sold; output tax net of
refunds plus CSV export; tenant/branch isolation and report permissions.

## Browser smoke tests (3)

`apps/web/e2e/smoke.spec.ts` runs Chromium at `http://localhost:3000`:

1. **Landing page** — headline and the "Illustrative product preview — not live business data"
   caption are visible.
2. **Owner sign-in** — logs in with the seeded owner, sees the time-based greeting, opens POS and
   adds Coca-Cola; the cart quantity control is present.
3. **Cashier permissions** — signs in as cashier, attaches a console listener after login, confirms
   `/settings` shows "Settings are managed by the owner", adds a product on `/pos`, and asserts no
   console errors (this covers the earlier 403 polling regression on `/sync/overview`).

## Manual browser verification

In addition to the automated suites, the running build was exercised in a real browser:

- **Owner flow:** dashboard values came from seeded completed sales; reports reconciled with sale
  totals; audit entries appeared for changes; settings and user management worked.
- **Cashier flow:** POS added items, priced the cart, completed a sale, produced a receipt, and the
  sale appeared in the cashier's own list. The cart is a real React state change; earlier
  accessibility snapshots lagged the update but the DOM contained the line.
- **Manager flow:** branch switching, refund approval, purchase receiving and transfer approval
  were exercised.
- **Inventory clerk flow:** stock levels, adjustments, purchases and transfers worked; sales and
  reports were not available.
- **Refund:** a sale was refunded; stock returned to the shelf once; the refund and audit records
  were visible; reports netted the refund.
- **Offline sync:** with the API stopped, a POS sale was captured locally (`LOCAL-5473BC8E`), the
  queue showed increasing attempts, and after the API restarted the same event was confirmed as
  `SALE-000382` exactly once with matching totals and stock movement.
- **Tenant isolation:** the second seeded tenant (`owner@nakawa.test`) could not see Mirembe data or
  IDs.
- **Honesty fixes verified:** sale detail now labels synced offline sales "POS till
  (sync-confirmed)"; the landing preview is marked illustrative and its charge control is inert.
- **Production compose:** a fresh business was registered and its owner signed in through the
  containerised web port on `http://127.0.0.1:3100`; the login page, API rewrite and health checks
  were also exercised. See [deployment.md](deployment.md).

## How to run everything

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:generate
npm run db:deploy
npm run db:seed

npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run dev                 # in another terminal, then:
npm run test:e2e
```

`npm run test:e2e` needs the web and API running, the seed loaded and Chromium installed
(`npm run test:e2e:install -w @kampalasmart/web`). The CI workflow performs the same steps with
service containers.

## Test design notes

- Integration tests call the real HTTP surface through Supertest; they do not mock Prisma.
- Stock and money assertions read the ledger and sale rows after the request, proving the
  transaction, not just the response body.
- Tests deliberately cover failure paths: wrong password, CSRF missing, insufficient stock,
  underpayment, tampered price, duplicate sync event, refund segregation, cross-tenant access.
- Playwright connects to the seeded database. Running it against production data would create test
  sales; use a disposable database.

## Known testing gaps

- No load, soak or concurrency benchmark. Idempotency and counters are tested functionally, not under
  sustained contention.
- No visual regression, cross-browser (only Chromium) or automated accessibility audit.
- No unit tests for every service method; the integration suite is the primary safety net.
- No tests for external email or payment providers because neither is implemented.
- Docker image builds and compose startup were verified locally; the GitHub Actions workflow has not
  been executed on GitHub from this workspace.
- No penetration test, dependency-CVE gate or backup restore inside CI. The backup restore was
  performed manually (see [ENGINEERING_REPORT.md](ENGINEERING_REPORT.md)).
