import type { SyncEventResult, SyncPushEvent } from './types';

/**
 * Sync conflict policy (documented in docs/adr/ADR-005-sync-conflicts.md):
 *
 * 1. Idempotency wins. An event whose clientId was already accepted is
 *    acknowledged with the original sale rather than rejected as a duplicate.
 * 2. Stock is the synchronisation boundary. If an offline sale would drive
 *    stock below zero and the business forbids negative stock, the event is
 *    rejected as CONFLICT. The sale is NOT partially applied.
 * 3. A rejected event is preserved locally and on the server (SyncConflict)
 *    and must be resolved by a manager: either reconcile stock and retry, or
 *    void the local sale after recording the decision.
 * 4. The server never silently overwrites stock or discards a queued sale.
 *    Managers see the requested versus available quantity and decide.
 * 5. Accepted events are ordered by their local occurrence time only for
 *    reporting; stock effects are applied in arrival order inside a database
 *    transaction, and the ledger records the actual before/after balance.
 */
export const SYNC_CONFLICT_POLICY_VERSION = 1;

export function isTerminalSyncResult(result: SyncEventResult): boolean {
  return result.status === 'SYNCED';
}

export function canRetrySyncResult(result: SyncEventResult): boolean {
  return result.status === 'FAILED' || result.status === 'CONFLICT';
}

export function countPendingEvents(events: SyncPushEvent[]): number {
  return events.length;
}

export type LocalOutboxStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

export interface LocalOutboxEvent {
  clientId: string;
  type: 'SALE';
  createdAt: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  status: LocalOutboxStatus;
  lastError: string | null;
  payload: unknown;
}

export function nextRetryDelayMs(attemptCount: number): number {
  const base = 2_000;
  return Math.min(base * 2 ** Math.max(0, attemptCount - 1), 120_000);
}
