'use client';

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCheck,
  Cloud,
  CloudOff,
  Database,
  DownloadCloud,
  HardDrive,
  MonitorSmartphone,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { SyncOverview } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/offline/sync';
import { getDb, type LocalConflict, type LocalSale, type OutboxEvent } from '@/lib/offline/db';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney, formatQuantity, relativeTime, titleCase } from '@/lib/format';
import { PermissionNotice } from '@/components/export-button';
import { useToast } from '@/components/toast';
import {
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  SearchInput,
  StatCard,
  StatusBadge,
  TableSkeleton,
  cn,
} from '@/components/ui';

type OutboxFilter = 'ALL' | 'PENDING' | 'CONFLICT' | 'FAILED' | 'SYNCED';

const FILTERS: Array<{ id: OutboxFilter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'PENDING', label: 'Waiting' },
  { id: 'CONFLICT', label: 'Conflicts' },
  { id: 'FAILED', label: 'Failed' },
  { id: 'SYNCED', label: 'Synced' },
];

interface ConflictTarget {
  id: string;
  clientId: string;
  reason: string;
  details: unknown;
  createdAt: string;
  deviceName?: string;
}

function conflictLines(details: unknown): Array<{ productName: string; requested: string; available: string }> {
  if (!details || typeof details !== 'object') return [];
  const record = details as Record<string, unknown>;
  if (typeof record.productId === 'string') {
    const requested = record.requested ?? record.requestedTotal;
    const available = record.available ?? record.serverAvailableAtSync;
    return [
      {
        productName: typeof record.productName === 'string' ? record.productName : 'Product',
        requested: requested === undefined || requested === null ? '—' : String(requested),
        available: available === undefined || available === null ? '—' : String(available),
      },
    ];
  }
  return [];
}

