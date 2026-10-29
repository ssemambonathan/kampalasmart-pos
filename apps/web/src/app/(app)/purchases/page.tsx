'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ClipboardList, Eye, PackageCheck, Plus, Trash2, Undo2 } from 'lucide-react';
import type { Location, Paginated, Product, Purchase, Supplier } from '@kampalasmart/shared';
import { PURCHASE_STATUSES } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney, formatQuantity, titleCase } from '@/lib/format';
import { DateRangeFilter, useDateRange } from '@/components/date-range';
import { ExportButton, PermissionNotice } from '@/components/export-button';
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
  Tabs,
  useDebounced,
} from '@/components/ui';

interface PurchaseReturnLine {
  id: string;
  productName: string;
  sku: string;
  quantity: string;
  unitCost: string;
  lineTotal: string;
}

interface PurchaseReturn {
  id: string;
  returnNumber: string;
  purchaseId: string;
  supplierName?: string;
  locationName?: string;
  reason: string;
  total: string;
  createdByName: string | null;
  createdAt: string;
  items: PurchaseReturnLine[];
}

interface PurchaseDetail extends Purchase {
  returns: PurchaseReturn[];
}

interface DraftLine {
  key: string;
  product: Product | null;
  quantity: string;
  unitCost: string;
}

function makeLine(): DraftLine {
  return { key: crypto.randomUUID(), product: null, quantity: '1', unitCost: '' };
}

function inputQuantity(value: string | number): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return String(Number(amount.toFixed(3)));
}

