'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, Printer, RotateCcw, TriangleAlert } from 'lucide-react';
import type { PaymentMethod, Refund, Sale } from '@kampalasmart/shared';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney, formatQuantity, formatTime } from '@/lib/format';
import { useToast } from '@/components/toast';
import { ReceiptView, type ReceiptData } from '@/components/receipt';
import { printReceipt } from '@/lib/print';
import { PermissionNotice } from '@/components/export-button';
import {
  EmptyState,
  ErrorState,
  Field,
  KeyValue,
  Modal,
  PageHeader,
  Spinner,
  StatusBadge,
  TableSkeleton,
  cn,
} from '@/components/ui';

interface ReceiptResponse {
  business: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    logoUrl: string | null;
    currency: string;
    receiptFooter: string | null;
    taxEnabled: boolean;
    taxInclusive: boolean;
  };
  location: { id: string; name: string; address: string | null; phone: string | null };
  sale: Sale;
  customerPhone: string | null;
  issuedAt: string;
}

interface RefundResponse extends Refund {
  autoCompleted: boolean;
}

export default function SaleDetailPage() {
  const params = useParams<{ id: string }>();
  const saleId = params?.id ?? '';
  const { business, can } = useAuth();
  const currency = business?.currency ?? 'UGX';
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [method, setMethod] = useState<string>('');
  const [lines, setLines] = useState<Record<string, { selected: boolean; quantity: string }>>({});
  const [refundError, setRefundError] = useState('');
  const [refundKey, setRefundKey] = useState('');

  const sale = useQuery({
    queryKey: ['sale', saleId],
    queryFn: () => api.get<Sale>(`/sales/${saleId}`),
    enabled: Boolean(saleId) && can('sales:read:own'),
  });

  const receipt = useQuery({
    queryKey: ['sale-receipt', saleId],
    queryFn: () => api.get<ReceiptResponse>(`/sales/${saleId}/receipt`),
    enabled: Boolean(saleId) && can('sales:read:own'),
  });

  const receiptData = useMemo<ReceiptData | null>(() => {
    if (!receipt.data) return null;
    const data = receipt.data;
    return {
      businessName: data.business.name,
      address: data.business.address,
      phone: data.business.phone,
      footer: data.business.receiptFooter,
      currency: data.business.currency,
      reference: data.sale.saleNumber,
      branchName: data.location.name,
      cashierName: data.sale.cashierName,
      customerName: data.sale.customerName,
      createdAt: data.sale.createdAt,
      items: (data.sale.items ?? []).map((item) => ({
        name: item.productName,
        sku: item.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
      subtotal: data.sale.subtotal,
      discountTotal: data.sale.discountTotal,
      taxTotal: data.sale.taxTotal,
      total: data.sale.total,
      payments: (data.sale.payments ?? []).map((payment) => ({
        method: payment.method,
        amount: payment.amount,
        reference: payment.reference,
      })),
      pendingNote: null,
      taxLabel: 'Tax',
    };
  }, [receipt.data]);

  const refundMutation = useMutation({
    mutationFn: (payload: unknown) => api.post<RefundResponse>('/refunds', payload),
    onSuccess: async (result) => {
      toast(
        result.autoCompleted
          ? `Refund ${result.refundNumber} completed and stock updated.`
          : `Refund ${result.refundNumber} requested. A manager or owner must approve it.`,
        'success',
      );
      setRefundOpen(false);
      setReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sale', saleId] }),
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['refunds'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    },
    onError: (error) => setRefundError(errorMessage(error)),
  });

  if (!can('sales:read:own')) return <PermissionNotice area="sales" />;

  if (sale.isLoading) {
    return (
      <div className="card">
        <TableSkeleton rows={8} cols={5} />
      </div>
    );
  }
  if (sale.isError || !sale.data) {
    return (
      <div className="card">
        <ErrorState message={errorMessage(sale.error)} onRetry={() => void sale.refetch()} />
      </div>
    );
  }

  const data = sale.data;
  const items = data.items ?? [];
  const payments = data.payments ?? [];
  const refunds = data.refunds ?? [];
  const refundable =
    data.status !== 'REFUNDED' &&
    can('refunds:create') &&
    items.some((item) => Number(item.quantity) - Number(item.refundedQuantity) > 0);

  const openRefund = () => {
    const next: Record<string, { selected: boolean; quantity: string }> = {};
    for (const item of items) {
      const available = Number(item.quantity) - Number(item.refundedQuantity);
      next[item.id] = { selected: false, quantity: available > 0 ? String(available) : '0' };
    }
    setLines(next);
    setReason('');
    setRestock(true);
    setMethod(payments[0]?.method ?? 'CASH');
    setRefundError('');
    setRefundKey(crypto.randomUUID());
    setRefundOpen(true);
  };

  const submitRefund = () => {
    setRefundError('');
    const selected = Object.entries(lines).filter(([, line]) => line.selected);
    if (!selected.length) {
      setRefundError('Select at least one item to refund.');
      return;
    }
    for (const [saleItemId, line] of selected) {
      const item = items.find((row) => row.id === saleItemId);
      const available = item ? Number(item.quantity) - Number(item.refundedQuantity) : 0;
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setRefundError('Enter a refund quantity greater than zero for every selected item.');
        return;
      }
      if (quantity > available) {
        setRefundError(`Refund quantity exceeds the remaining quantity for ${item?.productName ?? 'an item'}.`);
        return;
      }
    }
    if (reason.trim().length < 3) {
      setRefundError('Give a short reason for the refund (at least 3 characters).');
      return;
    }
    refundMutation.mutate({
      saleId: data.id,
      reason: reason.trim(),
      method: method || undefined,
      restock,
      idempotencyKey: refundKey,
      items: selected.map(([saleItemId, line]) => ({ saleItemId, quantity: line.quantity })),
    });
  };

  const refundTotal = Object.entries(lines)
    .filter(([, line]) => line.selected)
    .reduce((total, [saleItemId, line]) => {
      const item = items.find((row) => row.id === saleItemId);
      if (!item) return total;
      const available = Number(item.quantity) - Number(item.refundedQuantity);
      const quantity = Math.min(Number(line.quantity) || 0, available);
      const unit = Number(item.lineTotal) / Math.max(Number(item.quantity), 1);
      return total + unit * quantity;
    }, 0);

  const showProfit = can('reports:read');

  return (
    <div>
      <div className="mb-4">
        <Link href="/sales" className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-800">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to sales
        </Link>
      </div>

      <PageHeader
        title={data.saleNumber}
        eyebrow={data.locationName}
        description={`${formatDate(data.createdAt, true)} · Served by ${data.cashierName}`}
        actions={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setReceiptOpen(true)}>
              <FileText className="h-3.5 w-3.5" /> Receipt
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                if (receipt.isLoading) {
                  toast('Preparing the print view…', 'info');
                  return;
                }
                if (receipt.isError || !receiptData) {
                  toast('The print view could not be prepared.', 'error');
                  return;
                }
                setReceiptOpen(false);
                window.setTimeout(() => printReceipt(), 50);
              }}
            >
              <Printer className="h-3.5 w-3.5" /> Print
            </button>
            {refundable ? (
              <button type="button" className="btn-primary btn-sm" onClick={openRefund}>
                <RotateCcw className="h-3.5 w-3.5" /> Request refund
              </button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-ink-900">Items</h2>
              <StatusBadge status={data.status} />
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Unit price</th>
                    <th className="text-right">Discount</th>
                    <th className="text-right">Tax</th>
                    <th className="text-right">Line total</th>
                    <th className="text-right">Refunded</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <p className="font-medium text-ink-900">{item.productName}</p>
                        <p className="font-mono text-[11px] text-ink-400">{item.sku}</p>
                      </td>
                      <td className="text-right font-mono text-xs">{formatQuantity(item.quantity)}</td>
                      <td className="text-right font-mono text-xs">{formatMoney(item.unitPrice, currency)}</td>
                      <td className="text-right font-mono text-xs">
                        {Number(item.discountAmount) > 0 ? `-${formatMoney(item.discountAmount, currency)}` : '—'}
                      </td>
                      <td className="text-right font-mono text-xs">
                        {Number(item.taxAmount) > 0 ? `${formatMoney(item.taxAmount, currency)} (${item.taxRate}%)` : '—'}
                      </td>
                      <td className="text-right font-mono text-xs font-semibold">{formatMoney(item.lineTotal, currency)}</td>
                      <td className="text-right font-mono text-xs text-ink-500">
                        {Number(item.refundedQuantity) > 0 ? formatQuantity(item.refundedQuantity) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card card-pad">
            <h2 className="mb-3 text-sm font-semibold text-ink-900">Payments</h2>
            {payments.length ? (
              <div className="space-y-2">
                {payments.map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-ink-800">
                        {PAYMENT_METHOD_LABELS[payment.method as PaymentMethod] ?? payment.method}
                      </p>
                      <p className="text-[11px] text-ink-400">
                        {payment.provider !== 'MANUAL' ? `${payment.provider} · ` : ''}
                        {payment.status.toLowerCase()}
                        {payment.reference ? ` · ref ${payment.reference}` : ''}
                      </p>
                    </div>
                    <span className="font-mono text-sm font-semibold text-ink-900">{formatMoney(payment.amount, currency)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-500">No payment records on this sale.</p>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-ink-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-ink-900">Refunds</h2>
            </div>
            {refunds.length ? (
              <div className="divide-y divide-ink-100">
                {refunds.map((refund) => (
                  <div key={refund.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div>
                      <p className="font-mono text-xs font-semibold text-ink-800">{refund.refundNumber}</p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {refund.reason} · {formatDate(refund.createdAt, true)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-400">
                        Requested by {refund.requestedByName ?? '—'}
                        {refund.approvedByName ? ` · Approved by ${refund.approvedByName}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={refund.status} />
                      <span className="font-mono text-sm font-semibold text-ink-900">{formatMoney(refund.total, currency)}</span>
                      <Link href="/refunds" className="btn-ghost btn-sm">
                        Open
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-ink-500">No refunds have been recorded for this sale.</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card card-pad">
            <h2 className="mb-2 text-sm font-semibold text-ink-900">Summary</h2>
            <KeyValue label="Subtotal">{formatMoney(data.subtotal, currency)}</KeyValue>
            <KeyValue label="Discount">{Number(data.discountTotal) > 0 ? `-${formatMoney(data.discountTotal, currency)}` : formatMoney('0', currency)}</KeyValue>
            <KeyValue label="Tax">{formatMoney(data.taxTotal, currency)}</KeyValue>
            <KeyValue label="Total charged">
              <span className="text-base text-ink-950">{formatMoney(data.total, currency)}</span>
            </KeyValue>
            {showProfit ? (
              <>
                <KeyValue label="Cost of goods">{formatMoney(data.costTotal, currency)}</KeyValue>
                <KeyValue label="Gross profit">{formatMoney(data.grossProfit, currency)}</KeyValue>
              </>
            ) : null}
            <KeyValue label="Recorded">{formatTime(data.createdAt)}</KeyValue>
          </div>

          <div className="card card-pad">
            <h2 className="mb-2 text-sm font-semibold text-ink-900">Context</h2>
            <KeyValue label="Branch">{data.locationName}</KeyValue>
            <KeyValue label="Cashier">{data.cashierName}</KeyValue>
            <KeyValue label="Customer">{data.customerName ?? 'Walk-in customer'}</KeyValue>
            <KeyValue label="Source">
              {data.isOffline ? 'POS till (sync-confirmed)' : 'Server till'}
            </KeyValue>
            {data.notes ? <KeyValue label="Notes">{data.notes}</KeyValue> : null}
          </div>

          <div className="rounded-xl border border-ink-200 bg-ink-50/70 p-4 text-xs text-ink-500">
            <p className="flex items-center gap-1.5 font-semibold text-ink-700">
              <TriangleAlert className="h-3.5 w-3.5" /> Financial history is append-only
            </p>
            <p className="mt-1.5 leading-relaxed">
              A completed sale is never edited or deleted. Corrections are recorded as approved refunds,
              adjustments or transfers, each with its own audit entry.
            </p>
          </div>
        </div>
      </div>

      <Modal
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        title="Receipt"
        description="This is the receipt the customer received."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReceiptOpen(false)}>
              Close
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!receiptData}
              onClick={() => {
                setReceiptOpen(false);
                window.setTimeout(() => printReceipt(), 50);
              }}
            >
              <Printer className="h-4 w-4" /> Print
            </button>
          </>
        }
      >
        {receipt.isLoading ? (
          <div className="grid place-items-center py-10">
            <Spinner />
          </div>
        ) : receiptData ? (
          <ReceiptView data={receiptData} />
        ) : (
          <EmptyState compact title="Receipt unavailable" description={errorMessage(receipt.error)} />
        )}
      </Modal>

      <div className="receipt-print hidden">{receiptData ? <ReceiptView data={receiptData} /> : null}</div>

      <Modal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        title="Request a refund"
        description={`Refund against ${data.saleNumber}. Refunds are recorded separately; the original sale is never changed.`}
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRefundOpen(false)} disabled={refundMutation.isPending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={submitRefund} disabled={refundMutation.isPending}>
              {refundMutation.isPending ? <Spinner /> : <RotateCcw className="h-4 w-4" />}
              Request refund · est. {formatMoney(String(refundTotal), currency)}
            </button>
          </>
        }
      >
        {refundError ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{refundError}</div>
        ) : null}

        <div className="space-y-2">
          {items.map((item) => {
            const available = Number(item.quantity) - Number(item.refundedQuantity);
            const line = lines[item.id] ?? { selected: false, quantity: String(available) };
            return (
              <div
                key={item.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2',
                  line.selected ? 'border-brand-300 bg-brand-50/50' : 'border-ink-200',
                )}
              >
                <label className="flex flex-1 items-center gap-2.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-ink-300 text-brand-600"
                    checked={line.selected}
                    disabled={available <= 0}
                    onChange={(event) =>
                      setLines((current) => ({
                        ...current,
                        [item.id]: { ...line, selected: event.target.checked },
                      }))
                    }
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink-900">{item.productName}</span>
                    <span className="block text-[11px] text-ink-500">
                      {formatQuantity(available)} still refundable · {formatMoney(item.lineTotal, currency)} originally
                    </span>
                  </span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="0"
                    max={available}
                    step="0.001"
                    className="input !w-24 !py-1.5 text-right text-xs"
                    value={line.quantity}
                    disabled={!line.selected || available <= 0}
                    onChange={(event) =>
                      setLines((current) => ({
                        ...current,
                        [item.id]: { ...line, quantity: event.target.value },
                      }))
                    }
                    aria-label={`Refund quantity for ${item.productName}`}
                  />
                  <span className="text-[11px] text-ink-400">/ {formatQuantity(available)}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 field-row">
          <Field label="Refund method" htmlFor="refund-method">
            <select id="refund-method" className="select" value={method} onChange={(event) => setMethod(event.target.value)}>
              {PAYMENT_METHODS.map((option) => (
                <option key={option} value={option}>
                  {PAYMENT_METHOD_LABELS[option]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Restock returned items" htmlFor="refund-restock">
            <label className="mt-2 flex items-center gap-2 text-sm text-ink-700">
              <input
                id="refund-restock"
                type="checkbox"
                className="h-4 w-4 rounded border-ink-300 text-brand-600"
                checked={restock}
                onChange={(event) => setRestock(event.target.checked)}
              />
              Put sellable items back into stock
            </label>
          </Field>
        </div>

        <Field label="Reason" htmlFor="refund-reason" required className="mt-2">
          <textarea
            id="refund-reason"
            className="input min-h-20"
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explain why the customer is returning these items."
          />
        </Field>

        <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-[11px] leading-relaxed text-ink-500">
          Refunds above your business approval threshold, or requested by a cashier, stay pending until a
          manager or owner approves them. Stock is only restored when the refund is completed.
        </p>
      </Modal>
    </div>
  );
}
