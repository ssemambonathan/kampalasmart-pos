# API guide

The API is a NestJS service mounted at `/api/v1`. Health probes live at `/health`,
`/health/live` and `/health/ready` (outside the version prefix). Interactive OpenAPI docs are
served at `/api/docs` with the JSON document at `/api/docs/json`.

In development the browser talks to Next.js at `/api/backend/*`, which rewrites to the API
(`API_INTERNAL_URL`, default `http://localhost:4000`). Keeping the browser on one origin avoids
cross-site cookies; `NEXT_PUBLIC_API_URL` is an optional fallback for the rewrite target.

## Conventions

- **Content type:** JSON unless an endpoint documents otherwise. Bodies are limited to 1 MB.
- **Money:** decimal strings with up to 2 places (`"12500.00"`), never floats.
- **Quantities:** decimal strings with up to 3 places (`"1.500"`).
- **Dates:** ISO-8601 strings in responses; request filters accept `YYYY-MM-DD` or ISO timestamps.
  Business timezone is `Africa/Kampala` in the seed.
- **IDs:** CUID strings.
- **Pagination:** `page` (default 1) and `pageSize` (default 20, max 100). List responses are
  `{ "data": [...], "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 }`.
- **Success responses:** the resource or object itself, e.g. `{ "id": "...", ... }`, or
  `{ "success": true }` for deletions.
- **Errors:** every failure uses
  ```json
  { "error": { "code": "INSUFFICIENT_STOCK", "message": "…", "details": {}, "requestId": "…" } }
  ```
  `details` is optional. `requestId` also appears in logs and the `X-Request-Id` response header.
- **CSRF:** cookie-authenticated `POST`, `PATCH`, `PUT` and `DELETE` requests must send
  `x-csrf-token` equal to the `ks_csrf` cookie. Bearer-authenticated requests are exempt.
- **Validation:** unknown fields are rejected (`whitelist` + `forbidNonWhitelisted`). Validation
  failures return 400 with code `BAD_REQUEST` and the first field message.

## Authentication flow

1. `POST /auth/login` with `{ "email": "...", "password": "...", "remember": false }`.
   The response body is the session (`user`, `business`, `locations`, `csrfToken`) and `Set-Cookie`
   sets `ks_at` (15m), `ks_rt` (7d, or 30d with `remember`) and `ks_csrf`.
2. Send `x-csrf-token` on every mutation. Cookies are sent automatically with
   `credentials: 'include'`.
3. On 401, `POST /auth/refresh` rotates the refresh token and issues a new access cookie.
4. `POST /auth/logout` revokes the session and clears cookies.

Login is rate limited per IP+email and locks an account for 15 minutes after 5 failed attempts.
Error codes include `UNAUTHENTICATED` (401, also used for an unknown email or wrong password),
`ACCOUNT_LOCKED` (423), `ACCOUNT_SUSPENDED` (403), `CSRF_TOKEN_INVALID` (403) and
`RATE_LIMITED` (429). Validation failures are 400 `BAD_REQUEST` with field messages.

## Endpoint groups

Every route below is under `/api/v1`. "Permission" is the server check; role membership follows
[security.md](security.md).

### Auth — `/auth`

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/register` | Create business + owner + default branch (public) |
| POST | `/login` | Sign in (public, rate limited) |
| POST | `/refresh` | Rotate refresh token (public, cookie-based) |
| POST | `/logout` | Revoke current session |
| GET | `/me` | Current session, business and visible branches |
| PATCH | `/password` | Change own password |
| POST | `/password/forgot` | Create reset link (public; development outbox) |
| POST | `/password/reset` | Consume reset token (public) |
| POST | `/email/verification` | Request verification link |
| POST | `/email/verify` | Consume verification token (public) |
| GET | `/sessions` | List own sessions |
| DELETE | `/sessions/:id` | Revoke own session |

### Business setup

| Method | Path | Permission |
| --- | --- | --- |
| GET/POST/PATCH | `/locations` | `locations:read` / `locations:manage` |
| GET/POST/PATCH | `/categories` | `categories:read` / `categories:write` |
| GET | `/settings` | `settings:read` |
| PATCH | `/settings/business` | `settings:manage` |
| GET | `/settings/plans` | `settings:read` (informational plan catalogue) |
| GET/POST/PATCH/DELETE | `/settings/tax-rates` | `settings:read` / `settings:manage` |

### Catalogue and stock

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/products` | Paged catalogue with branch stock |
| GET | `/products/:id` | Product detail |
| GET | `/products/barcode/:barcode` | Barcode lookup |
| GET | `/products/export` | CSV export envelope |
| POST | `/products/import` | CSV import with per-row results |
| POST/PATCH/DELETE | `/products` | Create / update / archive (`products:write`, `products:delete`) |
| GET | `/inventory/levels` | Stock by branch |
| GET | `/inventory/movements` | Append-only ledger, filterable |
| GET | `/inventory/product/:productId/ledger` | One product's ledger |
| GET | `/inventory/low-stock` | Reorder candidates |
| GET | `/inventory/insights` | Stock ageing / turnover inputs |
| GET | `/inventory/valuation` | Quantity × cost valuation |
| GET | `/inventory/export` | CSV export envelope |
| POST | `/inventory/adjustments` | Manual adjustment with reason (`inventory:adjust`) |
| POST | `/inventory/reconcile` | Set counted quantity to physical count (`inventory:reconcile`) |