function roundMoney(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

export default function PurchasesPage() {
  const { business, activeLocationId, can } = useAuth();
  const currency = business?.currency ?? 'UGX';
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'orders' | 'returns'>('orders');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [status, setStatus] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const range = useDateRange('30d');

  const suppliers = useQuery({
    queryKey: ['supplier-options'],
    queryFn: () => api.get<Paginated<Supplier>>('/suppliers', { page: 1, pageSize: 100 }),
    enabled: can('purchases:read') && can('suppliers:read'),
    staleTime: 60_000,
  });

  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<Location[]>('/locations'),
    enabled: can('purchases:read'),
    staleTime: 60_000,
  });

  const filters = {
    page,
    pageSize: 20,
    search: debounced || undefined,
    status: status || undefined,
    supplierId: supplierId || undefined,
    locationId: locationId || undefined,
    from: range.bounds.from,
    to: range.bounds.to,
  };

  const purchases = useQuery({
    queryKey: ['purchases', filters],
    queryFn: () => api.get<Paginated<Purchase>>('/purchases', filters),
    enabled: can('purchases:read') && tab === 'orders',
  });

  const returns = useQuery({
    queryKey: ['purchase-returns', { page, search: debounced, supplierId, from: range.bounds.from, to: range.bounds.to }],
    queryFn: () =>
      api.get<Paginated<PurchaseReturn>>('/purchases/returns', {
        page,
        pageSize: 20,
        search: debounced || undefined,
        supplierId: supplierId || undefined,
        from: range.bounds.from,
        to: range.bounds.to,
      }),
    enabled: can('purchases:read') && tab === 'returns',
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [createSupplier, setCreateSupplier] = useState('');
  const [createLocation, setCreateLocation] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [taxRate, setTaxRate] = useState(business?.taxRate ?? '0');
  const [draft, setDraft] = useState<DraftLine[]>([makeLine()]);
  const [createError, setCreateError] = useState('');

  const [detailId, setDetailId] = useState<string | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveQuantities, setReceiveQuantities] = useState<Record<string, string>>({});
  const [receiveNote, setReceiveNote] = useState('');
  const [receiveError, setReceiveError] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [returnReason, setReturnReason] = useState('');
  const [returnReference, setReturnReference] = useState('');
  const [returnError, setReturnError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);

  const detail = useQuery({
    queryKey: ['purchase', detailId],
    queryFn: () => api.get<PurchaseDetail>(`/purchases/${detailId}`),
    enabled: Boolean(detailId) && can('purchases:read'),
  });

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<Purchase>('/purchases', payload),
    onSuccess: async (purchase) => {
      toast(`Purchase ${purchase.purchaseNumber} recorded. Receive stock when it arrives.`, 'success');
      setCreateOpen(false);
      resetCreate();
      await queryClient.invalidateQueries({ queryKey: ['purchases'] });
    },
    onError: (error) => setCreateError(errorMessage(error)),
  });

  const receive = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.post<Purchase>(`/purchases/${id}/receive`, payload),
    onSuccess: async () => {
      toast('Receipt posted to the inventory ledger.', 'success');
      setReceiveOpen(false);
      setReceiveError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['purchases'] }),
        queryClient.invalidateQueries({ queryKey: ['purchase', detailId] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
      ]);
    },
    onError: (error) => setReceiveError(errorMessage(error)),
  });

  const createReturn = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.post<{ returnNumber: string; total: string; lines: number }>(`/purchases/${id}/returns`, payload),
    onSuccess: async (result) => {
      toast(`Return ${result.returnNumber} posted. Stock left the ledger.`, 'success');
      setReturnOpen(false);
      setReturnError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['purchases'] }),
        queryClient.invalidateQueries({ queryKey: ['purchase', detailId] }),
        queryClient.invalidateQueries({ queryKey: ['purchase-returns'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      ]);
    },
    onError: (error) => setReturnError(errorMessage(error)),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post<Purchase>(`/purchases/${id}/cancel`),
    onSuccess: async () => {
      toast('Purchase order cancelled. The record is kept in history.', 'success');
      setCancelOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['purchases'] }),
        queryClient.invalidateQueries({ queryKey: ['purchase', detailId] }),
      ]);
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  if (!can('purchases:read')) return <PermissionNotice area="purchasing" />;

  const resetCreate = () => {
    setCreateSupplier('');
    setCreateLocation('');
    setReference('');
    setNotes('');
    setTaxRate(business?.taxRate ?? '0');
    setDraft([makeLine()]);
    setCreateError('');
  };

  const openCreate = () => {
    resetCreate();
    const fallback = activeLocationId ?? locations.data?.find((location) => location.isDefault)?.id ?? locations.data?.[0]?.id ?? '';
    setCreateLocation(fallback);
    setCreateOpen(true);
  };

  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setDraft((lines) => lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const chooseProduct = (line: DraftLine, product: Product | null) => {
    if (product && draft.some((entry) => entry.key !== line.key && entry.product?.id === product.id)) {
      setCreateError(`${product.name} is already on this order. Change its quantity instead of adding it twice.`);
      setLine(line.key, { product: null });
      return;
    }
    setCreateError('');
    setLine(line.key, {
      product,
      unitCost: product && !line.unitCost ? product.costPrice : line.unitCost,
    });
  };

  const subtotal = draft.reduce((total, line) => {
    if (!line.product) return total;
    const quantity = Number(line.quantity);
    const cost = Number(line.unitCost);
    if (!Number.isFinite(quantity) || !Number.isFinite(cost) || quantity <= 0 || cost < 0) return total;
    return total + Math.round(quantity * cost * 100) / 100;
  }, 0);
  const taxAmount = Math.round(subtotal * (Number.isFinite(Number(taxRate)) ? Number(taxRate) : 0)) / 100;

  const submitCreate = () => {
    setCreateError('');
    if (!createSupplier) return setCreateError('Choose the supplier for this order.');
    if (!createLocation) return setCreateError('Choose the branch that will receive this stock.');
    const lines = draft.filter((line) => line.product);
    if (!lines.length) return setCreateError('Add at least one product.');
    const rate = Number(taxRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return setCreateError('Tax rate must be between 0 and 100.');
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const cost = Number(line.unitCost);
      if (!Number.isFinite(quantity) || quantity <= 0) return setCreateError(`Enter a quantity for ${line.product?.name}.`);
      if (!Number.isFinite(cost) || cost < 0) return setCreateError(`Enter a unit cost for ${line.product?.name}.`);
    }
    create.mutate({
      supplierId: createSupplier,
      locationId: createLocation,
      reference: reference.trim() || null,
      notes: notes.trim() || null,
      taxRatePercent: String(Number(rate.toFixed(3))),
      items: lines.map((line) => ({
        productId: line.product!.id,
        quantity: inputQuantity(line.quantity),
        unitCost: roundMoney(Number(line.unitCost)),
      })),
    });
  };

  const openDetail = (id: string) => {
    setDetailId(id);
    setReceiveOpen(false);
    setReturnOpen(false);
    setReceiveError('');
    setReturnError('');
  };

  const openReceive = () => {
    if (!detail.data) return;
    const next: Record<string, string> = {};
    for (const item of detail.data.items) {
      const remaining = Math.round((Number(item.quantity) - Number(item.receivedQuantity)) * 1000) / 1000;
      next[item.id] = remaining > 0 ? inputQuantity(remaining) : '';
    }
    setReceiveQuantities(next);
    setReceiveNote('');
    setReceiveError('');
    setReceiveOpen(true);
  };

  const openReturn = () => {
    setReturnQuantities({});
    setReturnReason('');
    setReturnReference('');
    setReturnError('');
    setReturnOpen(true);
  };

  const submittedOn = detail.data?.createdAt ? formatDate(detail.data.createdAt, true) : '—';
  const statusAllowsReceive = detail.data?.status === 'ORDERED' || detail.data?.status === 'PARTIALLY_RECEIVED';
  const statusAllowsReturn = detail.data?.status === 'RECEIVED' || detail.data?.status === 'PARTIALLY_RECEIVED';
  const returnedBySku = new Map<string, number>();
  detail.data?.returns.forEach((row) => {
    row.items.forEach((item) => {
      returnedBySku.set(item.sku, (returnedBySku.get(item.sku) ?? 0) + Number(item.quantity));
    });
  });

  const submitReceive = () => {
    if (!detail.data) return;
    setReceiveError('');
    const items = detail.data.items
      .map((item) => ({
        item,
        quantity:
          Math.round(
            (Number(receiveQuantities[item.id] ?? 0) || 0) * 1000,
          ) / 1000,
      }))
      .filter((entry) => entry.quantity > 0);
    if (!items.length) return setReceiveError('Enter at least one received quantity.');
    for (const entry of items) {
      const remaining = Number(entry.item.quantity) - Number(entry.item.receivedQuantity);
      if (entry.quantity > remaining + 0.0005) {
        return setReceiveError(`Cannot receive more than the ${formatQuantity(remaining)} outstanding for ${entry.item.productName}.`);
      }
    }
    receive.mutate({
      id: detail.data.id,
      payload: {
        items: items.map((entry) => ({ purchaseItemId: entry.item.id, quantity: inputQuantity(entry.quantity) })),
        note: receiveNote.trim() || null,
      },
    });
  };

  const submitReturn = () => {
    if (!detail.data) return;
    setReturnError('');
    if (returnReason.trim().length < 3) return setReturnError('Give a reason of at least 3 characters for the supplier return.');
    const items = detail.data.items
      .map((item) => ({
        item,
        available:
          Number(item.receivedQuantity) - (returnedBySku.get(item.sku) ?? 0),
        quantity: Math.round((Number(returnQuantities[item.id] ?? 0) || 0) * 1000) / 1000,
      }))
      .filter((entry) => entry.quantity > 0);
    if (!items.length) return setReturnError('Enter at least one quantity to return.');
    for (const entry of items) {
      if (entry.available <= 0) return setReturnError(`${entry.item.productName} has no received stock left to return.`);
      if (entry.quantity > entry.available + 0.0005) {
        return setReturnError(`Cannot return more than the ${formatQuantity(entry.available)} still held from ${entry.item.productName}.`);
      }
    }
    createReturn.mutate({
      id: detail.data.id,
      payload: {
        reason: returnReason.trim(),
        reference: returnReference.trim() || null,
        items: items.map((entry) => ({ purchaseItemId: entry.item.id, quantity: inputQuantity(entry.quantity) })),
      },
    });
  };

  const exportPath = `/purchases/export?${new URLSearchParams(
    Object.entries(filters)
      .filter(([key, value]) => key !== 'page' && key !== 'pageSize' && value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  ).toString()}`;

  const resetPage = () => setPage(1);

  return (
    <div>
      <PageHeader
        title="Purchases"
        eyebrow="Stock coming in"
        description="Orders, receipts and supplier returns are kept as separate records. Receiving posts stock to the ledger; nothing overwrites history."
        actions={
          <>
            {tab === 'orders' ? <ExportButton path={exportPath} filename="purchases.csv" /> : null}
            {can('purchases:write') ? (
              <button type="button" className="btn-primary btn-sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" /> New purchase order
              </button>
            ) : null}
          </>
        }
      />

      <div className="card mb-4 p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              resetPage();
            }}
            placeholder="Search order number, reference, supplier…"
            className="lg:w-72"
          />
          {tab === 'orders' ? (
            <select
              className="select !w-auto text-xs"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                resetPage();
              }}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {PURCHASE_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {titleCase(option)}
                </option>
              ))}
            </select>
          ) : null}
          <select
            className="select !w-auto text-xs"
            value={supplierId}
            onChange={(event) => {
              setSupplierId(event.target.value);
              resetPage();
            }}
            aria-label="Filter by supplier"
          >
            <option value="">All suppliers</option>
            {(suppliers.data?.data ?? []).map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
          {tab === 'orders' ? (
            <select
              className="select !w-auto text-xs"
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
                resetPage();
              }}
              aria-label="Filter by branch"
            >
              <option value="">All branches</option>
              {(locations.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          ) : null}
          <DateRangeFilter
            className="lg:ml-auto"
            preset={range.preset}
            range={range.range}
            onPreset={(next) => {
              range.setPreset(next);
              resetPage();
            }}
            onRange={(next) => {
              range.setRange(next);
              resetPage();
            }}
          />
        </div>
      </div>

      <div className="mb-3">
        <Tabs
          tabs={[
            { id: 'orders', label: 'Purchase orders' },
            { id: 'returns', label: 'Supplier returns' },
          ]}
          active={tab}
          onChange={(next) => {
            setTab(next);
            resetPage();
          }}
        />
      </div>

      {tab === 'orders' ? (
        <div className="card overflow-hidden">
          {purchases.isLoading ? (
            <TableSkeleton rows={7} cols={7} />
          ) : purchases.isError ? (
            <ErrorState message={errorMessage(purchases.error)} onRetry={() => void purchases.refetch()} />
          ) : !purchases.data?.data.length ? (
            <EmptyState
              icon={<ClipboardList className="h-5 w-5" />}
              title="No purchase orders in this range"
              description="Record an order when you place it with a supplier, then receive stock when it arrives."
              action={
                can('purchases:write') ? (
                  <button type="button" className="btn-primary btn-sm" onClick={openCreate}>
                    <Plus className="h-3.5 w-3.5" /> New purchase order
                  </button>
                ) : null
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Supplier</th>
                      <th>Branch</th>
                      <th>Status</th>
                      <th className="text-right">Total</th>
                      <th>Ordered</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.data.data.map((purchase) => (
                      <tr key={purchase.id}>
                        <td>
                          <button
                            type="button"
                            className="text-left font-mono text-xs font-semibold text-brand-700 hover:underline"
                            onClick={() => openDetail(purchase.id)}
                          >
                            {purchase.purchaseNumber}
                          </button>
                          {purchase.reference ? (
                            <p className="text-[11px] text-ink-400">Ref {purchase.reference}</p>
                          ) : null}
                        </td>
                        <td className="text-sm">{purchase.supplierName}</td>
                        <td className="text-xs text-ink-500">{purchase.locationName}</td>
                        <td>
                          <StatusBadge status={purchase.status} />
                        </td>
                        <td className="text-right font-mono text-xs font-semibold">{formatMoney(purchase.total, currency)}</td>
                        <td className="whitespace-nowrap text-xs text-ink-500">{formatDate(purchase.createdAt)}</td>
                        <td className="text-right">
                          <button type="button" className="btn-ghost btn-sm" onClick={() => openDetail(purchase.id)}>
                            <Eye className="h-3.5 w-3.5" /> View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={purchases.data.page}
                pageSize={purchases.data.pageSize}
                total={purchases.data.total}
                onPage={setPage}
              />
            </>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {returns.isLoading ? (
            <TableSkeleton rows={6} cols={6} />
          ) : returns.isError ? (
            <ErrorState message={errorMessage(returns.error)} onRetry={() => void returns.refetch()} />
          ) : !returns.data?.data.length ? (
            <EmptyState
              icon={<Undo2 className="h-5 w-5" />}
              title="No supplier returns in this range"
              description="Returns reduce stock and stay linked to the purchase they came from."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Return</th>
                      <th>Supplier</th>
                      <th>Branch</th>
                      <th>Reason</th>
                      <th className="text-right">Value</th>
                      <th>When</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {returns.data.data.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <p className="font-mono text-xs font-semibold text-ink-900">{row.returnNumber}</p>
                          <p className="text-[11px] text-ink-400">{row.items.length} lines</p>
                        </td>
                        <td className="text-sm">{row.supplierName ?? '—'}</td>
                        <td className="text-xs text-ink-500">{row.locationName ?? '—'}</td>
                        <td className="max-w-[240px] truncate text-xs text-ink-600" title={row.reason}>
                          {row.reason}
                        </td>
                        <td className="text-right font-mono text-xs font-semibold">{formatMoney(row.total, currency)}</td>
                        <td className="whitespace-nowrap text-xs text-ink-500">{formatDate(row.createdAt, true)}</td>
                        <td className="text-right">
                          <button type="button" className="btn-ghost btn-sm" onClick={() => openDetail(row.purchaseId)}>
                            View order
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={returns.data.page}
                pageSize={returns.data.pageSize}
                total={returns.data.total}
                onPage={setPage}
              />
            </>
          )}
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New purchase order"
        description="Stock is only added when you receive the order, not when it is created."
        size="xl"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)} disabled={create.isPending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={submitCreate} disabled={create.isPending}>
              {create.isPending ? <Spinner /> : <ClipboardList className="h-4 w-4" />}
              Record order
            </button>
          </>
        }
      >
        {createError ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{createError}</div>
        ) : null}
        <div className="space-y-4">
          <div className="field-row">
            <Field label="Supplier" required>
              <select className="select" value={createSupplier} onChange={(event) => setCreateSupplier(event.target.value)}>
                <option value="">Choose a supplier…</option>
                {(suppliers.data?.data ?? []).filter((supplier) => supplier.isActive).map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Receive into branch" required>
              <select className="select" value={createLocation} onChange={(event) => setCreateLocation(event.target.value)}>
                <option value="">Choose a branch…</option>
                {(locations.data ?? []).filter((location) => location.isActive).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="field-row">
            <Field label="Supplier reference" hint="Invoice or delivery note number, if any.">
              <input className="input" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={80} />
            </Field>
            <Field label="Tax rate %" hint="Applied to the order subtotal as input tax.">
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                step={0.001}
                value={taxRate}
                onChange={(event) => setTaxRate(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea className="input min-h-16" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} />
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-600">Order lines</p>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setDraft((lines) => [...lines, makeLine()])}>
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            </div>
            <div className="space-y-2">
              {draft.map((line, index) => (
                <div key={line.key} className="rounded-lg border border-ink-200 p-2.5">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_auto] sm:items-start">
                    <ProductCombobox
                      value={line.product}
                      onChange={(product) => chooseProduct(line, product)}
                      showCost
                      placeholder="Search product…"
                      autoFocus={index === draft.length - 1 && !line.product && draft.length > 1}
                    />
                    <div>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        step={0.001}
                        placeholder="Qty"
                        value={line.quantity}
                        onChange={(event) => setLine(line.key, { quantity: event.target.value })}
                        aria-label={`Quantity for line ${index + 1}`}
                      />
                      <p className="mt-1 text-[10px] text-ink-400">
                        {line.product ? `Ordered in ${line.product.unit}` : 'Quantity'}
                      </p>
                    </div>
                    <div>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="Unit cost"
                        value={line.unitCost}
                        onChange={(event) => setLine(line.key, { unitCost: event.target.value })}
                        aria-label={`Unit cost for line ${index + 1}`}
                      />
                      <p className="mt-1 text-[10px] text-ink-400">
                        {line.product ? `Last cost ${formatMoney(line.product.costPrice, currency)}` : 'Unit cost'}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
                      onClick={() => setDraft((lines) => (lines.length === 1 ? [makeLine()] : lines.filter((entry) => entry.key !== line.key)))}
                      aria-label={`Remove line ${index + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 ml-auto max-w-xs space-y-1.5 rounded-lg bg-ink-50 p-3 text-sm">
              <div className="flex justify-between text-ink-600">
                <span>Subtotal</span>
                <span className="font-mono">{formatMoney(subtotal, currency)}</span>
              </div>
              <div className="flex justify-between text-ink-600">
                <span>Input tax ({Number.isFinite(Number(taxRate)) ? Number(taxRate) : 0}%)</span>
                <span className="font-mono">{formatMoney(taxAmount, currency)}</span>
              </div>
              <div className="flex justify-between border-t border-ink-200 pt-1.5 font-semibold text-ink-900">
                <span>Order total</span>
                <span className="font-mono">{formatMoney(subtotal + taxAmount, currency)}</span>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={detail.data?.purchaseNumber ?? 'Purchase order'}
        description={detail.data ? `${detail.data.supplierName} · ${detail.data.locationName} · ordered ${submittedOn}` : undefined}
        size="xl"
        footer={
          <>
            {detail.data && statusAllowsReceive && can('purchases:receive') ? (
              <button type="button" className="btn-primary" onClick={openReceive}>
                <PackageCheck className="h-4 w-4" /> Receive stock
              </button>
            ) : null}
            {detail.data && statusAllowsReturn && can('purchases:write') ? (
              <button type="button" className="btn-secondary" onClick={openReturn}>
                <Undo2 className="h-4 w-4" /> Return to supplier
              </button>
            ) : null}
            {detail.data?.status === 'ORDERED' && can('purchases:write') ? (
              <button type="button" className="btn-danger" onClick={() => setCancelOpen(true)}>
                <Ban className="h-4 w-4" /> Cancel order
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
                <KeyValue label="Supplier">{detail.data.supplierName}</KeyValue>
                <KeyValue label="Branch">{detail.data.locationName}</KeyValue>
                <KeyValue label="Reference">{detail.data.reference ?? '—'}</KeyValue>
                <KeyValue label="Ordered by">{detail.data.createdByName ?? '—'}</KeyValue>
              </div>
              <div className="rounded-lg border border-ink-200 p-3">
                <KeyValue label="Subtotal">{formatMoney(detail.data.subtotal, currency)}</KeyValue>
                <KeyValue label="Input tax">{formatMoney(detail.data.taxTotal, currency)}</KeyValue>
                <KeyValue label="Order total">{formatMoney(detail.data.total, currency)}</KeyValue>
                <KeyValue label="Ordered">{formatDate(detail.data.createdAt, true)}</KeyValue>
                <KeyValue label="Received">{detail.data.receivedAt ? formatDate(detail.data.receivedAt, true) : 'Not yet'}</KeyValue>
              </div>
            </div>

            {detail.data.notes ? (
              <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">{detail.data.notes}</p>
            ) : null}

            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink-900">Order lines</h3>
              <div className="overflow-hidden rounded-lg border border-ink-200">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="text-right">Ordered</th>
                      <th className="text-right">Received</th>
                      <th className="text-right">Outstanding</th>
                      <th className="text-right">Unit cost</th>
                      <th className="text-right">Line total</th>
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
                        <td className="text-right font-mono text-xs">{formatQuantity(item.receivedQuantity)}</td>
                        <td className="text-right font-mono text-xs">
                          {formatQuantity(Math.max(0, Number(item.quantity) - Number(item.receivedQuantity)))}
                        </td>
                        <td className="text-right font-mono text-xs">{formatMoney(item.unitCost, currency)}</td>
                        <td className="text-right font-mono text-xs font-semibold">{formatMoney(item.lineTotal, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink-900">Supplier returns</h3>
              {detail.data.returns.length ? (
                <div className="space-y-2">
                  {detail.data.returns.map((row) => (
                    <div key={row.id} className="rounded-lg border border-ink-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-mono text-xs font-semibold text-ink-900">{row.returnNumber}</p>
                          <p className="text-[11px] text-ink-500">
                            {formatDate(row.createdAt, true)} · {row.createdByName ?? 'Unknown user'}
                          </p>
                        </div>
                        <span className="font-mono text-xs font-semibold">{formatMoney(row.total, currency)}</span>
                      </div>
                      <p className="mt-1 text-xs text-ink-600">{row.reason}</p>
                      <ul className="mt-2 space-y-1">
                        {row.items.map((item) => (
                          <li key={item.id} className="flex justify-between text-[11px] text-ink-500">
                            <span>
                              {item.productName} · {formatQuantity(item.quantity)} × {formatMoney(item.unitCost, currency)}
                            </span>
                            <span className="font-mono">{formatMoney(item.lineTotal, currency)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-ink-200 px-3 py-4 text-center text-xs text-ink-500">
                  No stock has been returned to the supplier from this order.
                </p>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        title="Receive stock"
        description="Only the quantities you enter are added to the ledger. Partial receipts can be recorded."
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReceiveOpen(false)} disabled={receive.isPending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={submitReceive} disabled={receive.isPending}>
              {receive.isPending ? <Spinner /> : <PackageCheck className="h-4 w-4" />}
              Post receipt
            </button>
          </>
        }
      >
        {receiveError ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{receiveError}</div>
        ) : null}
        {detail.data ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-ink-200">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">Outstanding</th>
                    <th className="w-32 text-right">Receiving now</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.items.map((item) => {
                    const remaining = Math.max(0, Number(item.quantity) - Number(item.receivedQuantity));
                    return (
                      <tr key={item.id}>
                        <td>
                          <p className="text-sm font-medium text-ink-900">{item.productName}</p>
                          <p className="font-mono text-[10px] text-ink-400">{item.sku}</p>
                        </td>
                        <td className="text-right font-mono text-xs">{formatQuantity(remaining)}</td>
                        <td>
                          <input
                            className="input text-right"
                            type="number"
                            min={0}
                            max={remaining}
                            step={0.001}
                            value={receiveQuantities[item.id] ?? ''}
                            onChange={(event) =>
                              setReceiveQuantities((current) => ({ ...current, [item.id]: event.target.value }))
                            }
                            disabled={remaining <= 0}
                            aria-label={`Received quantity for ${item.productName}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Field label="Receipt note" hint="For example the delivery note condition.">
              <input className="input" value={receiveNote} onChange={(event) => setReceiveNote(event.target.value)} maxLength={500} />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        title="Return stock to supplier"
        description="Returned quantities leave the ledger immediately and reduce the value received from this order."
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReturnOpen(false)} disabled={createReturn.isPending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={submitReturn} disabled={createReturn.isPending}>
              {createReturn.isPending ? <Spinner /> : <Undo2 className="h-4 w-4" />}
              Post return
            </button>
          </>
        }
      >
        {returnError ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{returnError}</div>
        ) : null}
        {detail.data ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-ink-200">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">Available</th>
                    <th className="w-32 text-right">Returning</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.items.map((item) => {
                    const available = Math.max(0, Number(item.receivedQuantity) - (returnedBySku.get(item.sku) ?? 0));
                    return (
                      <tr key={item.id}>
                        <td>
                          <p className="text-sm font-medium text-ink-900">{item.productName}</p>
                          <p className="font-mono text-[10px] text-ink-400">{item.sku}</p>
                        </td>
                        <td className="text-right font-mono text-xs">{formatQuantity(available)}</td>
                        <td>
                          <input
                            className="input text-right"
                            type="number"
                            min={0}
                            max={available}
                            step={0.001}
                            value={returnQuantities[item.id] ?? ''}
                            placeholder="0"
                            onChange={(event) =>
                              setReturnQuantities((current) => ({ ...current, [item.id]: event.target.value }))
                            }
                            disabled={available <= 0}
                            aria-label={`Return quantity for ${item.productName}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Field label="Reason" required hint="Why is this stock going back? The reason is kept in the audit trail.">
              <textarea
                className="input min-h-16"
                value={returnReason}
                onChange={(event) => setReturnReason(event.target.value)}
                maxLength={500}
              />
            </Field>
            <Field label="Supplier reference">
              <input
                className="input"
                value={returnReference}
                onChange={(event) => setReturnReference(event.target.value)}
                maxLength={80}
              />
            </Field>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => {
          if (detail.data) cancel.mutate(detail.data.id);
        }}
        title="Cancel this purchase order?"
        message="No stock has been received, so the order will be marked cancelled. The record stays in history and cannot be received afterwards."
        confirmLabel="Cancel order"
        tone="danger"
        busy={cancel.isPending}
      />
    </div>
  );
}
