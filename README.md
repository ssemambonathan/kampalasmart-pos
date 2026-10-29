# KampalaSmart POS

Offline-first, multi-tenant point-of-sale and retail management for African SMEs. Built as a
production-oriented monorepo: Next.js PWA till, NestJS API, PostgreSQL ledger, Redis-backed
rate limiting and a shared TypeScript domain layer.

**Verified:** 26 October 2026 against a local production build with seeded data.
**Automated tests:** 13 shared unit, 11 API unit, 42 API integration, 3 Playwright browser smoke.
**Not verified:** public cloud deployment, external email delivery, card/mobile-money provider
settlement, or any SMS integration. Those are deliberately not claimed anywhere in the product.

---

## What is real

- **Offline-first till.** Every sale is written to IndexedDB first, then pushed to the server.
  All POS sales use the sync path, online or offline. The server reprices every line, rechecks
  stock and either confirms the sale or preserves it as an explicit conflict.
- **Server-authoritative money and stock.** Prices, tax, discounts and stock deductions are
  recalculated inside one PostgreSQL transaction. The device total is only a provisional receipt.
- **Append-only inventory ledger.** Sales, purchases, purchase returns, refunds, transfers,
  adjustments and counts all create immutable `InventoryMovement` rows with a running balance.
  Nothing financial is silently edited or deleted.
- **Multi-tenant isolation and RBAC.** Every query is scoped by `businessId`, with role and branch
  scoping on top. Cashiers see their own sales; managers see their branches; owners see the
  business. Isolation is covered by integration tests, including cross-tenant access attempts.
- **Approval workflows.** Refunds at or above the configured threshold require a second person;
  the requester cannot approve or complete their own refund. Transfers require an approver who is
  not the requester.
- **Reports computed from confirmed records.** Dashboard, sales, profit, product, stock, tax,
  customer, supplier and branch reports are SQL aggregates over completed sales, refunds,
  purchases and the ledger — not hardcoded dashboard fixtures.
- **Rules-based assistant.** Answers are computed from the tenant's own records. No external LLM
  is called. Unsupported questions return the capability list instead of inventing an answer.
- **Production controls.** Cookie sessions with rotated, hashed refresh tokens; CSRF
  double-submit; login throttling and lockout; Helmet/CSP; validated DTOs; audit log; health and
  readiness probes; graceful shutdown.

## Architecture

```
Browser (Next.js 15 PWA)                 NestJS API (:4000)
┌─────────────────────────┐   HTTPS    ┌─────────────────────────────┐
│ React UI / POS          │───────────▶│ Auth · RBAC · tenancy       │
│ Dexie IndexedDB outbox  │  /api/v1   │ Sales · Refunds · Ledger    │
│ Service worker cache    │◀───────────│ Purchases · Transfers       │
│ Local receipts & queue  │   JSON     │ Reports · Sync · Audit      │
└─────────────────────────┘            └───────┬──────────┬──────────┘
                                               │          │
                                     PostgreSQL 16     Redis 7
                                     (source of truth) (rate limits)
```

- `apps/api` — NestJS 11, Prisma 6, PostgreSQL, Redis, Swagger at `/api/docs`.
- `apps/web` — Next.js 15 / React 19, Tailwind, Dexie, installable PWA.
- `packages/shared` — money, pricing, tax, permissions, plan and DTO types shared by both sides.

See [docs/architecture.md](docs/architecture.md) for module boundaries and accounting rules.

## Run it locally

Prerequisites: Node.js 20+, npm 10+, Docker Desktop.

```bash
cp .env.example .env                   # set JWT_ACCESS_SECRET (openssl rand -hex 32)
docker compose up -d                   # PostgreSQL :5432, Redis :6379
npm install
npm run db:generate
npm run db:deploy
npm run db:seed                        # 60 days of realistic Mirembe trading history
npm run dev                            # API :4000 and web :3000
```

Open <http://localhost:3000>. API docs: <http://localhost:4000/api/docs>.
Health: <http://localhost:4000/health>.

The seed is deterministic enough to demo but intentionally contains past-dated trading activity;
re-running it resets the demo tenants. Use a fresh database for production.

### Seeded demo accounts

These credentials were used to verify the running build. They are demo tenants only — rotate or
remove them before exposing an environment to the public internet.

| Role | Email | Password | Branches |
| --- | --- | --- | --- |
| Owner | `owner@mirembe.test` | `OwnerPass123!` | Main, Kira Road, Ntinda |
| Manager | `manager@mirembe.test` | `ManagerPass123!` | Main, Kira Road, Ntinda |
| Cashier | `cashier@mirembe.test` | `CashierPass123!` | Main, Kira Road |
| Cashier | `cashier2@mirembe.test` | `Cashier2Pass123!` | Ntinda |
| Inventory clerk | `inventory@mirembe.test` | `InventoryPass123!` | Main |
| Owner (second tenant) | `owner@nakawa.test` | `NakawaPass123!` | Nakawa Shop |

`owner@nakawa.test` belongs to **Nakawa Electronics Hub**, a separate tenant used to prove
business isolation.

## Verify it

```bash
npm run lint
npm run typecheck
npm test                 # shared + API unit tests
npm run test:integration # 42 PostgreSQL-backed tests (creates kampalasmart_test)
npm run test:e2e         # Playwright smoke; requires the web/API running
npm run build
```

The Playwright suite needs the app and API running, plus the seed loaded. See
[docs/testing.md](docs/testing.md) for the full verification matrix and manual browser evidence.

## Documentation

- [Architecture](docs/architecture.md) — modules, data model, money, stock and reporting rules
- [Offline sync](docs/offline-sync.md) — outbox lifecycle, server authority, conflicts
- [Security](docs/security.md) — controls, threat model, residual risks
- [API guide](docs/api.md) — auth flow, tenancy, endpoint groups, error model
- [Deployment](docs/deployment.md) — Docker images, production compose, TLS, migrations, backups
- [Operations](docs/operations.md) — runbook, backup/restore drill, incident checks
- [Testing](docs/testing.md) — automated suites and manual verification evidence
- [AI disclosure](docs/ai-disclosure.md) — rules engine scope and data handling
- [ADRs](docs/adr/) — the decisions that shaped the system
- [Engineering report](docs/ENGINEERING_REPORT.md) — final audit, known gaps, credentials

## Honest limitations

1. **Email is a development outbox.** Password reset and verification messages are captured and
   logged locally; no external message is sent. `EMAIL_PROVIDER` values other than
   `development-outbox` are rejected as "not implemented" rather than pretending to deliver.
2. **No payment-provider settlement.** Cash, mobile money, card and bank are recorded as payment
   methods on a sale. There is no gateway callback, webhook or settlement reconciliation.
3. **Plans are informational.** Plan limits are enforced inside the workspace; there is no billing
   provider, invoice or card charge.
4. **The assistant is a rules engine.** It does not call an LLM and cannot answer arbitrary
   questions. See [docs/ai-disclosure.md](docs/ai-disclosure.md).
5. **Single-region, single-database deployment.** The compose stack and backup scripts are
   provided and exercised locally; public-cloud hardening (WAF, managed secrets, multi-AZ,
   observability vendor) is deployment work, not something this repository claims to have done.
6. **`averageSale` is gross receipts per completed transaction**, before refunds and tax
   extraction. Net sales and profit are reported separately. This definition is documented in
   [docs/architecture.md](docs/architecture.md#report-definitions).

## License

No license file is included yet. Treat this as proprietary until a license is chosen.
