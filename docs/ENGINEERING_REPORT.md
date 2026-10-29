# KampalaSmart POS — Engineering Report

**Build date:** 26 October 2026
**Environment:** Windows 11 (x64), Node.js 24.18.0 host, npm 11, Docker 29.7.2 / Compose v5.4.0,
PostgreSQL 16 (Docker), Redis 7 (Docker)
**Status:** Feature-complete for the specified scope; verified locally on a production build.
**Not verified:** public cloud deployment, external email delivery, payment-provider settlement,
SMS. Nothing in the product claims those.

---

## 1. Executive summary

KampalaSmart is an offline-first, multi-tenant POS and retail-management SaaS for African SMEs.
It is a real TypeScript monorepo, not a mock:

- **Next.js 15 / React 19 PWA** at `apps/web` — till, inventory, purchasing, transfers, refunds,
  reports, staff/settings, audit, assistant, offline queue and conflict screens.
- **NestJS 11 API** at `apps/api` — cookie authentication, RBAC, tenant/branch scoping, atomic
  transactional sales, append-only stock ledger, approvals, reporting, sync, audit and health.
- **Shared domain library** at `packages/shared` — money, pricing, tax, permissions, plans and DTO
  schemas used by both sides.
- **PostgreSQL 16** as the source of truth (31 Prisma models, 3 migrations); **Redis 7** for
  distributed rate limits, with a bounded in-process fallback.
- **Production artefacts** — multi-stage Dockerfiles (slim runtime + separate migration image),
  production Compose stack, backup/restore scripts, GitHub Actions workflow, and full
  architecture/security/API/operations/testing documentation.

All sales, including online ones, pass through the IndexedDB outbox. The server reprices every
line, rechecks stock, and either confirms the sale or records an explicit conflict. Money is never
computed only on the client.

## 2. Delivered scope

| Area | Implementation |
| --- | --- |
| Authentication | Register business + owner atomically; login; refresh rotation with reuse detection; logout; password reset/change; email verification token; session listing/revocation; lockout after 5 failures; bcrypt cost 12 (10 in tests) |
| Authorization | Four fixed roles (OWNER, MANAGER, CASHIER, INVENTORY_CLERK) from one shared permission map; global JWT, permissions and CSRF guards; branch scoping via `AccessService` |
| Tenancy | `businessId` from the verified session on every query; cross-tenant IDs resolve as not found; covered by integration tests |
| Catalogue | Products, categories, suppliers, customers, tax rates, archive instead of hard delete |
| Inventory | Materialised `InventoryLevel` plus append-only `InventoryMovement`; adjustments, stock counts/reconciliation, low stock, valuation |
| Sales | Server-repriced carts; tax, discounts, cost, profit; atomic sale + lines + payment + movements + counter + audit; `clientId` idempotency; receipts and CSV export |
| Refunds | Request → approve → complete; threshold approval; requester cannot approve; stock restored exactly once |
| Purchasing | Orders, partial/full receiving, replacement-cost updates, supplier returns/cancellation |
| Transfers | Request → approve → dispatch → complete; ledger rows on both branches; requester/approver separation |
| Reporting | Dashboard, sales, profit explanation, products, stock, customers, suppliers, tax, branch, CSV exports — SQL aggregates over recorded data |
| Sync | Device registration, bootstrap/pull, idempotent push in batches, conflicts, audited resolution, automatic re-resolution |
| Assistant | Rules engine over the tenant's own records; no external LLM; unsupported questions return capabilities |
| Operations | Health/live/ready probes, structured JSON logs, request IDs, graceful shutdown, audit log, notifications |
| Deployment | API/web/migrate images, production Compose, environment templates, backup/restore, runbook, CI definition |

### Web routes

