# Security

This document describes the controls implemented in this repository, the threat model they
address, and the risks that remain. It reflects the code at the verified date (26 October 2026).
Nothing here claims a third-party penetration test, SOC 2 certification or cloud WAF.

## Principles

1. **Server is authoritative.** Prices, discounts, tax, stock and permissions are recalculated and
   enforced in the API. The browser never decides whether a sale is valid.
2. **Tenant isolation is a query invariant.** Every business record is filtered by `businessId`
   taken from the authenticated session, not from a request parameter.
3. **Financial history is append-only.** Sales are not edited or deleted. Corrections are refunds,
   returns, transfers and inventory adjustments with their own ledger rows.
4. **Least privilege by role and branch.** Four fixed roles, explicit permission strings checked by
   a global guard, plus branch scoping for cashiers and inventory clerks.
5. **Fail closed on authentication.** A missing, expired, revoked or mismatched session is a 401.
   A present session without the required permission is a 403 and is audited.
6. **Be honest about what is not protected.** Email delivery, payment settlement and multi-region
   hardening are not implemented; see [Residual risks](#residual-risks).

## Authentication

| Control | Implementation |
| --- | --- |
| Password storage | bcrypt, cost 12 (10 in the test environment) |
| Password policy | Zod/class-validator rules on registration, reset and change |
| Access token | Short-lived JWT (`JWT_ACCESS_TTL`, default 15 minutes) in an `httpOnly` cookie `ks_at`; a bearer header is also accepted for tooling |
| Refresh token | 32 random bytes, stored only as a SHA-256 hash on `Session.tokenHash`; `httpOnly` cookie `ks_rt`, path-scoped |
| Refresh rotation | Every refresh revokes the old session row and creates a new one |
| Reuse detection | Presenting an already-revoked refresh token revokes every active session for that user and writes an audit event |
| Session validity | The JWT guard re-loads the session, user and business on each request; revoked, expired, deleted or suspended identities are rejected |
| Logout | Revokes the refresh session and the current access session, clears all three cookies |
| Failed sign-ins | After 5 failures the account is locked for 15 minutes; attempts are counted per user and audited |
| Login enumeration | Unknown emails run a dummy bcrypt comparison and return the same generic error |
| Password reset | 32-byte single-use token, 30-minute expiry, previous unused tokens invalidated, all sessions revoked on success; response is generic whether or not the email exists |
| Email verification | 48-hour single-use token; verification status is shown but does not block sign-in |
| Password change | Requires the current password, rejects reuse of the same password, revokes other sessions |
| Session listing | Users can list and revoke their own sessions; owners can revoke another user's sessions |

Tokens are never written to the audit log: `AuditService` strips keys matching
`password|token|secret|hash|authorization|cookie` recursively before persisting.

## Authorization and tenancy

- `ROLE_PERMISSIONS` in [`packages/shared/src/roles.ts`](../packages/shared/src/roles.ts) is the
  single source of truth for role capabilities. The API and UI both read it.
- A global `JwtAuthGuard` establishes `request.auth`; a global `PermissionsGuard` checks the
  permissions declared on each controller method; a global `CsrfGuard` protects cookie-authenticated
  mutations.
- `AccessService` resolves the active branch and throws if it is outside the caller's allowed
  branches. List queries add `businessId` and, where relevant, a branch filter.
- Cashiers see only their own sales (`sales:read:own`); managers and owners can read all sales in
  the business (`sales:read:all`).
- Cross-tenant attempts are covered by integration tests: another business's IDs return 404/403
  rather than leaking records.
- Denied requests caused by a missing permission are written to the audit log with the required
  permissions, method, path, IP and request ID.

### Role summary

| Capability | OWNER | MANAGER | CASHIER | INVENTORY_CLERK |
| --- | --- | --- | --- | --- |
| Sell / create refund request | yes | yes | yes | no |
| Read all sales | yes | yes | own only | no |
| Approve refunds | yes | yes | no | no |
| Products / categories write | yes | yes | no | yes |
| Purchases / receive | yes | yes | no | yes |
| Transfers create | yes | yes | no | yes |
| Transfers approve | yes | yes | no | no |
| Inventory adjust / reconcile | yes | yes | no | yes |
| Reports / analytics | yes | yes | no | no |
| Users / settings manage | yes | read only | no | no |
| Audit read | yes | yes | no | no |
| Sync conflicts manage | yes | yes | no | no |
| Assistant | yes | yes | no | no |

The exact permission strings are in `roles.ts`; this table is a convenience summary.

## CSRF, transport and browser hardening

- **CSRF:** double-submit token. The server sets a readable `ks_csrf` cookie and requires the same
  value in `x-csrf-token` on state-changing requests. Comparison uses `timingSafeEqual`. Requests
  authenticated with an `Authorization: Bearer` header are exempt because they do not rely on
  ambient cookies. Safe methods (`GET`, `HEAD`, `OPTIONS`) are exempt.
- **Cookies:** `httpOnly` for access and refresh tokens, `SameSite=Lax`, `Secure` when
  `COOKIE_SECURE=true` (required in production). The refresh cookie is restricted to `/api`.
- **CORS:** explicit origin allow-list from `WEB_ORIGIN` (comma-separated), credentials enabled,
  only the required methods and headers allowed.
- **Headers:** Helmet on the API (`default-src 'none'`, `frame-ancestors 'none'`, HSTS in
  production). The Next.js app sets CSP, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy`; `poweredByHeader` is off.
- **Body limits:** JSON and URL-encoded bodies are capped at 1 MB. `whitelist` and
  `forbidNonWhitelisted` reject unknown DTO fields.
- **Injection:** Prisma parameterizes SQL. No raw user input is interpolated into SQL except the
  guarded test-database name in the integration setup. React escapes rendered text; no
  `dangerouslySetInnerHTML` is used in the app.
- **PWA cache:** the service worker caches application shell and static assets, not API responses.
  Business data in the browser lives in IndexedDB scoped to the browser profile.

## Rate limiting and abuse resistance

- Login and other sensitive routes use the `@RateLimit` decorator. A fixed-window limiter backed by
  Redis is used when `REDIS_URL` is configured; otherwise a bounded in-process map is used. The
  fallback still protects a single API instance but is not shared across replicas.
- Login is limited per IP+email (`LOGIN_RATE_LIMIT`, default 8 per 900 seconds). Integration tests
  raise the limit so the suite can sign in repeatedly.
- Account lockout is independent of rate limiting and survives process restarts in PostgreSQL.
- Request bodies and page sizes are bounded; exports are capped by report limits and streamed as
  JSON envelopes.

## Financial and inventory integrity

- Sale creation, stock deduction, ledger movements, sale numbering, notifications and audit are one
  interactive PostgreSQL transaction. A failure rolls all of it back.
- Every sale carries a client-generated `clientId` used as an idempotency key. Replays return the
  original sale instead of duplicating revenue or stock movement.
- Payment amounts must sum to the server-calculated total; negative quantities and negative prices
  are rejected.
- Refund approval is separated from refund creation. A non-owner cannot approve or complete their
  own refund; amounts at or above `refundApprovalThreshold` require an approver with
  `refunds:approve`. Owners can override but the action is audited.
- Products are soft-deleted (`isActive=false`, `deletedAt`) so historical sale lines remain
  readable. Stock changes are never `UPDATE stock` from an API caller; they are ledger movements.
- Numbering uses an atomic `DocumentCounter` row inside the same transaction, preventing duplicate
  invoice numbers under concurrency.

## Audit logging

- Audit rows are written for authentication events, permission denials, sales, refunds, purchases,
  transfers, inventory adjustments, product/customer/supplier/user/settings changes, sync conflicts
  and conflict resolutions.
- When a transaction is supplied, the audit row commits or rolls back with the business change. If
  an audit write fails outside a transaction, the failure is logged but does not break the read or
  write path — this is a deliberate availability trade-off.
- The audit API is read-only (`GET /audit`, `GET /audit/:id`, `GET /audit/actions`,
  `GET /audit/export`). There is no HTTP route to update or delete an audit row.
- Sensitive values are stripped before persistence; large snapshots are truncated with an explicit
  `{ truncated: true }` marker.

## Data protection

- Secrets are read from environment variables validated by Zod at boot. The repository contains
  only `.env.example`; `.env` files are ignored by git.
- The seed script contains demo passwords by design. They are documented as demo credentials and
  must be removed or rotated before public exposure.
- The database stores password hashes, refresh-token hashes and reset-token hashes, never plaintext
  credentials.
- Backups contain the full tenant database and must be encrypted and access-controlled by the
  operator. See [operations.md](operations.md).
- Logs include request IDs, user IDs, business IDs, paths, status codes and selected audit context.
  They do not log passwords, tokens or raw cookies.
- Offline devices store the cached catalogue, customer list and queued sales in IndexedDB. A shared
  till should use a dedicated browser profile and device; clearing site data discards unsynced
  sales. This is a documented operational risk, not a server-side leak.

## Threat model

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Stolen password | Rate limit, lockout, session listing, password reset revokes sessions | No MFA; a phished password works until detected |
| Stolen refresh cookie | httpOnly, SameSite, rotation, reuse detection revokes the family | Malware on the device can still act as the user |
| CSRF from another site | Double-submit token with timing-safe compare | XSS on the app origin would defeat CSRF; CSP and React escaping reduce this |
| Cross-tenant access | `businessId` from session on every query; integration tests | A future query that forgets the filter is a code-review risk; no database row-level security |
| Privilege escalation | Server-side permission guard; UI checks are cosmetic only | Role model is coarse; no custom roles |
| Price/stock tampering from the till | Server repricing and stock checks; conflicts are explicit | A malicious client can still submit many valid sales (abuse, not forgery) |
| Duplicate sales on retry | `clientId` idempotency + unique constraint | A client that generates a new ID per retry can duplicate intent |
| Repudiation | Audit log with actor, IP, request ID, before/after | Operators with database access could alter rows; no WORM storage or external anchor |
| Insider refund abuse | Approval separation and threshold; audit | Owner can approve their own refunds by design |
| Credential stuffing | Per-IP+email limiter, lockout, generic errors | No device fingerprinting, CAPTCHA or breach-password check |
| Denial of service | Body limits, rate limits, bounded queries | No WAF/CDN in this repository; a determined attacker can exhaust a single instance |
| Data loss | Transactional writes, migrations, backup scripts | Backups are operator-run and not verified by the app |
| Lost till / browser reset | Server remains source of truth for synced sales | Unsynced IndexedDB sales are lost if site data is cleared |

## Residual risks

1. **No multi-factor authentication.** Not implemented.
2. **Email is a development outbox.** Password reset and verification links are logged locally and
   never delivered externally unless an operator implements a provider. This blocks self-service
   recovery in a real deployment.
3. **No payment-provider integration.** Payment methods are labels on a manually recorded sale;
   there is no gateway signature, webhook or settlement reconciliation.
4. **No database row-level security.** Tenant isolation is enforced in application queries and
   tested, but a direct database connection or a missed filter can cross tenants.
5. **Audit immutability is application-level.** The API exposes no mutation route, but the database
   role used by the app can write; production should use a restricted role, append-only storage or
   external log shipping.
6. **Single-region deployment.** No multi-AZ, failover, WAF, DDoS protection, managed secrets or
   centralized observability is included.
7. **In-memory rate-limit fallback.** Without Redis, limits are per process. Run Redis in
   production and scale the API horizontally behind a shared limiter.
8. **No MFA, SSO, custom roles or field-level encryption.** Out of scope for this build.
9. **Exported CSV is still untrusted input.** Cells beginning with `=`, `+`, `@`, an expression-style
   `-` or a control character are prefixed to neutralise common spreadsheet formulas, while ordinary
   negative numbers are preserved. Spreadsheet applications vary; treat exported files with caution
   and restrict exports to trusted staff (`exports:data`).
10. **No malware scanning or file uploads.** Product import accepts CSV text only; there is no
    binary upload surface.

## Verification evidence

- Integration tests exercise authentication, lockout, CSRF rejection, cross-tenant access, RBAC
  denials, idempotent sales, refund approval rules, inventory ledger effects and sync conflicts.
- Manual browser checks verified session cookies, the owner/manager/cashier/inventory views and the
  offline sale flow; details are in [testing.md](testing.md).
- `npm run lint`, `npm run typecheck`, unit and integration suites and the production build were run
  on the verified date.

No third-party penetration test, dependency CVE scan or compliance audit has been performed.
