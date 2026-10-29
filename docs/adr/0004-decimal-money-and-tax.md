# ADR 0004 — Decimal money, shared pricing and tax allocation

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

JavaScript floating point cannot represent money safely. Discounts, tax and split payments must
produce identical totals on the device (provisional receipt) and the server (authoritative sale),
including when several lines share a cart discount.

## Decision

- Store money as PostgreSQL `Decimal` and carry it across the wire as canonical decimal strings.
- Use `decimal.js` in `packages/shared` for all arithmetic, rounding half-up to the currency's
  precision at the defined boundaries.
- One `priceCart` function performs line discounts, cart-discount allocation, tax-inclusive or
  tax-exclusive tax, and totals. The web calls it for a provisional total; the API calls it again
  with authoritative product prices.
- Cart discounts are allocated across lines so line totals sum exactly to the cart total; the last
  line absorbs the rounding remainder deterministically.
- Payments must sum to the server total. Change is stored when cash tendered exceeds the total.
- Currency formatting is presentation only (UGX with no decimals by default); the stored amount is
  unchanged.

## Consequences

- Client and server agree on totals unless prices or stock changed, in which case the server
  rejects or returns a conflict rather than accepting the device total.
- No floating-point money exists in the persistence or domain layer.
- Every test fixture can assert exact strings, making regressions obvious.
- Tax allocation is explicit and explainable in reports.

## Alternatives considered

- Integer minor units: workable, but mixed currency precision and quantity decimals make a Decimal
  string model clearer; Prisma and decimal.js support it directly.
- Server-only calculation with the client hiding totals: rejected; the cashier needs an immediate
  provisional receipt.
- Rounding per line without allocation: rejected; it leaves off-by-one totals that break payment
  validation.
