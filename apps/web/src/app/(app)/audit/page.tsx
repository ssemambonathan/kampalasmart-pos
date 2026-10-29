'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, FilterX, ShieldCheck } from 'lucide-react';
import type { AuditLogEntry, Paginated } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatNumber, relativeTime, titleCase } from '@/lib/format';
import { DateRangeFilter, listBounds, useDateRange } from '@/components/date-range';
import { ExportButton, PermissionNotice } from '@/components/export-button';
import {
  EmptyState,
  ErrorState,
  KeyValue,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  TableSkeleton,
  cn,
  useDebounced,
} from '@/components/ui';

const PAGE_SIZE = 25;

function actionTone(action: string): string {
  if (/failed|unauthorized|conflict|rejected|deactivated|archived|void/.test(action)) {
    return 'bg-red-50 text-red-700 border-red-200';
  }
  if (/created|completed|approved|received|synced|verified/.test(action)) {
    return 'bg-brand-50 text-brand-700 border-brand-200';
  }
  if (/login|logout|password|session|token/.test(action)) {
    return 'bg-sky-50 text-sky-700 border-sky-200';
  }
  if (/adjusted|reconciled|updated|changed|returned/.test(action)) {
    return 'bg-accent-50 text-accent-800 border-accent-200';
  }
  return 'bg-ink-100 text-ink-700 border-ink-200';
}

function ActionBadge({ action }: { action: string }) {
  const [group, verb] = action.split('.');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        actionTone(action),
      )}
      title={action}
    >
      <span className="opacity-60">{titleCase(group)}</span>
      <span>{titleCase(verb ?? action)}</span>
    </span>
  );
}