27 built routes, including `/login`, `/register`, `/forgot-password`, `/reset-password`,
`/verify-email`, `/dashboard`, `/pos`, `/sales`, `/refunds`, `/purchases`, `/transfers`,
`/inventory`, `/products`, `/customers`, `/suppliers`, `/reports`, `/audit`, `/notifications`,
`/settings`, `/account`, `/assistant`, `/sync`, `/offline` and PWA/offline assets.

### Data model

31 Prisma models covering identity and sessions, business/location, catalogue, tax, inventory
levels and movements, purchases and returns, sales/items/payments, refunds/items, transfers,
audit, notifications, devices, sync conflicts and atomic document counters. Three forward-only
migrations.

## 3. Verification log

All results below are from actual runs on the final tree (26 October 2026).

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | clean (no output) |
| Typecheck | `npm run typecheck` | clean for shared, API and web |
| Shared unit | `npm run test:unit` | **13 passed** (1 suite, 13.5 s) |
| API unit | `npm run test:unit` | **11 passed** (2 suites, 27.5 s) |
| API integration | `npm run test:integration` | **42 passed** (6 suites, 79.5 s) against real PostgreSQL |
| Browser smoke | `npm run test:e2e` | **3 passed** (36.2 s) in Chromium against the production web build |
| Production build | `npm run build` | success; Next.js emitted 27 routes |
| Compose config | `docker compose -f docker-compose.prod.yml --env-file .env.production config --quiet` | valid |
| Image build | `docker compose ... build` | 3 images built (API 858 MB, web 1.77 GB, migrate 858 MB) |
| Stack start | `docker compose ... up -d` | migrate exit 0, Postgres/Redis/API/web healthy |
| HTTP smoke | `curl http://127.0.0.1:3100/login` | 200 |
| API rewrite | `curl http://127.0.0.1:3100/api/backend/auth/me` | 401 `UNAUTHENTICATED` (expected unauthenticated probe) |
| Fresh registration | Playwright against `http://127.0.0.1:3100/register` | dashboard greeting `Good evening, Aisha` |
| Seed absence | `psql` counts + login as `owner@mirembe.test` | 0 businesses/users/products before registration; seed login 401 |
| Backup | `COMPOSE_FILE=docker-compose.prod.yml ENV_FILE=.env.production ./scripts/backup.sh` | 112 KB custom-format dump |
| Restore | `RESTORE_CONFIRM=yes ... ./scripts/restore.sh <dump> kampalasmart_restore_prod` | restored; row counts matched exactly |
| CI workflow | `.github/workflows/ci.yml` | authored; **not executed on GitHub** (no remote run in this environment) |

### What the integration suite proves

The 42 PostgreSQL-backed tests boot the real Nest application and cover, among other things:

- password hashing and owner session issuance; duplicate email rejection; CSRF on mutations;
  account lockout; logout revocation; server-side role enforcement; cross-tenant isolation;
  branch-scoped staff blocked from selling at another branch;
- server-calculated tax/cost/profit and one stock movement per line; idempotent sale replay;
  cashier price/discount caps; insufficient stock and underpayment leave no records; cash change;
  cashier-vs-manager sale visibility;
- offline event repricing and replay; tampered prices rejected; stock/catalogue conflicts recorded;
  audited conflict resolution restricted to `sync:manage`; future-dated/stale events rejected;
  payload strictness; device tenancy;
- adjustments, refund approval separation, exactly-once restocking, duplicate refund requests;
- partial receiving and replacement cost; supplier return limits; transfer approval, segregation
  and dual-branch ledger rows;
- reports reconciling with recorded sales, refunds, purchases and the ledger, including tenant and
  branch scoping and CSV exports.

### Playwright smoke coverage

1. Landing page headline and the "Illustrative product preview — not live business data" caption.
2. Owner sign-in → dashboard greeting → POS adds Coca-Cola and shows the quantity control.
3. Cashier sign-in → settings shows the owner-managed notice → POS sale still works → zero console
   errors after login.

## 4. Production deployment drill

Run on 26 October 2026 with a local `.env.production` (not committed) and port 3100:

