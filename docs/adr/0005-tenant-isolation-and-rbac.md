# ADR 0005 — Tenant isolation and role-based access control

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

One deployment serves multiple businesses. A missing filter could expose another shop's prices,
customers or revenue. Roles also need to differ by branch and by duty (selling vs approving
refunds vs receiving stock).

## Decision

- Every business-owned table has a `businessId`. Authenticated requests carry `businessId` from the
  session, never from a request body.
- All reads and writes include `businessId` in their `where` clause. Branch-scoped roles are further
  filtered through `UserLocation` and an `AccessService` that rejects unauthorized locations.
- Four fixed roles — OWNER, MANAGER, CASHIER, INVENTORY_CLERK — map to explicit permission strings
  in `packages/shared/src/roles.ts`. A global guard checks permissions server-side; the UI hides
  actions as a convenience only.
- Cross-tenant IDs return 404/403 rather than data. Integration tests attempt cross-tenant access
  and branch escapes.

## Consequences

- Authorization is one matrix, shared by UI and API; role changes are code changes, not per-tenant
  configuration.
- Application-level scoping depends on discipline: a new query must include `businessId`. Code
  review and integration tests are the safety net. Database row-level security is not used.
- Cashier sale lists are filtered to the cashier; managers see their branches; owners see the
  business.
- No custom roles, SSO or per-field permissions.

## Alternatives considered

- PostgreSQL row-level security: stronger defence in depth, but complicates Prisma connection
  pooling and local development; can be added later.
- Permissions stored per user in the database: more flexible, but harder to audit and test; fixed
  roles match the target SME workflow.
- Frontend-only gating: rejected outright as insecure.