function Snapshot({ value, empty }: { value: unknown; empty: string }) {
  if (value === null || value === undefined) {
    return <p className="rounded-lg bg-ink-50 px-3 py-4 text-xs text-ink-500">{empty}</p>;
  }
  return (
    <pre className="scroll-thin max-h-72 overflow-auto rounded-lg bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-ink-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function AuditPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  const debouncedSearch = useDebounced(search, 300);
  const range = useDateRange('30d');
  const bounds = listBounds(range.range);

  const actions = useQuery({
    queryKey: ['audit-actions'],
    queryFn: () => api.get<Array<{ action: string; count: number }>>('/audit/actions'),
    enabled: can('audit:read'),
  });

  const events = useQuery({
    queryKey: ['audit', page, debouncedSearch, action, entityType, bounds.from, bounds.to],
    queryFn: () =>
      api.get<Paginated<AuditLogEntry>>('/audit', {
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
        action: action || undefined,
        entityType: entityType || undefined,
        from: bounds.from || undefined,
        to: bounds.to || undefined,
      }),
    enabled: can('audit:read'),
  });

  const exportQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (action) params.set('action', action);
    if (entityType) params.set('entityType', entityType);
    if (bounds.from) params.set('from', bounds.from);
    if (bounds.to) params.set('to', bounds.to);
    const query = params.toString();
    return `/audit/export${query ? `?${query}` : ''}`;
  }, [debouncedSearch, action, entityType, bounds.from, bounds.to]);

  const hasFilters = Boolean(debouncedSearch || action || entityType);

  const resetFilters = () => {
    setSearch('');
    setAction('');
    setEntityType('');
    setPage(1);
  };

  if (!can('audit:read')) {
    return (
      <div>
        <PageHeader title="Audit trail" eyebrow="Accountability" />
        <PermissionNotice area="the audit trail" />
      </div>
    );
  }

  const rows = events.data?.data ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Accountability"
        title="Audit trail"
        description="An append-only record of every material change: who acted, what changed and when. Entries cannot be edited or deleted."
        actions={<ExportButton path={exportQuery} label="Export audit log" />}
      />

      <div className="card card-pad mb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search action, entity, person or reason…"
            className="lg:w-80"
          />
          <select
            className="select lg:w-56"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by action"
          >
            <option value="">All actions</option>
            {(actions.data ?? []).map((option) => (
              <option key={option.action} value={option.action}>
                {option.action} ({option.count})
              </option>
            ))}
          </select>
          <input
            className="input lg:w-44"
            value={entityType}
            onChange={(event) => {
              setEntityType(event.target.value.trim());
              setPage(1);
            }}
            placeholder="Entity, e.g. Sale"
            aria-label="Filter by entity type"
          />
          <DateRangeFilter
            preset={range.preset}
            range={range.range}
            onPreset={(preset) => {
              range.setPreset(preset);
              setPage(1);
            }}
            onRange={(next) => {
              range.setRange(next);
              setPage(1);
            }}
            compact
          />
          {hasFilters ? (
            <button type="button" className="btn-ghost btn-sm" onClick={resetFilters}>
              <FilterX className="h-3.5 w-3.5" /> Clear
            </button>
          ) : null}
          <p className="text-xs text-ink-500 lg:ml-auto">
            {events.data ? `${formatNumber(events.data.total)} matching event${events.data.total === 1 ? '' : 's'}` : '…'}
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        {events.isLoading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : events.isError ? (
          <ErrorState message={errorMessage(events.error)} onRetry={() => void events.refetch()} />
        ) : !rows.length ? (
          <EmptyState
            icon={<ShieldCheck className="h-5 w-5" />}
            title="No audit events in this view"
            description={
              hasFilters
                ? 'No entries match these filters. Try widening the date range or clearing the search.'
                : 'Activity will appear here as soon as your team records sales, changes stock or updates settings.'
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Actor</th>
                    <th>Reason</th>
                    <th className="text-right">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap">
                        <p className="text-sm font-medium text-ink-900">{formatDate(entry.createdAt, true)}</p>
                        <p className="text-[11px] text-ink-400">{relativeTime(entry.createdAt)}</p>
                      </td>
                      <td>
                        <ActionBadge action={entry.action} />
                      </td>
                      <td>
                        <p className="text-sm text-ink-800">{entry.entityType}</p>
                        <p className="max-w-[160px] truncate font-mono text-[10px] text-ink-400" title={entry.entityId ?? undefined}>
                          {entry.entityId ?? '—'}
                        </p>
                      </td>
                      <td>
                        <p className="text-sm text-ink-800">{entry.actorName ?? 'System'}</p>
                        <p className="text-[11px] text-ink-400">{entry.actorRole ? titleCase(entry.actorRole) : 'automated'}</p>
                      </td>
                      <td>
                        <p className="max-w-[220px] truncate text-xs text-ink-600" title={entry.reason ?? undefined}>
                          {entry.reason ?? '—'}
                        </p>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => setSelected(entry)}
                          aria-label={`View audit event ${entry.action}`}
                        >
                          <Eye className="h-3.5 w-3.5" /> View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {events.data ? (
              <Pagination
                page={events.data.page}
                pageSize={events.data.pageSize}
                total={events.data.total}
                onPage={setPage}
              />
            ) : null}
          </>
        )}
      </div>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? titleCase(selected.action.replace('.', ' ')) : 'Audit event'}
        description={selected ? `${selected.id} · immutable record` : undefined}
        size="xl"
        footer={
          <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>
            Close
          </button>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <KeyValue label="Recorded">{formatDate(selected.createdAt, true)}</KeyValue>
              <KeyValue label="Actor">{selected.actorName ?? 'System'}</KeyValue>
              <KeyValue label="Role">{selected.actorRole ? titleCase(selected.actorRole) : '—'}</KeyValue>
              <KeyValue label="Entity">{selected.entityType}</KeyValue>
              <KeyValue label="Entity id">{selected.entityId ?? '—'}</KeyValue>
              <KeyValue label="Action code">{selected.action}</KeyValue>
              <KeyValue label="IP address">{selected.ip ?? 'not recorded'}</KeyValue>
              <KeyValue label="Reason">{selected.reason ?? '—'}</KeyValue>
              <KeyValue label="Client">{selected.userAgent ?? 'unknown'}</KeyValue>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">Before</p>
                <Snapshot value={selected.before} empty="No prior snapshot — this event created the record." />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">After</p>
                <Snapshot value={selected.after} empty="No resulting snapshot was recorded for this event." />
              </div>
            </div>
            <p className="text-xs text-ink-500">
              Audit records are appended at the moment of the action and are never modified by the application.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