1. `docker compose -f docker-compose.prod.yml --env-file .env.production config --quiet` — valid.
2. All three images built from the repository root. The API and migration images share the same
   Dockerfile; `target: runtime` is pinned in the API build, and `runtime` is the final stage, so a
   plain `docker build -f apps/api/Dockerfile .` also yields the API image.
3. `up -d` started Postgres and Redis, ran `migrate` to completion (`prisma migrate deploy`, exit
   0, no pending migrations), then started the API and web containers. Both passed their health
   checks. Only `127.0.0.1:3100` was published.
4. The database was empty (0 businesses, 0 users, 0 products). A new business
   (`Nakawa Fresh Produce`, owner `Aisha Nakawa`) was registered through the containerised UI; the
   browser landed on `/dashboard` with `Good evening, Aisha`. The two 401s in the console were the
   expected pre-auth calls to `auth/me` and `auth/refresh`.
5. After registration the database held exactly 1 business, 1 user, 1 location and 0 products. The
   demo owner `owner@mirembe.test` was rejected with 401 `UNAUTHENTICATED`, proving no seed is baked
   into the production path.
6. The stack was stopped with `docker compose down`. Drill volumes were removed afterwards.

**Defect found and fixed during this drill:** the first API image actually contained the `migrate`
stage because that stage was last in the Dockerfile. The API container therefore looped on
`prisma migrate deploy` and failed health checks. The stage order was corrected and the Compose
build was pinned to `target: runtime`; the rebuilt image starts `node apps/api/dist/main.js` and
passes `/health/ready`.

## 5. Backup and restore drill

Two drills were run: one against the development database earlier in the build, and one against the
production Compose database. In both cases a custom-format dump was restored into a scratch
database and row counts compared.

Production drill:

```
scripts/backup.sh  -> backups/kampalasmart-20261026T144703Z.dump (112 KB)
scripts/restore.sh <dump> kampalasmart_restore_prod
source    : Business 1, User 1, Location 1, Product 0, Sale 0, InventoryMovement 0, AuditLog 2
restored  : Business 1, User 1, Location 1, Product 0, Sale 0, InventoryMovement 0, AuditLog 2
```

The development drill restored 391 sales, 1,559 inventory movements, 862 audit entries and 130
products with identical counts. The scratch databases were dropped after verification. The scripts
refuse unsafe database names, require `RESTORE_CONFIRM=yes`, use `umask 077`, and `pg_restore`
runs with `--single-transaction`.

## 6. Financial and inventory integrity

- **Server-authoritative sales.** The device total is provisional. The API reprices from database
  products, tax rates and permissions, then writes the sale, lines, payment, stock movements,
  document number and audit entry inside one PostgreSQL transaction.
- **Idempotency.** `clientId` is unique per business and stored on the sale; retries return the
  original sale instead of duplicating money or stock.
- **Append-only ledger.** Sales, refunds, purchases, purchase returns, transfers, adjustments and
  counts create `InventoryMovement` rows. There is no code path that deletes a movement. Product,
  customer, supplier and location records are archived rather than deleted when history exists.
- **Approvals.** Refund thresholds and transfer approval are enforced server-side; the requester
  cannot approve their own refund. Actions and denials are audited.
- **Reports** are aggregates over completed records and the ledger, not fixtures. The dashboard
  shows the period's recorded trading position.
- **CSV exports** neutralise spreadsheet formula prefixes while preserving ordinary negative
  amounts (covered by unit tests).

## 7. Security posture

Implemented and verified:

- bcrypt password hashing; no plaintext passwords anywhere;
- httpOnly access and refresh cookies, hashed refresh tokens, rotation and reuse revocation;
- CSRF double-submit on cookie-authenticated mutations with a timing-safe comparison;
- login throttling (Redis, in-memory fallback) plus per-account lockout;
- server-side RBAC and tenant/branch scoping (UI checks are cosmetic only);
- Helmet, CSP, frame denial, no-sniff, referrer policy; body size limits;
- DTO validation with whitelisting and rejection of unknown fields;
- recursive secret scrubbing before audit persistence;
- health/live/ready endpoints; readiness intentionally does not depend on Redis;
- containers run as `node` with `no-new-privileges`, and the database/Redis publish no host ports.

