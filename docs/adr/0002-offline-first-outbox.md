# ADR 0002 — Offline-first outbox with server authority

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

Target shops have intermittent connectivity, shared tills and cash-only customers. A sale must not
fail because the network is down, but revenue and stock must not be trusted to a browser that can be
tampered with or closed mid-sale.

## Decision

Every POS sale is written to IndexedDB (Dexie) first, with a client-generated `clientId`, and then
pushed through `/sync/push`. This applies online and offline — there is no second "direct" sale
path.

- The outbox row moves `PENDING → SYNCING → SYNCED` or back to `PENDING` on network failure with an
  incremented attempt count and error text.
- Batches are 40 events client-side, capped at 100 server-side.
- The server reprices every line with the shared pricing engine, rechecks stock, and either creates
  the sale in one transaction or preserves a conflict.
- `clientId` is the idempotency key; replays return the original result.
- Devices bootstrap and pull catalogue/inventory deltas; server timestamps decide ordering.

## Consequences

- A cashier can keep selling through an outage; the receipt is provisional until confirmation.
- The server remains the source of truth for money, stock and reporting.
- The UI must distinguish "recorded locally" from "confirmed by server" honestly.
- Unsynced sales live only in the browser profile. Clearing site data or losing the device loses
  them; this is documented for operators.
- Event payloads are strictly validated; unknown fields are rejected to keep the contract stable.

## Alternatives considered

- Direct API sale with a local retry: rejected because the cart could be lost before any durable
  write and because two write paths invite divergence.
- CRDT/peer-to-peer sync: rejected as unnecessary for single-business retail and hard to audit.
- Trusting client totals: rejected; the server must recalculate.
