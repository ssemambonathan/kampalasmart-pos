'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowRightLeft, CheckCircle2, Eye, Plus, Trash2, XCircle } from 'lucide-react';
import type { Location, Paginated, Product, StockTransfer } from '@kampalasmart/shared';
import { TRANSFER_STATUSES } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney, formatQuantity, titleCase } from '@/lib/format';
import { DateRangeFilter, useDateRange } from '@/components/date-range';
import { PermissionNotice } from '@/components/export-button';
import { ProductCombobox } from '@/components/product-combobox';
import { useToast } from '@/components/toast';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  KeyValue,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Spinner,
  StatusBadge,
  TableSkeleton,
  useDebounced,
} from '@/components/ui';

interface DraftLine {
  key: string;
  product: Product | null;
  quantity: string;
}

function makeLine(): DraftLine {
  return { key: crypto.randomUUID(), product: null, quantity: '1' };
}

function inputQuantity(value: string | number): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return String(Number(amount.toFixed(3)));
}

export default function TransfersPage() {
  const { business, user, activeLocationId, can } = useAuth();
  const currency = business?.currency ?? 'UGX';
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [status, setStatus] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const range = useDateRange('30d');

  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<Location[]>('/locations'),
    enabled: can('inventory:transfer'),
    staleTime: 60_000,
  });

  const filters = {
    page,
    pageSize: 20,
    search: debounced || undefined,
    status: status || undefined,
    fromLocationId: fromFilter || undefined,
    toLocationId: toFilter || undefined,
    from: range.bounds.from,
    to: range.bounds.to,
  };

  const transfers = useQuery({
    queryKey: ['transfers', filters],
    queryFn: () => api.get<Paginated<StockTransfer>>('/transfers', filters),
    enabled: can('inventory:transfer'),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [fromLocation, setFromLocation] = useState('');
  const [toLocation, setToLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState<DraftLine[]>([makeLine()]);
  const [createError, setCreateError] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [confirm, setConfirm] = useState<'approve' | 'complete' | 'cancel' | null>(null);

  const detail = useQuery({
    queryKey: ['transfer', detailId],
    queryFn: () => api.get<StockTransfer>(`/transfers/${detailId}`),
    enabled: Boolean(detailId) && can('inventory:transfer'),
  });

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<StockTransfer>('/transfers', payload),
    onSuccess: async (transfer) => {
      toast(`Transfer ${transfer.transferNumber} requested. Stock has not moved yet.`, 'success');
      setCreateOpen(false);
      resetCreate();
      await queryClient.invalidateQueries({ queryKey: ['transfers'] });
    },
    onError: (error) => setCreateError(errorMessage(error)),
  });

  const action = useMutation({
    mutationFn: ({ id, path, body }: { id: string; path: 'approve' | 'complete' | 'reject' | 'cancel'; body?: Record<string, unknown> }) =>
      api.post<StockTransfer>(`/transfers/${id}/${path}`, body),
    onSuccess: async (_transfer, variables) => {
      const messages: Record<typeof variables.path, string> = {
        approve: 'Transfer approved. Stock still has to be completed to move.',
        complete: 'Stock moved between branches. The ledger has both sides.',
        reject: 'Transfer rejected. The requester has been notified.',
        cancel: 'Transfer cancelled. The record stays in history.',
      };
      toast(messages[variables.path], 'success');
      setRejectOpen(false);
      setConfirm(null);
      setRejectReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['transfers'] }),
        queryClient.invalidateQueries({ queryKey: ['transfer', detailId] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      ]);
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  if (!can('inventory:transfer')) return <PermissionNotice area="stock transfers" />;

  const resetCreate = () => {
    setFromLocation('');
    setToLocation('');
    setNotes('');
    setDraft([makeLine()]);
    setCreateError('');
  };

  const openCreate = () => {
    resetCreate();
    setFromLocation(activeLocationId || locations.data?.[0]?.id || '');
    setCreateOpen(true);
  };

  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setDraft((lines) => lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const chooseProduct = (line: DraftLine, product: Product | null) => {
    if (product && draft.some((entry) => entry.key !== line.key && entry.product?.id === product.id)) {
      setCreateError(`${product.name} is already on this transfer. Change its quantity instead of adding it twice.`);
      setLine(line.key, { product: null });
      return;
    }
    setCreateError('');
    setLine(line.key, { product });
  };

  const estimatedValue = draft.reduce((total, line) => {
    if (!line.product) return total;
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return total;
    return total + Math.round(quantity * Number(line.product.costPrice) * 100) / 100;
  }, 0);

  const submitCreate = () => {
    setCreateError('');
    if (!fromLocation) return setCreateError('Choose the branch the stock is leaving.');
    if (!toLocation) return setCreateError('Choose the branch the stock is going to.');
    if (fromLocation === toLocation) return setCreateError('Choose two different branches.');
    const lines = draft.filter((line) => line.product);
    if (!lines.length) return setCreateError('Add at least one product.');
    for (const line of lines) {
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) return setCreateError(`Enter a quantity for ${line.product?.name}.`);
    }
    create.mutate({
      fromLocationId: fromLocation,
      toLocationId: toLocation,
      notes: notes.trim() || null,
      items: lines.map((line) => ({ productId: line.product!.id, quantity: inputQuantity(line.quantity) })),
    });
  };

  const openDetail = (id: string) => {
    setDetailId(id);
    setRejectOpen(false);
    setConfirm(null);
  };

  const canApprove = can('inventory:transfer:approve');
  const selfRequested = Boolean(detail.data && user && detail.data.requestedByName === user.name);
  const approvalBlocked = selfRequested && user?.role !== 'OWNER';
  const canCancel = Boolean(
    detail.data?.status === 'PENDING' && user && (detail.data.requestedByName === user.name || user.role === 'OWNER'),
  );

  return (
    <div>
      <PageHeader
        title="Stock transfers"
        eyebrow="Between branches"
        description="A transfer is requested, approved by someone else, and only then completed. Completion writes both ledger sides; approval alone moves nothing."
        actions={
          can('inventory:transfer') ? (
            <button type="button" className="btn-primary btn-sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> New transfer
            </button>
          ) : null
        }
      />

      <div className="card mb-4 p-3">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search transfer number or notes…"
            className="xl:w-72"
          />
          <select
            className="select !w-auto text-xs"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {TRANSFER_STATUSES.map((option) => (
              <option key={option} value={option}>
                {titleCase(option)}
              </option>
            ))}
          </select>
          <select
            className="select !w-auto text-xs"
            value={fromFilter}
            onChange={(event) => {
              setFromFilter(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by source branch"
          >
            <option value="">Any source</option>
            {(locations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                From {location.name}
              </option>
            ))}
          </select>
          <select
            className="select !w-auto text-xs"
            value={toFilter}
            onChange={(event) => {
              setToFilter(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by destination branch"
          >
            <option value="">Any destination</option>
            {(locations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                To {location.name}
              </option>
            ))}
          </select>
          <DateRangeFilter
            className="xl:ml-auto"
            preset={range.preset}
            range={range.range}
            onPreset={(next) => {
              range.setPreset(next);
              setPage(1);
            }}
            onRange={(next) => {
              range.setRange(next);
              setPage(1);
            }}
          />
        </div>
      </div>

      <div className="card overflow-hidden">
        {transfers.isLoading ? (
          <TableSkeleton rows={7} cols={6} />
        ) : transfers.isError ? (
          <ErrorState message={errorMessage(transfers.error)} onRetry={() => void transfers.refetch()} />
        ) : !transfers.data?.data.length ? (
          <EmptyState
            icon={<ArrowRightLeft className="h-5 w-5" />}
            title="No transfers in this range"
            description="Create a transfer to move stock between branches with an approval step."
            action={
              <button type="button" className="btn-primary btn-sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" /> New transfer
              </button>
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Transfer</th>
                    <th>Route</th>
                    <th>Status</th>
                    <th className="text-right">Lines</th>
                    <th>Requested by</th>
                    <th>When</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {transfers.data.data.map((transfer) => (
                    <tr key={transfer.id}>
                      <td>
                        <button
                          type="button"
                          className="font-mono text-xs font-semibold text-brand-700 hover:underline"
                          onClick={() => openDetail(transfer.id)}
                        >
                          {transfer.transferNumber}
                        </button>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5 text-xs text-ink-600">
                          <span>{transfer.fromLocationName}</span>
                          <ArrowRight className="h-3 w-3 text-ink-400" />
                          <span>{transfer.toLocationName}</span>
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={transfer.status} />
                      </td>
                      <td className="text-right font-mono text-xs">{transfer.items.length}</td>
                      <td className="text-xs text-ink-500">{transfer.requestedByName ?? '—'}</td>
                      <td className="whitespace-nowrap text-xs text-ink-500">{formatDate(transfer.createdAt)}</td>
                      <td className="text-right">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => openDetail(transfer.id)}>
                          <Eye className="h-3.5 w-3.5" /> View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={transfers.data.page}
              pageSize={transfers.data.pageSize}
              total={transfers.data.total}
              onPage={setPage}
            />
          </>
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New stock transfer"
        description="Request stock to move between branches. Nothing is deducted until an approved transfer is completed."
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)} disabled={create.isPending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={submitCreate} disabled={create.isPending}>
              {create.isPending ? <Spinner /> : <ArrowRightLeft className="h-4 w-4" />}
              Request transfer
            </button>
          </>
        }
      >
        {createError ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{createError}</div>
        ) : null}
        <div className="space-y-4">
          <div className="field-row">
            <Field label="From branch" required>
              <select className="select" value={fromLocation} onChange={(event) => setFromLocation(event.target.value)}>
                <option value="">Choose source…</option>
                {(locations.data ?? []).filter((location) => location.isActive).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To branch" required>
              <select className="select" value={toLocation} onChange={(event) => setToLocation(event.target.value)}>
                <option value="">Choose destination…</option>
                {(locations.data ?? [])
                  .filter((location) => location.isActive && location.id !== fromLocation)
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea className="input min-h-16" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} />
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-600">Products</p>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setDraft((lines) => [...lines, makeLine()])}>
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            </div>
            <div className="space-y-2">
              {draft.map((line, index) => (
                <div key={line.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-start">
                  <ProductCombobox
                    value={line.product}
                    onChange={(product) => chooseProduct(line, product)}
                    locationId={fromLocation || undefined}
                    showStock
                    disabled={!fromLocation}
                    placeholder={fromLocation ? 'Search product and see source stock…' : 'Choose the source branch first'}
                    autoFocus={index === draft.length - 1 && !line.product && draft.length > 1}
                  />
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={0.001}
                    value={line.quantity}
                    onChange={(event) => setLine(line.key, { quantity: event.target.value })}
                    aria-label={`Transfer quantity for line ${index + 1}`}
                  />
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
                    onClick={() => setDraft((lines) => (lines.length === 1 ? [makeLine()] : lines.filter((entry) => entry.key !== line.key)))}
                    aria-label={`Remove line ${index + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-right text-xs text-ink-500">
              Estimated value at current cost: <span className="font-mono font-semibold text-ink-800">{formatMoney(estimatedValue, currency)}</span>
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={detail.data?.transferNumber ?? 'Stock transfer'}
        description={detail.data ? `${detail.data.fromLocationName} to ${detail.data.toLocationName}` : undefined}
        size="lg"
        footer={
          <>
            {detail.data?.status === 'PENDING' && canApprove ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => setConfirm('approve')}
                disabled={approvalBlocked}
                title={approvalBlocked ? 'A transfer must be approved by someone other than the requester.' : undefined}
              >
                <CheckCircle2 className="h-4 w-4" /> Approve
              </button>
            ) : null}
            {detail.data?.status === 'PENDING' && canApprove ? (
              <button type="button" className="btn-danger" onClick={() => setRejectOpen(true)}>
                <XCircle className="h-4 w-4" /> Reject
              </button>
            ) : null}
            {detail.data?.status === 'APPROVED' ? (
              <button type="button" className="btn-primary" onClick={() => setConfirm('complete')}>
                <ArrowRightLeft className="h-4 w-4" /> Complete transfer
              </button>
            ) : null}
            {detail.data?.status === 'PENDING' && canCancel ? (
              <button type="button" className="btn-secondary" onClick={() => setConfirm('cancel')}>
                Cancel request
              </button>
            ) : null}
            <button type="button" className="btn-secondary" onClick={() => setDetailId(null)}>
              Close
            </button>
          </>
        }
      >
        {detail.isLoading ? (
          <div className="grid place-items-center py-12">
            <Spinner />
          </div>
        ) : detail.isError || !detail.data ? (
          <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-ink-200 p-3">
                <KeyValue label="Status">
                  <StatusBadge status={detail.data.status} />
                </KeyValue>
                <KeyValue label="From">{detail.data.fromLocationName}</KeyValue>
                <KeyValue label="To">{detail.data.toLocationName}</KeyValue>
                <KeyValue label="Requested by">{detail.data.requestedByName ?? '—'}</KeyValue>
                <KeyValue label="Approved by">{detail.data.approvedByName ?? '—'}</KeyValue>
              </div>
              <div className="rounded-lg border border-ink-200 p-3">
                <KeyValue label="Requested">{formatDate(detail.data.createdAt, true)}</KeyValue>
                <KeyValue label="Completed">
                  {detail.data.completedAt ? formatDate(detail.data.completedAt, true) : 'Not yet'}
                </KeyValue>
                <KeyValue label="Lines">{detail.data.items.length}</KeyValue>
              </div>
            </div>

            {detail.data.status === 'PENDING' && approvalBlocked ? (
              <p className="rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-xs text-accent-800">
                You requested this transfer, so another manager or the owner must approve it. This separation keeps stock
                movements accountable.
              </p>
            ) : null}
            {detail.data.notes ? (
              <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">{detail.data.notes}</p>
            ) : null}

            <div className="overflow-hidden rounded-lg border border-ink-200">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">Quantity</th>
                    <th className="text-right">Unit cost</th>
                    <th className="text-right">Line value</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <p className="text-sm font-medium text-ink-900">{item.productName}</p>
                        <p className="font-mono text-[10px] text-ink-400">{item.sku}</p>
                      </td>
                      <td className="text-right font-mono text-xs">{formatQuantity(item.quantity)}</td>
                      <td className="text-right font-mono text-xs">{formatMoney(item.unitCost, currency)}</td>
                      <td className="text-right font-mono text-xs font-semibold">
                        {formatMoney(Number(item.quantity) * Number(item.unitCost), currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject transfer"
        description="Rejecting keeps the request in history and notifies the requester."
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRejectOpen(false)} disabled={action.isPending}>
              Back
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={action.isPending}
              onClick={() => {
                if (detail.data) action.mutate({ id: detail.data.id, path: 'reject', body: { reason: rejectReason.trim() || null } });
              }}
            >
              {action.isPending ? <Spinner /> : <XCircle className="h-4 w-4" />}
              Reject transfer
            </button>
          </>
        }
      >
        <Field label="Reason" hint="Shared with the person who requested the transfer.">
          <textarea
            className="input min-h-20"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            maxLength={500}
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={confirm === 'approve'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (detail.data) action.mutate({ id: detail.data.id, path: 'approve' });
        }}
        title="Approve this transfer?"
        message="Approval does not move stock. Someone must still complete the transfer, which deducts from the source branch and adds to the destination."
        confirmLabel="Approve"
        busy={action.isPending}
      />

      <ConfirmDialog
        open={confirm === 'complete'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (detail.data) action.mutate({ id: detail.data.id, path: 'complete' });
        }}
        title="Complete this transfer?"
        message="Stock will leave the source branch and arrive at the destination now. Both movements are written to the ledger and cannot be edited."
        confirmLabel="Complete transfer"
        busy={action.isPending}
      />

      <ConfirmDialog
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (detail.data) action.mutate({ id: detail.data.id, path: 'cancel' });
        }}
        title="Cancel this transfer request?"
        message="The request will be marked cancelled. No stock has moved, and the record remains in history."
        confirmLabel="Cancel request"
        tone="danger"
        busy={action.isPending}
      />
    </div>
  );
}