Residual risks are documented in [security.md](security.md): no MFA, no database row-level
security, application-level audit storage without WORM anchoring, no WAF/CDN, no custom roles, and
an owner can approve their own refunds by design. The development email provider writes to an
outbox; it does not send external email.

## 8. Honest limitations / not verified

| Item | Status |
| --- | --- |
| Public cloud deployment | Not performed. Only a local production Compose drill. |
| TLS / reverse proxy | Configuration and an example are documented; no certificate was issued or tested. |
| External email or SMS | Not implemented/verified. `EMAIL_PROVIDER=development-outbox` only. |
| Card / mobile-money payments | No gateway is integrated; nothing is claimed as a real settlement. |
| GitHub Actions execution | Workflow authored; not run on GitHub in this environment. |
| Multi-region, HA, autoscaling | Not implemented. Single API/web instance in the drill. |
| MFA, SSO, custom roles, RLS | Not implemented. |
| Object storage / receipt uploads | No file-upload feature. |
| Load, penetration and accessibility audits | Not performed beyond the automated suites described here. |
| Data migration from an existing POS | Not implemented. |
| Docker image size/startup | Web image is large (Next.js production dependencies); builds took several minutes on this host. |

## 9. Demo credentials

Seeded **development** tenants only. Rotate or remove before exposing any environment.

| Role | Email | Password | Branches |
| --- | --- | --- | --- |
| Owner | `owner@mirembe.test` | `OwnerPass123!` | Main, Kira Road, Ntinda |
| Manager | `manager@mirembe.test` | `ManagerPass123!` | Main, Kira Road, Ntinda |
| Cashier | `cashier@mirembe.test` | `CashierPass123!` | Main, Kira Road |
| Cashier | `cashier2@mirembe.test` | `Cashier2Pass123!` | Ntinda |
| Inventory clerk | `inventory@mirembe.test` | `InventoryPass123!` | Main |
| Owner (second tenant) | `owner@nakawa.test` | `NakawaPass123!` | Nakawa Shop |

The second tenant (`Nakawa Electronics Hub`) exists to prove business isolation. These credentials
were exercised against the running build and are deliberately excluded from production images
(no seed runs in the deployment path).

## 10. How to run

Development:

```bash
cp .env.example .env                    # set JWT_ACCESS_SECRET
docker compose up -d
npm install
npm run db:generate && npm run db:deploy && npm run db:seed
npm run dev                             # API :4000, web :3000
```

Production shape:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
# edit secrets and WEB_ORIGIN
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Then terminate TLS at a reverse proxy in front of `127.0.0.1:3000`. See
[deployment.md](deployment.md), [operations.md](operations.md) and the ADRs for details.

## 11. Readiness assessment

**What is ready:** the domain model, money/stock correctness, multi-tenant isolation, offline sale
recovery, approval workflows, reporting, security baseline, deployment packaging, backup/restore,
documentation and automated tests are all real and locally verified. The product can be demonstrated
end-to-end from the seeded tenants or from a fresh registration, online or offline.

**What stands between this and a public commercial launch:** external email delivery, a real
payment provider if online payments are in scope, TLS/DNS in the target environment, MFA, database
RLS or an independent audit, monitoring/alerting around the logs and probes, load testing, and
operational practice with real backups. Those are deliberate follow-ups, not hidden gaps — none of
them is simulated or claimed as done.

**Bottom line:** this is a credible, coherent, competition-ready build of the specified system with
honest boundaries. It earns the description "production-oriented" because the core invariants are
enforced on the server and tested; it should not be described as "production-certified" until the
items in Section 8 are completed in the target environment.
