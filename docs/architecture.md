# Architecture

## System shape

KampalaSmart is an npm-workspaces monorepo with three deployable/runtime units:

| Path | Runtime | Responsibility |
| --- | --- | --- |
| `apps/api` | Node 20+, NestJS 11 | HTTP API, auth, RBAC, tenancy, transactions, reports |
| `apps/web` | Node 20+, Next.js 15 | Installable PWA, till, management UI, IndexedDB outbox |
| `packages/shared` | TypeScript library | Money helpers, pricing/tax engine, permissions, plans, shared types |

PostgreSQL 16 is the system of record. Redis is optional and used only for distributed rate
limiting and readiness reporting; when it is unavailable the API falls back to a bounded
in-process counter.

```
Request → Helmet/compression → cookie parser → JSON validation
        → JWT auth guard (cookie or bearer)
        → permissions guard (static RBAC)
        → CSRF guard (cookie-authenticated mutations)
        → controller → service
            ├─ tenant scoping: every query includes businessId
            ├─ location scoping: AccessService
            └─ criticalTransaction / Prisma $transaction
        → audit interceptor / logger → JSON response
```

Swagger is generated at `GET /api/docs`. The application prefix is `/api/v1`; health probes are
mounted outside it at `/health`, `/health/live` and `/health/ready`.

## Domain modules

- **auth / users** — registration, login, refresh rotation, logout, password change/reset, email
  verification tokens, session listing and revocation, user administration.
- **locations** — branches, including archived branches (historical records remain readable).
- **products / categories / suppliers / customers** — catalogue, pricing, tax assignment, stock
  tracking flags, archive rather than hard delete.
- **inventory** — level lookup, low-stock, valuation, metrics (`insights`), append-only movement
  ledger, adjustments and stock counts/reconciliation.
- **sales** — server-authoritative sale creation, list/detail/receipt/export.
- **refunds** — request, approve, complete, reject, cancel; threshold and segregation rules;
  stock restoration on completion.
- **purchases** — supplier orders, partial/full receipt, replacement-cost updates, purchase returns.
- **transfers** — branch-to-branch stock movement with approval, dispatch and completion.
- **reports** — dashboard, sales summary, profit explanation, products, stock, customers,
  suppliers, tax, CSV export.
- **sync** — device registration, bootstrap/pull, idempotent push, conflict recording, resolution.
- **audit / notifications / assistant / settings / health** — cross-cutting operational features.

Each module is a NestJS module with a controller, DTOs and a service. Shared access rules live in
`common/access/access.service.ts`; shared ledger writes live in
`common/inventory/inventory-ledger.service.ts`; document numbers live in
`common/documents/document-number.service.ts`.

## Multi-tenancy

- Every business-owned table carries `businessId`.
- Services never accept a tenant id from the client. `AuthUser.businessId` comes from the verified
  access token/session.
- Reads and writes include `businessId` in the `where` clause, including "get by id" operations.
- Cross-tenant identifiers resolve as not-found, not as a permission error that leaks existence.
- Integration tests sign into two tenants and assert that each cannot read, mutate, resolve or
  export the other's data.

Branch scoping is separate from tenant scoping. `AccessService` resolves which locations a user may
see based on role and explicit `UserLocation` assignments. Privileged roles (owner/manager) are not
limited to assigned locations for tenant-wide reports; cashiers and inventory clerks are.

## Authentication and sessions

- Passwords: bcrypt cost 12. Unknown emails still run a dummy bcrypt comparison to reduce timing
  leakage.
- Access token: JWT, default 15 minutes, delivered as an `httpOnly`, `SameSite=Lax` cookie
  (`ks_at`). Bearer tokens are accepted for API clients; CSRF is skipped only for bearer requests.
- Refresh token: 48 random bytes, stored **hashed** in `Session.tokenHash`, rotated on every
  refresh, delivered as an `httpOnly` cookie restricted to the refresh path (`ks_rt`).
- CSRF: 24 random bytes in a readable cookie (`ks_csrf`) plus `x-csrf-token` header, compared with
  `timingSafeEqual`. Safe methods are exempt.
- Lockout: repeated bad passwords increment `failedLoginAttempts`; the account locks for 15
  minutes. Login is also rate-limited per IP+email (default 8 attempts / 15 minutes).
- Sessions are revocable individually or in bulk; password reset revokes existing sessions.
- Email-verification and password-reset tokens are random, hashed at rest, single-use and expiring.

## Money, tax and pricing

All money and quantity values are `Decimal` in PostgreSQL and decimal strings across the API.
JavaScript floating point is not used for financial totals.

Definitions used by the pricing engine (`packages/shared/src/pricing.ts`):

- **subtotal** — sum of line gross amounts before discounts and before tax extraction.
- **line discount / cart discount** — allocated exactly across lines (largest-remainder style) so
  line discounts always add up to the cart discount.
- **tax** — computed per line after discount. Tax-inclusive prices extract tax from the discounted
  amount; tax-exclusive prices add tax on top.
- **total** — amount the customer pays, including tax.
- **costTotal / grossProfit (pricing preview)** — cost and gross margin for the cart.
- **netRevenue** — `total − taxTotal` for a tax-exclusive cart; for reporting, refunds are netted
  (`netRevenue = total − taxTotal − (refundTotal − refundTax)`).

Negative quantities, excessive decimals, duplicate products, out-of-stock tracked products and
discounts above the actor's cap are rejected by the shared engine and again on the server.

### Payment records

Payment methods (`CASH`, `MOBILE_MONEY`, `CARD`, `BANK`, `CREDIT`) are recorded with
`provider = MANUAL`. Split payments must sum exactly to the sale total; cash overpayment produces
change. There is no gateway integration and no claim of provider confirmation.