function jsonPreview(value: unknown): string {
  if (value === null || value === undefined) return 'No details recorded.';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function SyncPage() {
  const { user, business, can } = useAuth();
  const sync = useSync();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currency = business?.currency ?? 'UGX';
  const [filter, setFilter] = useState<OutboxFilter>('ALL');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<OutboxEvent | null>(null);
  const [discardReason, setDiscardReason] = useState('');
  const [resolveTarget, setResolveTarget] = useState<ConflictTarget | null>(null);
  const [resolution, setResolution] = useState('');
  const [resolveError, setResolveError] = useState<string | null>(null);

  const outbox = useLiveQuery(
    async () => {
      if (!user) return [] as OutboxEvent[];
      return getDb().outbox.orderBy('createdAt').reverse().limit(200).toArray();
    },
    [user?.id],
    [] as OutboxEvent[],
  );

  const localSales = useLiveQuery(
    async () => {
      if (!user) return [] as LocalSale[];
      return getDb().localSales.toArray();
    },
    [user?.id],
    [] as LocalSale[],
  );

  const localConflicts = useLiveQuery(
    async () => {
      if (!user) return [] as LocalConflict[];
      return getDb().conflicts.orderBy('createdAt').reverse().toArray();
    },
    [user?.id],
    [] as LocalConflict[],
  );

  const saleNumberByClient = useMemo(
    () => new Map((localSales ?? []).map((sale) => [sale.clientId, sale.saleNumber])),
    [localSales],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (outbox ?? []).filter((event) => {
      if (filter !== 'ALL' && event.status !== filter) return false;
      if (!term) return true;
      const number = saleNumberByClient.get(event.clientId) ?? '';
      return (
        event.clientId.toLowerCase().includes(term) ||
        number.toLowerCase().includes(term) ||
        (event.lastError ?? '').toLowerCase().includes(term)
      );
    });
  }, [outbox, filter, search, saleNumberByClient]);

  const openConflict = (target: ConflictTarget) => {
    setResolveTarget(target);
    setResolution('');
    setResolveError(null);
  };

  const latestServerConflict = (clientId: string): SyncOverview['conflicts'][number] | undefined =>
    sync.serverConflicts?.conflicts.find((conflict) => conflict.clientId === clientId && conflict.status === 'OPEN');

  const retry = async (event: OutboxEvent) => {
    setBusy(event.clientId);
    try {
      await sync.retryEvent(event.clientId);
      toast('Sale re-queued. It will sync when the server accepts it.', 'success');
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
    } catch (retryError) {
      toast(errorMessage(retryError), 'error');
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (!discardTarget) return;
    if (discardReason.trim().length < 3) {
      toast('Record a reason of at least 3 characters so the void is auditable.', 'error');
      return;
    }
    setBusy(discardTarget.clientId);
    try {
      await sync.discardEvent(discardTarget.clientId, discardReason.trim());
      toast('Sale voided locally with a recorded reason. The original remains in local history.', 'success');
      setDiscardTarget(null);
      setDiscardReason('');
    } catch (discardError) {
      toast(errorMessage(discardError), 'error');
    } finally {
      setBusy(null);
    }
  };

  const resolveConflict = async () => {
    if (!resolveTarget) return;
    if (resolution.trim().length < 3) {
      setResolveError('Describe the decision in at least 3 characters.');
      return;
    }
    setBusy(resolveTarget.id);
    setResolveError(null);
    try {
      const server = latestServerConflict(resolveTarget.clientId);
      if (server) {
        await api.post(`/sync/conflicts/${server.id}/resolve`, { resolution: resolution.trim() });
        await getDb().conflicts.update(resolveTarget.id, {
          status: 'RESOLVED',
          resolvedAt: new Date().toISOString(),
          resolution: resolution.trim(),
        });
        await sync.refreshConflicts();
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      } else {
        await getDb().conflicts.update(resolveTarget.id, {
          status: 'RESOLVED',
          resolvedAt: new Date().toISOString(),
          resolution: resolution.trim(),
        });
      }
      toast('Resolution recorded.', 'success');
      setResolveTarget(null);
    } catch (resolveFailure) {
      setResolveError(errorMessage(resolveFailure));
    } finally {
      setBusy(null);
    }
  };

  const refreshCatalogue = async () => {
    setBusy('bootstrap');
    try {
      await sync.bootstrap();
      toast('Offline catalogue and stock refreshed for this branch.', 'success');
    } catch (bootstrapError) {
      toast(errorMessage(bootstrapError), 'error');
    } finally {
      setBusy(null);
    }
  };

  const runSync = async () => {
    setBusy('sync');
    try {
      await sync.syncNow();
      toast('Sync check complete.', 'success');
    } catch (syncError) {
      toast(errorMessage(syncError), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!can('sync:read')) {
    return (
      <div>
        <PageHeader title="Offline sync" eyebrow="Reliability" />
        <PermissionNotice area="offline sync diagnostics" />
      </div>
    );
  }

  const openLocalConflicts = (localConflicts ?? []).filter((conflict) => conflict.status === 'OPEN');
  const serverConflicts = sync.serverConflicts?.conflicts ?? [];
  const openServerConflicts = serverConflicts.filter((conflict) => conflict.status === 'OPEN');
  const totalConflicts = new Set([
    ...openLocalConflicts.map((conflict) => conflict.clientId),
    ...openServerConflicts.map((conflict) => conflict.clientId),
  ]).size;
  const canManage = can('sync:manage');

  return (
    <div>
      <PageHeader
        eyebrow="Reliability"
        title="Offline sync"
        description="Every sale is written to this device first, then reconciled with the server. Where stock is short, nothing is deleted: the sale stays as a conflict for you to decide."
        actions={
          <>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => void refreshCatalogue()}
              disabled={busy === 'bootstrap' || !sync.online}
            >
              <DownloadCloud className={cn('h-3.5 w-3.5', busy === 'bootstrap' && 'animate-pulse')} />
              Refresh catalogue
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => void runSync()}
              disabled={busy === 'sync' || sync.syncing || !sync.online}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', (busy === 'sync' || sync.syncing) && 'animate-spin')} />
              Sync now
            </button>
          </>
        }
      />

      {!sync.online ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2.5 text-xs text-accent-900">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            This device is offline. Sales continue to queue locally. Do not clear browser storage: queued sales
            live here until they reach the server.
          </p>
        </div>
      ) : null}

      {sync.error ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{sync.error}</p>
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Connection"
          value={sync.online ? 'Online' : 'Offline'}
          detail={sync.online ? 'Server reachable from this device' : 'Sales are queued on this device'}
          icon={sync.online ? <Cloud className="h-5 w-5" /> : <CloudOff className="h-5 w-5" />}
          tone={sync.online ? 'brand' : 'amber'}
        />
        <StatCard
          label="Waiting to sync"
          value={String(sync.pendingCount)}
          detail={sync.pendingCount ? 'Queued sales that have not reached the server' : 'No unsent sales'}
          icon={<HardDrive className="h-5 w-5" />}
          tone={sync.pendingCount ? 'amber' : 'default'}
        />
        <StatCard
          label="Open conflicts"
          value={String(totalConflicts)}
          detail={totalConflicts ? 'Require a retry, void or recorded decision' : 'No unresolved conflicts'}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={totalConflicts ? 'red' : 'default'}
        />
        <StatCard
          label="Last successful sync"
          value={sync.lastSyncAt ? relativeTime(sync.lastSyncAt) : 'Never'}
          detail={sync.lastSyncAt ? formatDate(sync.lastSyncAt, true) : 'Sign in online to refresh the catalogue'}
          icon={<ShieldCheck className="h-5 w-5" />}
          tone="brand"
        />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-ink-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">This device&apos;s queue</h2>
              <p className="text-xs text-ink-500">
                Server-authoritative pricing and stock. A rejected sale is never silently removed.
              </p>
            </div>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search sale or error…"
              className="sm:w-56"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 border-b border-ink-100 px-4 py-2">
            {FILTERS.map((option) => {
              const count =
                option.id === 'ALL'
                  ? (outbox ?? []).length
                  : (outbox ?? []).filter((event) => event.status === option.id).length;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                    filter === option.id
                      ? 'bg-brand-700 text-white'
                      : 'bg-ink-100 text-ink-600 hover:bg-ink-200',
                  )}
                >
                  {option.label}
                  <span className={cn('ml-1', filter === option.id ? 'text-white/70' : 'text-ink-400')}>{count}</span>
                </button>
              );
            })}
          </div>

          {outbox === undefined ? (
            <TableSkeleton rows={5} cols={4} />
          ) : !rows.length ? (
            <EmptyState
              icon={<CheckCheck className="h-5 w-5" />}
              title={filter === 'ALL' ? 'Nothing queued on this device' : `No ${filter.toLowerCase()} sales`}
              description={
                filter === 'ALL'
                  ? 'Sales captured while offline appear here with their retry history.'
                  : 'Try another filter to see the rest of the queue.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Sale</th>
                    <th>Status</th>
                    <th>Captured</th>
                    <th className="text-right">Total</th>
                    <th>Attempts</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((event) => {
                    const sale = localSales?.find((row) => row.clientId === event.clientId);
                    const stale = event.status !== 'SYNCED' && event.attemptCount >= 3;
                    return (
                      <tr key={event.clientId}>
                        <td>
                          <p className="font-mono text-xs font-semibold text-ink-900">
                            {sale?.saleNumber ?? `LOCAL-${event.clientId.slice(0, 8).toUpperCase()}`}
                          </p>
                          <p className="max-w-[190px] truncate text-[11px] text-ink-400" title={event.clientId}>
                            {event.clientId}
                          </p>
                          {event.lastError ? (
                            <p className={cn('mt-1 max-w-[240px] text-[11px]', stale ? 'text-red-600' : 'text-accent-700')}>
                              {event.lastError}
                            </p>
                          ) : null}
                        </td>
                        <td>
                          <StatusBadge status={event.status} />
                        </td>
                        <td className="whitespace-nowrap">
                          <p className="text-xs text-ink-700">{formatDate(event.createdAt, true)}</p>
                          <p className="text-[11px] text-ink-400">{relativeTime(event.createdAt)}</p>
                        </td>
                        <td className="text-right font-mono text-xs text-ink-800">
                          {formatMoney(event.receipt.total, currency)}
                        </td>
                        <td>
                          <p className="text-xs text-ink-700">
                            {event.attemptCount}
                            {event.lastAttemptAt ? (
                              <span className="block text-[11px] text-ink-400">{relativeTime(event.lastAttemptAt)}</span>
                            ) : null}
                          </p>
                        </td>
                        <td className="text-right">
                          {event.status === 'SYNCED' ? (
                            <span className="text-[11px] text-ink-400">Recorded on server</span>
                          ) : (
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                onClick={() => void retry(event)}
                                disabled={busy === event.clientId || !sync.online}
                                title="Re-queue this sale"
                              >
                                <RotateCcw className="h-3.5 w-3.5" /> Retry
                              </button>
                              <button
                                type="button"
                                className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
                                onClick={() => {
                                  setDiscardTarget(event);
                                  setDiscardReason('');
                                }}
                                disabled={busy === event.clientId}
                                title="Void this queued sale locally"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Void
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">Sync conflicts</h2>
                <p className="text-xs text-ink-500">Preserved until a person decides.</p>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => void sync.refreshConflicts()}
                disabled={!sync.online}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </button>
            </div>
            {!openLocalConflicts.length ? (
              <EmptyState
                icon={<ShieldCheck className="h-5 w-5" />}
                title="No open conflicts"
                description="Sales that cannot be applied on the server will appear here, with the exact stock discrepancy."
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {openLocalConflicts.map((conflict) => {
                  const lines = conflictLines(conflict.details);
                  const server = latestServerConflict(conflict.clientId);
                  return (
                    <li key={conflict.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-[11px] font-semibold text-ink-800">
                            {saleNumberByClient.get(conflict.clientId) ?? conflict.clientId}
                          </p>
                          <p className="text-xs font-medium text-red-700">{titleCase(conflict.reason)}</p>
                          <p className="mt-0.5 text-[11px] text-ink-400">{relativeTime(conflict.createdAt)}</p>
                        </div>
                        <StatusBadge status="OPEN" />
                      </div>
                      {lines.map((line) => (
                        <div key={line.productName} className="mt-2 rounded-lg border border-red-100 bg-red-50/60 px-2.5 py-2 text-[11px] text-red-800">
                          <p className="font-semibold">{line.productName}</p>
                          <p>
                            Requested {formatQuantity(line.requested)} · available {formatQuantity(line.available)}
                          </p>
                        </div>
                      ))}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] font-medium text-ink-500">Technical detail</summary>
                        <pre className="scroll-thin mt-1 max-h-40 overflow-auto rounded bg-ink-50 p-2 text-[10px] text-ink-600">
                          {jsonPreview(conflict.details)}
                        </pre>
                      </details>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() =>
                            openConflict({
                              id: conflict.id,
                              clientId: conflict.clientId,
                              reason: conflict.reason,
                              details: conflict.details,
                              createdAt: conflict.createdAt,
                              deviceName: server?.deviceName,
                            })
                          }
                        >
                          <CheckCheck className="h-3.5 w-3.5" /> Record decision
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => {
                            const event = outbox?.find((row) => row.clientId === conflict.clientId);
                            if (event) void retry(event);
                          }}
                          disabled={!sync.online}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Retry
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
                          onClick={() => {
                            const event = outbox?.find((row) => row.clientId === conflict.clientId);
                            if (event) {
                              setDiscardTarget(event);
                              setDiscardReason('');
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Void
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="card">
            <div className="border-b border-ink-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-ink-900">Devices</h2>
              <p className="text-xs text-ink-500">
                {canManage ? 'Terminals registered to this business.' : 'Visible to owners and managers.'}
              </p>
            </div>
            {!canManage ? (
              <p className="px-4 py-6 text-xs text-ink-500">
                Device diagnostics require the sync management permission.
              </p>
            ) : !sync.serverConflicts ? (
              <div className="px-4 py-4">
                <ErrorState message="Device activity has not loaded yet." onRetry={() => void sync.refreshConflicts()} />
              </div>
            ) : !sync.serverConflicts.devices.length ? (
              <p className="px-4 py-6 text-xs text-ink-500">No terminal has registered yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {sync.serverConflicts.devices.map((device) => (
                  <li key={device.id} className="flex items-start gap-2.5 px-4 py-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
                      <MonitorSmartphone className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-ink-800">{device.name}</p>
                      <p className="text-[11px] text-ink-500">
                        Seen {device.lastSeenAt ? relativeTime(device.lastSeenAt) : 'never'}
                        {device.lastSyncAt ? ` · synced ${relativeTime(device.lastSyncAt)}` : ''}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'mt-1 h-2 w-2 shrink-0 rounded-full',
                        device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < 86_400_000
                          ? 'bg-brand-500'
                          : 'bg-ink-300',
                      )}
                      title="Recently seen"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card card-pad">
            <div className="flex items-start gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-600">
                <Database className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs font-semibold text-ink-800">How reconciliation works</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-ink-500">
                  <li>Prices, tax and stock are recalculated on the server; the device total is only a provision.</li>
                  <li>A sale that cannot be applied is kept as a conflict — never dropped or overwritten.</li>
                  <li>Voiding requires a reason and leaves a local record for the audit trail.</li>
                  <li>Catalogue refresh replaces cached products and stock for the selected branch.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {canManage && serverConflicts.length ? (
        <div className="card overflow-hidden">
          <div className="border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-900">Server conflict register</h2>
            <p className="text-xs text-ink-500">
              Decisions recorded here are auditable and remain attached to the original terminal event.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Detected</th>
                  <th>Device</th>
                  <th>Sale</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Resolution</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {serverConflicts.map((conflict) => (
                  <tr key={conflict.id}>
                    <td className="whitespace-nowrap text-xs text-ink-600">{formatDate(conflict.createdAt, true)}</td>
                    <td className="text-xs text-ink-700">{conflict.deviceName}</td>
                    <td className="max-w-[180px] truncate font-mono text-[11px] text-ink-500" title={conflict.clientId}>
                      {saleNumberByClient.get(conflict.clientId) ?? conflict.clientId}
                    </td>
                    <td className="text-xs text-ink-700">{titleCase(conflict.reason)}</td>
                    <td>
                      <StatusBadge status={conflict.status} />
                    </td>
                    <td className="max-w-[240px] text-xs text-ink-600">{conflict.resolution ?? '—'}</td>
                    <td className="text-right">
                      {conflict.status === 'OPEN' ? (
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() =>
                            openConflict({
                              id: conflict.id,
                              clientId: conflict.clientId,
                              reason: conflict.reason,
                              details: conflict.details,
                              createdAt: conflict.createdAt,
                              deviceName: conflict.deviceName,
                            })
                          }
                        >
                          Resolve
                        </button>
                      ) : (
                        <span className="text-[11px] text-ink-400">
                          {conflict.resolvedAt ? relativeTime(conflict.resolvedAt) : 'Closed'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <Modal
        open={discardTarget !== null}
        onClose={() => setDiscardTarget(null)}
        title="Void this queued sale?"
        description="The sale stays in local history as a voided record; it will not be sent to the server."
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDiscardTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => void discard()}
              disabled={Boolean(busy) || discardReason.trim().length < 3}
            >
              {busy ? 'Voiding…' : 'Void sale'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
            {discardTarget ? (
              <>
                Local sale{' '}
                <span className="font-mono font-semibold text-ink-800">
                  {saleNumberByClient.get(discardTarget.clientId) ?? discardTarget.clientId.slice(0, 12)}
                </span>{' '}
                for {formatMoney(discardTarget.receipt.total, currency)}.
              </>
            ) : null}
          </p>
          <Field
            label="Reason"
            htmlFor="discard-reason"
            required
            hint="Stored with the voided record. The cashier and owner can see it."
          >
            <textarea
              id="discard-reason"
              className="textarea"
              rows={3}
              value={discardReason}
              onChange={(event) => setDiscardReason(event.target.value)}
              placeholder="e.g. Duplicate entry created while reconnecting"
              maxLength={300}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={resolveTarget !== null}
        onClose={() => setResolveTarget(null)}
        title="Record conflict decision"
        description="This records what was decided. Retry or void the queued sale to apply it."
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setResolveTarget(null)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={() => void resolveConflict()} disabled={Boolean(busy)}>
              {busy ? 'Saving…' : 'Record decision'}
            </button>
          </>
        }
      >
        {resolveTarget ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-600">
              <p className="font-mono font-semibold text-ink-800">
                {saleNumberByClient.get(resolveTarget.clientId) ?? resolveTarget.clientId}
              </p>
              <p className="mt-0.5">
                {titleCase(resolveTarget.reason)} · {formatDate(resolveTarget.createdAt, true)}
                {resolveTarget.deviceName ? ` · ${resolveTarget.deviceName}` : ''}
              </p>
            </div>
            <pre className="scroll-thin max-h-40 overflow-auto rounded-lg bg-ink-950 p-3 font-mono text-[10px] text-ink-100">
              {jsonPreview(resolveTarget.details)}
            </pre>
            <Field label="Decision" htmlFor="resolution" required error={resolveError ?? undefined}>
              <textarea
                id="resolution"
                className="textarea"
                rows={3}
                value={resolution}
                onChange={(event) => setResolution(event.target.value)}
                placeholder="e.g. Recounted shelf: 2 units sold at the till, adjust stock and re-submit"
                maxLength={500}
              />
            </Field>
            {!latestServerConflict(resolveTarget.clientId) ? (
              <p className="text-[11px] text-ink-500">
                This decision is stored on the device only. The server registers the conflict when it receives
                the sale.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
