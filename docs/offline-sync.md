# Offline-first sync

KampalaSmart assumes the connection will fail. The till must keep selling, print a receipt the
cashier can hand over, and reconcile later without losing or duplicating money.

## Design rules

1. **Local write first.** A sale is written to IndexedDB before any network call. The receipt is
   produced from the local priced cart and is clearly marked as awaiting sync.
2. **Server is authoritative.** Once the server sees the sale, it reprices from database products,
   rechecks stock and tax, and assigns the permanent sale number. The device total is provisional.
3. **Never silently drop a sale.** If the server rejects a sale for a business conflict (stock,
   unavailable product, invalid customer) the event is preserved as a conflict for a person to
   decide. It is never erased automatically.
4. **Exactly once.** Every event carries a `clientId`; the server also stores it as the sale's
   idempotency key. Replays return the original sale.
5. **One cashier's queue, one cashier's sales.** A queued event is only pushed by the signed-in
   cashier who created it. A different login on the same tablet does not attribute the sale to
   themselves.

## IndexedDB stores

Defined in `apps/web/src/lib/offline/db.ts` (Dexie database `kampalasmart`):

| Store | Purpose |
| --- | --- |
| `products`, `categories`, `taxRates` | Catalogue snapshot for offline pricing |
| `inventory` | Per-branch stock snapshot (`locationId:productId`) |
| `customers` | Customer lookup for offline sales |
| `locations` | Branch selector snapshot |
| `outbox` | Queued sale events and their status/attempts |
| `localSales` | Human-readable local sale history and receipt data |
| `conflicts` | Local copy of unresolved conflicts |
| `meta` | Device bootstrap time, last sync time, etc. |

A device key is generated once and stored in `localStorage` (`ks_device_key`). It is registered
with the server on bootstrap/first push and used for device diagnostics.

## Sale lifecycle

```
Cashier taps Charge
  └─ price locally (shared priceCart)
  └─ write LocalSale(status=PENDING) + OutboxEvent(status=PENDING) in one Dexie transaction
  └─ decrement local stock snapshot
  └─ show local receipt (LOCAL-xxxxxxxx / "awaiting sync")
  └─ if navigator.onLine → syncOutbox()

syncOutbox()
  └─ select up to 40 PENDING events for this cashier
  └─ mark SYNCING
  └─ POST /api/v1/sync/push { deviceKey, events[] }
      ├─ 200 with per-event results
      │   ├─ SYNCED   → save server saleId/saleNumber, update local stock
      │   ├─ CONFLICT → keep event, create local conflict, refresh server conflicts
      │   └─ FAILED   → keep event with error; cashier may retry or discard with a reason
      └─ network/5xx → reset to PENDING, increment attempts, retry later
```

Automatic sync runs when the app starts, every 30 seconds while online, when the tab becomes
visible, and after each sale. A manual **Sync now** button is available on the sync page and the
header status control. Catalogue pull runs every 90 seconds.

## Server push contract

`POST /api/v1/sync/push` (requires `sync:read` + `sales:create`):

```json
{
  "deviceKey": "web-3d0f...",
  "events": [
    {
      "clientId": "0e1d...",
      "type": "SALE",
      "payload": {
        "locationId": "loc_...",
        "customerId": null,
        "occurredAt": "2026-10-26T15:35:00.000Z",
        "items": [{ "productId": "prd_...", "quantity": "1" }],
        "cartDiscount": null,
        "payments": [{ "method": "CASH", "amount": "5074.00" }],
        "notes": null
      }
    }
  ]
}
```

The server converts each event to the same `CreateSaleDto` used by the online endpoint and calls
`SalesService.create` with `isOffline: true`, so there is one accounting path. Pricing, discount
caps and stock checks are identical.

Limits: 1–100 events per request, 1–200 lines per sale, decimal strings for money/quantity.

Response shape:

```json
{
  "results": [
    {
      "clientId": "0e1d...",
      "status": "SYNCED",
      "saleId": "sale_...",
      "saleNumber": "SALE-000382",
      "sale": { "...": "full sale DTO" }
    }
  ],
  "inventory": [{ "productId": "prd_...", "quantity": "138.000" }],
  "serverTime": "2026-10-26T15:36:02.000Z",
  "deviceId": "dev_..."
}
```

## Conflict policy

Conflict codes (`CONFLICT_CODES` in `apps/api/src/modules/sync/sync.service.ts`):

| Code | Cause |
| --- | --- |
| `INSUFFICIENT_STOCK` | Cached stock was stale; server stock cannot cover the sale |
| `PRODUCT_UNAVAILABLE` | Product archived/deleted or no longer belongs to the tenant |
| `INVALID_CUSTOMER` | Customer no longer exists |
| `CUSTOMER_INACTIVE` | Customer is inactive |

For these codes the server:

1. Does not create the sale or deduct stock.
2. Creates a `SyncConflict` row with the client event id, device, reason and structured details
   (including the exact stock shortfall where applicable).
3. Writes an audit trail and a notification for managers/owners.
4. Returns `status: "CONFLICT"` for that event while continuing with the rest of the batch.
5. Records the same sale locally as `CONFLICT` with the server message.

Other errors (validation, price override forbidden, auth) are `FAILED`: kept locally with the
error, but not classified as stock conflicts.

### Resolution

- Managers/owners (`sync:manage`) see the conflict queue and device activity at `/sync`.
- Resolving records a written resolution, resolver and timestamp on the server, writes an audit
  record and notifies the requester.
- Cashiers can retry or discard their own local event. Discard requires a reason and keeps a
  voided `FAILED` local sale in the device history — it is never silently removed.
- If the same `clientId` is later accepted (for example after stock is replenished and the event
  is retried), the open conflict is automatically resolved with
  `"The sale was accepted on a later sync."`.

## Bootstrap and pull

- **Bootstrap** (`GET /sync/bootstrap?locationId=`): products, categories, tax rates, inventory,
  locations and customers for an assigned branch. Used after login or when the cache is empty.
- **Pull** (`GET /sync/pull?locationId=&since=`): products and stock changed since the last sync,
  merged into the cache without overwriting local stock with stale values.
- Cached stock is a hint for the till; the server always decides.

## Verified failure path

On 26 October 2026, using a production build and a cashier account:

1. API was stopped to simulate a dead connection.
2. A sale was charged: local receipt `LOCAL-5473BC8E`, header status showed offline/queued, receipt
   printed `OFFLINE SALE — AWAITING SYNC`.
3. The API was restarted. The queued event retried automatically; the sync queue showed the event
   with 3 attempts.
4. It became `SALE-000382`, `USh 5,074`, status `Synced`, "Recorded on server", and the server
   inventory/sale detail reflected it.
5. The sale detail now labels the source `POS till (sync-confirmed)` instead of the misleading
   former "Offline till" label for an online session.

Server-side conflict recording, batch continuation, idempotent replay, manager-only resolution,
cross-tenant isolation and audit writing are covered in `apps/api/test/integration/sync.e2e-spec.ts`.

## Limits and non-goals

- Only sales are queued offline. Purchases, transfers and refunds require a connection.
- The service worker caches the application shell; it does not cache API responses as data.
- Local storage is per browser profile. Clearing site data removes the queue — the UI warns before
  destructive local cleanup (see account/settings screens).
- Clock skew can affect display timestamps; the server stores the device `occurredAt` but owns
  `syncedAt` and document numbering.
- There is no peer-to-peer or cross-device queue sharing.
