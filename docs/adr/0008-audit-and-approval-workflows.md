# ADR 0008 — Audit trail and segregation of duties

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

Money leaves the business through refunds, discounts, stock adjustments and transfers. Owners need
to know who did what, and staff should not be able to approve their own exceptions. A dashboard that
cannot explain a change is not trustworthy.

## Decision

- Record an `AuditLog` row for authentication events, permission denials, sales, refunds, purchases,
  transfers, inventory adjustments, catalogue/customer/supplier/user/settings changes, sync
  conflicts and resolutions.
- Audit rows carry actor, role, business, action, entity, before/after snapshots, reason, IP,
  user-agent and request ID. Sensitive keys are stripped; large snapshots are truncated with a
  marker.
- When a business transaction is supplied, the audit row commits or rolls back with it.
- Expose audit history read-only. There is no HTTP route to edit or delete audit rows.
- Enforce segregation:
  - Refunds at or above the configured threshold require `refunds:approve`.
  - A non-owner cannot approve or complete their own refund.
  - Owners can override the threshold but the override is audited.
  - Transfers require an approver who is not the requester.
- Sales are never edited or deleted after completion; corrections are refunds/returns.

## Consequences

- Owners can explain refunds, stock changes and role changes after the fact.
- Two-person operations are possible without a separate workflow engine.
- The owner remains a trusted super-user; segregation is designed to stop cashier/manager abuse,
  not owner abuse.
- The database role can still modify audit rows if compromised; production should restrict the
  role, ship logs externally and preserve backups.
- Some audit writes outside a transaction are best-effort so a failure cannot block a read; this is
  a deliberate availability trade-off and is logged.

## Alternatives considered

- No audit, rely on database timestamps: rejected; timestamps do not say who or why.
- Separate audit database/service: better isolation, but out of scope for a single-region compose
  deployment; the schema and service boundary allow it later.
- Hard delete with a deleted flag on sales: rejected; financial history must remain append-only.
