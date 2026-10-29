# ADR 0007 — Preserve sync conflicts, never drop a sale

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

An offline till may record a sale for stock that has since been sold at another branch, or for a
product that was deactivated, or for a customer that no longer exists. The easy options are to
discard the sale or force it through. Both destroy trust: one loses revenue, the other corrupts
stock.

## Decision

The server evaluates each pushed event and returns a per-event result:

- **Accepted** — sale created (or replayed idempotently).
- **Conflict** — a known business reason prevents posting: `INSUFFICIENT_STOCK`,
  `PRODUCT_UNAVAILABLE`, `INVALID_CUSTOMER`, `CUSTOMER_INACTIVE`. The event is retained in
  `SyncConflict` with the client ID, device, reason and details; no sale or stock movement is
  created.
- **Failed** — schema or unexpected error; the outbox keeps the event with its error for retry or
  support review.

Conflicts are never silently deleted. A user with `sync:manage` records a resolution and reason;
the action is audited. If a later push for the same client event succeeds (for example after stock is
received), the conflict can be auto-resolved with an explicit note. The device receives the original
conflict list on overview.

## Consequences

- Financial and stock history is not rewritten to make a queue drain.
- Some sales need human action; the UI shows conflicts and pending counts.
- The same client event may be retried repeatedly; idempotency prevents duplicates.
- Conflict reasons are a stable, documented contract (`packages/shared/src/sync.ts`).
- Future-dated events and events older than the retention window are rejected rather than posted,
  to avoid back-dating financial records arbitrarily.

## Alternatives considered

- Auto-apply and allow negative stock: rejected as default; negative stock is a business setting,
  not a sync policy.
- Drop rejected events: rejected; loses the sale record and hides the problem.
- Last-write-wins on stock: rejected; stock is a ledger, not a mutable cell.