### Sales, refunds, purchasing

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/sales` | Paged sales; cashiers are scoped to their own |
| GET | `/sales/:id` | Sale detail including lines, payments, refunds |
| GET | `/sales/:id/receipt` | Receipt payload |
| GET | `/sales/export` | CSV export envelope |
| POST | `/sales` | Create a sale (server reprices; supports `Idempotency-Key`) |
| GET | `/refunds` | Refund list |
| GET | `/refunds/:id` | Refund detail |
| POST | `/refunds` | Request a refund |
| POST | `/refunds/:id/approve` | Approve (`refunds:approve`, not your own) |
| POST | `/refunds/:id/complete` | Restock/accounting completion |
| POST | `/refunds/:id/reject` | Reject with reason |
| POST | `/refunds/:id/cancel` | Cancel a pending request |
| GET | `/purchases` | Purchase orders |
| POST | `/purchases` | Create a draft PO |
| PATCH | `/purchases/:id` | Edit a draft |
| POST | `/purchases/:id/receive` | Receive stock (ledger `PURCHASE`) |
| POST | `/purchases/:id/cancel` | Cancel an unreceived PO |
| POST | `/purchases/:id/returns` | Return to supplier (ledger movement) |
| GET | `/purchases/returns` | Purchase return history |
| GET/POST/PATCH | `/suppliers` | Supplier records |
| GET/POST/PATCH | `/customers` | Customer records |

### Transfers

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/transfers` | `inventory:read` |
| POST | `/transfers` | `inventory:transfer` |
| POST | `/transfers/:id/approve` | `inventory:transfer:approve`, requester excluded |
| POST | `/transfers/:id/complete` | `inventory:transfer:approve` |
| POST | `/transfers/:id/reject` | `inventory:transfer:approve` |
| POST | `/transfers/:id/cancel` | `inventory:transfer` |

### Reports, audit, ops

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/reports/dashboard` | KPIs and trends from confirmed records |
| GET | `/reports/sales-summary` | Period totals and series |
| GET | `/reports/profit-explanation` | Explainable gross profit breakdown |
| GET | `/reports/products` | Product performance |
| GET | `/reports/stock` | Stock report |
| GET | `/reports/customers` | Customer report |
| GET | `/reports/suppliers` | Supplier report |
| GET | `/reports/tax` | Tax collected |
| GET | `/reports/export` | CSV export envelope |
| GET | `/audit` / `/audit/:id` | Audit history (`audit:read`) |
| GET | `/audit/actions` | Action filter values |
| GET | `/audit/export` | CSV export envelope |
| GET | `/notifications` | User/business notifications |
| GET | `/notifications/unread-count` | Badge count |
| POST | `/notifications/:id/read`, `/notifications/read-all` | Mark read |
| GET | `/assistant/capabilities` | Supported questions (`assistant:use`) |
| POST | `/assistant/ask` | Rules-engine answer |
| POST | `/users` | Create staff (`users:manage`) |
| GET/PATCH | `/users`, `/users/:id` | Directory / update role, status, branches |
| POST | `/users/:id/reset-password`, `/unlock` | Admin recovery |
| DELETE | `/users/:id` | Soft-deactivate |
| GET/DELETE | `/users/:id/sessions` | Inspect or revoke another user's sessions |
| GET/POST/PATCH | `/settings`, `/tax-rates`, `/locations` | See business setup |

### Sync — `/sync`

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/sync/register` | Register/resume a device (bootstrap) |
| GET | `/sync/bootstrap` | Locations, products, categories, customers, settings |
| GET | `/sync/pull` | Incremental catalogue/inventory delta since a timestamp |
| POST | `/sync/push` | Up to 100 sale events per batch |
| GET | `/sync/overview` | Devices and conflicts (`sync:manage`) |
| POST | `/sync/conflicts/:id/resolve` | Record a resolution and audit it (`sync:manage`) |

The push contract, conflict codes and resolution rules are in
[offline-sync.md](offline-sync.md). A sale event is:

```json
{
  "clientId": "LOCAL-5473BC8E",
  "type": "SALE",
  "payload": {
    "locationId": "loc_...",
    "customerId": null,
    "items": [{ "productId": "prd_...", "quantity": "2", "unitPrice": "5000.00" }],
    "cartDiscount": { "type": "AMOUNT", "value": "1000.00" },
    "payments": [{ "method": "CASH", "amount": "9000.00" }],
    "occurredAt": "2026-10-26T09:14:02.000Z"
  }
}
```

The server reprices, validates stock and either creates the sale atomically or returns a
conflict/error result for that event. `clientId` is the idempotency key and never appears inside
the sale payload.

### Health

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Summary |
| GET | `/health/live` | Process liveness |
| GET | `/health/ready` | Database and Redis readiness |

Health responses expose status only; no secrets or connection strings are returned.

## Idempotency

`POST /sales` accepts `idempotencyKey` or `clientId`. If a sale with that key already exists for
the business, the API returns the original sale rather than creating a second one. Sync push uses
`clientId` the same way.

## Exports

CSV endpoints return `{ "filename": "...", "contentType": "text/csv; charset=utf-8", "content":
"..." }`. This keeps exports inspectable through the normal JSON error contract. Opening exports in
a spreadsheet is a client action; see the residual risk note in [security.md](security.md).

## Versioning and compatibility

The prefix `/api/v1` is the compatibility boundary. The shared TypeScript package keeps the web
client and API aligned. There is no public API-key or partner API; all access is session-based.
