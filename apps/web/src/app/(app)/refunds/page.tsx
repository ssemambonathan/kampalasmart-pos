'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RotateCcw, XCircle } from 'lucide-react';
import type { Paginated, Refund } from '@kampalasmart/shared';
import { REFUND_STATUSES } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney, formatQuantity, titleCase } from '@/lib/format';
import { DateRangeFilter, useDateRange } from '@/components/date-range';
import { PermissionNotice } from '@/components/export-button';
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
  Tabs,
  useDebounced,
} from '@/components/ui';

type StatusTab = 'ALL' | (typeof REFUND_STATUSES)[number];

export default function RefundsPage() {
  const { business, activeLocationId, can, user } = useAuth();
  const currency = business?.currency ?? 'UGX';
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<StatusTab>('ALL');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);
  const range = useDateRange('30d');
  const [selected, setSelected] = useState<Refund | null>(null);
  const [approveTarget, setApproveTarget] = useState<Refund | null>(null);
  const [completeTarget, setCompleteTarget] = useState<Refund | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Refund | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Refund | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  const filters = {
    page,
    pageSize: 20,
    status: tab === 'ALL' ? undefined : tab,
    search: debouncedSearch || undefined,
    locationId: activeLocationId || undefined,
    from: range.bounds.from,
    to: range.bounds.to,
  };

  const refunds = useQuery({
    queryKey: ['refunds', filters],
    queryFn: () => api.get<Paginated<Refund>>('/refunds', filters),
    enabled: can('refunds:read'),
  });

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['refunds'] }),
      queryClient.invalidateQueries({ queryKey: ['sale'] }),
      queryClient.invalidateQueries({ queryKey: ['sales'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    ]);
  };

  const action = useMutation({
    mutationFn: async ({ id, verb, body }: { id: string; verb: 'approve' | 'complete' | 'cancel' | 'reject'; body?: unknown }) =>
      api.post<Refund>(`/refunds/${id}/${verb}`, body),
    onSuccess: async (_result, variables) => {
      const messages: Record<string, string> = {
        approve: 'Refund approved. It can now be completed.',
        complete: 'Refund completed. Stock has been restored where requested.',
        cancel: 'Refund request cancelled.',
        reject: 'Refund request rejected.',
      };
      toast(messages[variables.verb], 'success');
      setApproveTarget(null);
      setCompleteTarget(null);
      setCancelTarget(null);
      setRejectTarget(null);
      setRejectReason('');
      setSelected(null);
      await refreshAll();
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  if (!can('refunds:read')) return <PermissionNotice area="refunds" />;

  const canApprove = can('refunds:approve');
  const rows = refunds.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Refunds"
        eyebrow="Controlled reversals"
        description={`Refunds never edit or delete the original sale. Threshold for manager approval: ${formatMoney(
          business?.refundApprovalThreshold ?? '0',
          currency,
        )}.`}
      />

      <div className="mb-4">
        <Tabs<StatusTab>
          tabs={[
            { id: 'ALL', label: 'All requests' },
            ...REFUND_STATUSES.map((status) => ({ id: status as StatusTab, label: titleCase(status) })),
          ]}
          active={tab}
          onChange={(next) => {
            setTab(next);
            setPage(1);
          }}
        />
      </div>

      <div className="card mb-4 p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search refund or sale number, reason…"
            className="lg:w-80"
          />
          <DateRangeFilter
            className="lg:ml-auto"
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
        {refunds.isLoading ? (
          <TableSkeleton rows={7} cols={6} />
        ) : refunds.isError ? (
          <ErrorState message={errorMessage(refunds.error)} onRetry={() => void refunds.refetch()} />
        ) : !rows.length ? (
          <EmptyState
            icon={<RotateCcw className="h-5 w-5" />}
            title="No refunds in this view"
            description="Refund requests created from a sale receipt appear here for review and approval."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Refund</th>
                    <th>Sale</th>
                    <th>Requested</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((refund) => {
                    const mine = refund.requestedByName === user?.name;
                    const canCancel = refund.status === 'PENDING' && (mine || user?.role === 'OWNER');
                    return (
                      <tr key={refund.id}>
                        <td>
                          <button
                            type="button"
                            className="font-mono text-xs font-semibold text-brand-700 hover:underline"
                            onClick={() => setSelected(refund)}
                          >
                            {refund.refundNumber}
                          </button>
                          <p className="text-[10px] text-ink-400">{formatDate(refund.createdAt, true)}</p>
                        </td>
                        <td>
                          <Link href={`/sales/${refund.saleId}`} className="font-mono text-xs text-ink-700 hover:underline">
                            {refund.saleNumber}
                          </Link>
                        </td>
                        <td className="text-xs text-ink-600">{refund.requestedByName ?? '—'}</td>
                        <td className="max-w-[240px] truncate text-xs text-ink-600" title={refund.reason}>
                          {refund.reason}
                        </td>
                        <td>
                          <StatusBadge status={refund.status} />
                        </td>
                        <td className="whitespace-nowrap text-right font-mono text-sm font-semibold">
                          {formatMoney(refund.total, currency)}
                        </td>
                        <td>
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {refund.status === 'PENDING' && canApprove && !mine ? (
                              <button type="button" className="btn-secondary btn-sm" onClick={() => setApproveTarget(refund)}>
                                <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                              </button>
                            ) : null}
                            {refund.status === 'APPROVED' && canApprove ? (
                              <button type="button" className="btn-primary btn-sm" onClick={() => setCompleteTarget(refund)}>
                                <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                              </button>
                            ) : null}
                            {refund.status === 'PENDING' && canApprove && !mine ? (
                              <button
                                type="button"
                                className="btn-ghost btn-sm text-red-600"
                                onClick={() => {
                                  setRejectTarget(refund);
                                  setRejectReason('');
                                  setRejectError('');
                                }}
                              >
                                <XCircle className="h-3.5 w-3.5" /> Reject
                              </button>
                            ) : null}
                            {canCancel ? (
                              <button type="button" className="btn-ghost btn-sm text-ink-500" onClick={() => setCancelTarget(refund)}>
                                Cancel
                              </button>
                            ) : null}
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setSelected(refund)}>
                              View
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {refunds.data ? (
              <Pagination
                page={refunds.data.page}
                pageSize={refunds.data.pageSize}
                total={refunds.data.total}
                onPage={setPage}
              />
            ) : null}
          </>
        )}
      </div>

      <div className="mt-3 rounded-xl border border-ink-200 bg-ink-50/60 px-4 py-3 text-xs leading-relaxed text-ink-500">
        Approvals follow segregation of duties: a refund must be approved by someone other than the person
        who requested it, and amounts above the threshold require the owner. Completing an approved refund
        restores stock only for lines marked as restockable, and is recorded in the inventory ledger and audit trail.
      </div>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `Refund ${selected.refundNumber}` : 'Refund'}
        description={selected ? `Sale ${selected.saleNumber}` : undefined}
        size="lg"
        footer={
          <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>
            Close
          </button>
        }
      >
        {selected ? (
          <div>
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-ink-200 p-3">
                <KeyValue label="Status">
                  <StatusBadge status={selected.status} />
                </KeyValue>
                <KeyValue label="Amount">{formatMoney(selected.total, currency)}</KeyValue>
                <KeyValue label="Requested by">{selected.requestedByName ?? '—'}</KeyValue>
                <KeyValue label="Requested">{formatDate(selected.createdAt, true)}</KeyValue>
              </div>
              <div className="rounded-lg border border-ink-200 p-3">
                <KeyValue label="Approved by">{selected.approvedByName ?? 'Awaiting approval'}</KeyValue>
                <KeyValue label="Approved at">{selected.approvedAt ? formatDate(selected.approvedAt, true) : '—'}</KeyValue>
                <KeyValue label="Sale">
                  <Link href={`/sales/${selected.saleId}`} className="text-brand-700 hover:underline">
                    {selected.saleNumber}
                  </Link>
                </KeyValue>
              </div>
            </div>
            <p className="mb-3 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
              <span className="font-semibold text-ink-700">Reason:</span> {selected.reason}
            </p>
            <div className="overflow-hidden rounded-lg border border-ink-200">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">Quantity</th>
                    <th className="text-right">Amount</th>
                    <th>Restock</th>
                  </tr>
                </thead>
                <tbody>
                  {(selected.items ?? []).map((item) => (
                    <tr key={item.id}>
                      <td>
                        <p className="text-sm font-medium text-ink-900">{item.productName}</p>
                        <p className="font-mono text-[10px] text-ink-400">{item.sku}</p>
                      </td>
                      <td className="text-right font-mono text-xs">{formatQuantity(item.quantity)}</td>
                      <td className="text-right font-mono text-xs">{formatMoney(item.amount, currency)}</td>
                      <td className="text-xs">{item.restock ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(approveTarget)}
        onClose={() => setApproveTarget(null)}
        onConfirm={() => approveTarget && action.mutate({ id: approveTarget.id, verb: 'approve' })}
        title="Approve refund?"
        message={
          approveTarget
            ? `Approve ${approveTarget.refundNumber} for ${formatMoney(approveTarget.total, currency)}? An authorised user can then complete it and restore stock.`
            : ''
        }
        confirmLabel="Approve refund"
        busy={action.isPending}
      />

      <ConfirmDialog
        open={Boolean(completeTarget)}
        onClose={() => setCompleteTarget(null)}
        onConfirm={() => completeTarget && action.mutate({ id: completeTarget.id, verb: 'complete' })}
        title="Complete refund?"
        message={
          completeTarget
            ? `Completing ${completeTarget.refundNumber} records the refund as final, restores restockable items to stock, and updates the sale to partially or fully refunded. This cannot be undone.`
            : ''
        }
        confirmLabel="Complete refund"
        busy={action.isPending}
      />

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => cancelTarget && action.mutate({ id: cancelTarget.id, verb: 'cancel' })}
        title="Cancel refund request?"
        message="The request will be marked cancelled. No stock or money moves."
        confirmLabel="Cancel request"
        tone="danger"
        busy={action.isPending}
      />

      <Modal
        open={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
        title="Reject refund"
        description="The requester is notified with your reason."
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRejectTarget(null)} disabled={action.isPending}>
              Back
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={action.isPending}
              onClick={() => {
                if (!rejectTarget) return;
                if (rejectReason.trim().length < 3) {
                  setRejectError('Give a reason for rejecting the refund.');
                  return;
                }
                setRejectError('');
                action.mutate({ id: rejectTarget.id, verb: 'reject', body: { reason: rejectReason.trim() } });
              }}
            >
              {action.isPending ? <Spinner /> : null} Reject refund
            </button>
          </>
        }
      >
        <Field label="Reason" htmlFor="reject-reason" required error={rejectError}>
          <textarea
            id="reject-reason"
            className="input min-h-20"
            value={rejectReason}
            maxLength={500}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Explain why this refund cannot be approved."
          />
        </Field>
      </Modal>
    </div>
  );
}
