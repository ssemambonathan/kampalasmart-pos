# ADR 0003 — Append-only inventory ledger plus materialised level

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

Shops need current stock to sell and reorder, but also an explanation of why stock changed. Directly
overwriting a `stock` number destroys that explanation and makes discrepancies impossible to
investigate.

## Decision

Maintain two representations inside the same database transaction:

1. **`InventoryMovement`** — append-only rows for every change: sale, refund/return, purchase
   receipt, purchase return, transfer out/in, adjustment and physical count. Each row records the
   product, branch, signed quantity, reason, actor and resulting balance.
2. **`InventoryLevel`** — a per-product/per-branch running quantity used for fast availability
   checks and listings.

Every operation writes the movement and updates the level atomically. No API endpoint sets stock
directly. Counts and corrections go through adjustment/reconcile flows with a reason.

## Consequences

- Current stock and its history always reconcile; reports and the product ledger read the same
  source.
- The ledger grows with activity. Indexes on product/branch/time keep reads bounded; archival is an
  operational task, not an API deletion.
- A bug in the level update is repairable by replaying movements, but the ledger is never rewritten.
- Reporting can compute COGS and movement trends without a separate event store.

## Alternatives considered

- Current stock only: rejected — no audit trail, impossible to explain shrink.
- Event sourcing with no materialised level: rejected because every availability check would scan
  the ledger; the level is a cache backed by the ledger.
- Soft-deleting movements: rejected; corrections are new movements.