## Sale posting (atomic and idempotent)

`SalesService.create` runs inside `criticalTransaction` (serializable isolation with retries):

1. Replay check by `idempotencyKey` and/or `clientId` (before and inside the transaction, plus a
   unique-constraint fallback) returns the existing sale instead of double-posting.
2. Resolve the permitted location; validate customer, product availability and duplicate lines.
3. Load current stock and tax, reprice every line from database prices, enforce price-override
   permission and discount caps.
4. Validate payments and compute change.
5. Allocate the next sale number atomically (`DocumentCounter` row lock) and insert the sale,
   items and payments.
6. Append one `InventoryMovement` per line with `movementType = SALE`, negative quantity and a
   running balance; update `InventoryLevel`.
7. Create low-stock notifications on threshold crossings and write an audit record.
8. Commit. A failure anywhere rolls back the sale, stock and ledger together.

Cashiers may only sell at catalogue prices. Managers and owners may override prices, subject to
their configured discount caps.

## Inventory ledger

`InventoryMovement` is append-only and carries: business, location, product, movement type,
signed quantity, unit cost, resulting balance, reference type/id and actor. Movement types include
sale, purchase receipt, purchase return, refund, transfer out/in, adjustment, count and damage.

`InventoryLevel` is a materialised current balance updated in the same transaction as the movement.
The ledger is the evidence; the level is the fast read model. Reconciliation creates an adjustment
to align the two without rewriting history.

## Refunds and approvals

- A refund must reference a completed sale line; quantities cannot exceed sold minus previously
  refunded quantities.
- If the refund total is at or above `business.refundApprovalThreshold`, it starts `PENDING` and
  requires a second person with `refunds:approve` to approve. A non-owner cannot approve or
  complete their own request (the owner is the explicit override for their own business).
  Refunds above the threshold still require owner-level approval.
- A user with `refunds:approve` may auto-complete a refund at or below the threshold at creation
  time; above the threshold it waits for an approver. Completing appends `SALE_RETURN` movements
  for restocked items and writes an audit record. The sale's status becomes
  `PARTIALLY_REFUNDED` or `REFUNDED`; the original sale is never edited.

## Purchases, receipts and transfers

- Purchases move `ORDERED → PARTIALLY_RECEIVED → RECEIVED` (or `CANCELLED`). Only received
  quantities enter stock. Receiving updates the product's replacement cost using the received unit
  cost while preserving historical sale costs.
- Purchase returns reverse received stock with a separate ledger movement.
- Transfers move `PENDING → APPROVED → COMPLETED`, with `REJECTED`/`CANCELLED` alternatives.
  Dispatch deducts from the source; completion adds to the destination. The approver must differ
  from the requester.
- Historical documents are never deleted. Archives set `archivedAt`/`isActive` flags.

## Reporting definitions

Reports aggregate only server-confirmed records. Offline sales appear after sync. Date-only input
is interpreted in the business timezone (`Africa/Kampala` by default), with inclusive end dates.

- **Gross sales** — sum of completed sale totals (tax-inclusive).
- **Net sales** — gross sales minus tax minus net refunds.
- **Discounts** — allocated line + cart discounts.
- **Tax** — sale tax minus refund tax.
- **COGS** — cost of sold items minus cost of refunded items.
- **Gross profit** — net sales minus COGS.
- **Transactions** — count of completed sales (refunds are not counted as negative transactions).
- **Average sale / average ticket** — gross sale total divided by completed transactions, before
  refunds. This is a deliberate gross-receipts metric; use net sales for revenue after refunds.
- **Items sold** — sold quantity minus refunded quantity.

Dashboard, sales-summary, product, stock, customer, supplier, tax, branch and cashier reports share
the same definitions. Integration tests assert that report groupings reconcile to the totals (for
example, by-cashier and by-category net revenue both equal the summary net revenue).

## Time and identifiers

- Server timestamps are UTC; presentation converts to the business timezone.
- Business documents use atomic sequence counters: `SALE-000001`, `REF-000001`, `PO-000001`,
  `TRF-000001`.
- Offline sales receive a local receipt reference until the server assigns the permanent number.
- Database ids are cuid/UUID-style strings; API clients should treat them as opaque.

## Failure behaviour

- Validation errors return `400` with a stable code; conflicts return `409`; auth failures `401`;
  permission failures `403`; not-found `404`; throttling `429`.
- A crashed process leaves no partial sale: the transaction rolls back.
- Sync push is per-event: one conflict does not discard the rest of the batch.
- Email delivery failure is reported as `delivered: false` and never treated as sent.
- The PWA remains usable from the cached catalogue when the API is unreachable; queued sales keep
  their device receipt and are visibly marked as awaiting sync.

## Related decisions

- [ADR 0001](adr/0001-monorepo-and-stack.md) — monorepo, Next.js and NestJS
- [ADR 0002](adr/0002-offline-first-outbox.md) — local-first outbox and server authority
- [ADR 0003](adr/0003-append-only-inventory-ledger.md) — ledger plus materialised level
- [ADR 0004](adr/0004-decimal-money-and-tax.md) — decimal money and tax allocation
- [ADR 0005](adr/0005-tenant-isolation-and-rbac.md) — tenant scoping and role matrix
- [ADR 0006](adr/0006-cookie-auth-and-csrf.md) — cookie sessions and CSRF
- [ADR 0007](adr/0007-sync-conflict-policy.md) — preserve conflicts, never drop sales
- [ADR 0008](adr/0008-audit-and-approval-workflows.md) — audit and segregation of duties
