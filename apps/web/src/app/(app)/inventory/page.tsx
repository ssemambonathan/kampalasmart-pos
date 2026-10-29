'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ClipboardCheck,
  SlidersHorizontal,
  TriangleAlert,
  Warehouse,
} from 'lucide-react';
import type {
  Category,
  InventoryMovement,
  InventoryRow,
  LowStockItem,
  Paginated,
  Product,
} from '@kampalasmart/shared';
import { MOVEMENT_TYPES } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney, formatNumber, formatQuantity, titleCase } from '@/lib/format';
import { DateRangeFilter, useDateRange } from '@/components/date-range';
import { ExportButton, PermissionNotice } from '@/components/export-button';
import { ProductCombobox } from '@/components/product-combobox';
import { useToast } from '@/components/toast';
import {
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Spinner,
  StatCard,
  StatusBadge,
  TableSkeleton,
  Tabs,
  useDebounced,
} from '@/components/ui';

type InventoryTab = 'levels' | 'movements' | 'reorder' | 'insights';

interface Valuation {
  totalValue: string;
  totalQuantity: string;
  skuCount: number;
  locationCount: number;
  byLocation: Array<{ locationId: string; name: string; value: string; quantity: string; skus: number }>;
  byCategory: Array<{ categoryId: string | null; name: string; value: string; quantity: string; skus: number }>;
}

interface InsightsResponse {
  lowStock: Array<LowStockItem & { explanation: string }>;
  overstock: Array<{
    productId: string;
    productName: string;
    sku: string;
    locationName: string;
    quantity: string;
    soldLast30Days: string;
    daysOfCover: number;
  }>;
  slowMoving: Array<{
    productId: string;
    productName: string;
    sku: string;
    locationName: string;
    quantity: string;
    soldLast30Days: string;
  }>;
}

const ADJUSTMENT_TYPES = ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE', 'EXPIRY', 'OPENING_BALANCE'] as const;

export default function InventoryPage() {
  const { business, activeLocationId, can } = useAuth();
  const currency = business?.currency ?? 'UGX';
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<InventoryTab>('levels');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [status, setStatus] = useState('all');
  const [categoryId, setCategoryId] = useState('');
  const [movementType, setMovementType] = useState('');
  const range = useDateRange('30d');

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [adjustType, setAdjustType] = useState<(typeof ADJUSTMENT_TYPES)[number]>('ADJUSTMENT_IN');
  const [adjustQuantity, setAdjustQuantity] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustError, setAdjustError] = useState('');

  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileSearch, setReconcileSearch] = useState('');
  const reconcileDebounced = useDebounced(reconcileSearch, 300);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reconcileReason, setReconcileReason] = useState('');
  const [reconcileError, setReconcileError] = useState('');

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<Category[]>('/categories'),
    enabled: can('inventory:read'),
    staleTime: 120_000,
  });

  const levels = useQuery({
    queryKey: ['inventory', 'levels', { page, search: debounced, status, categoryId, activeLocationId }],
    queryFn: () =>
      api.get<Paginated<InventoryRow>>('/inventory/levels', {
        page,
        pageSize: 25,
        search: debounced || undefined,
        status: status === 'all' ? undefined : status,
        categoryId: categoryId || undefined,
        locationId: activeLocationId || undefined,
        sort: 'quantity',
        direction: 'asc',
      }),
    enabled: can('inventory:read') && tab === 'levels',
  });

  const valuation = useQuery({
    queryKey: ['inventory', 'valuation', activeLocationId],
    queryFn: () => api.get<Valuation>('/inventory/valuation', { locationId: activeLocationId || undefined }),
    enabled: can('inventory:read') && tab === 'levels',
  });

  const movements = useQuery({
    queryKey: ['inventory', 'movements', { page, search: debounced, movementType, range: range.bounds, activeLocationId }],
    queryFn: () =>
      api.get<Paginated<InventoryMovement>>('/inventory/movements', {
        page,
        pageSize: 30,
        search: debounced || undefined,
        movementType: movementType || undefined,
        locationId: activeLocationId || undefined,
        from: range.bounds.from,
        to: range.bounds.to,
      }),
    enabled: can('inventory:read') && tab === 'movements',
  });

  const reorder = useQuery({
    queryKey: ['inventory', 'low-stock', activeLocationId],
    queryFn: () => api.get<LowStockItem[]>('/inventory/low-stock', { locationId: activeLocationId || undefined, limit: 100 }),
    enabled: can('inventory:read') && tab === 'reorder',
  });

  const insights = useQuery({
    queryKey: ['inventory', 'insights', activeLocationId],
    queryFn: () => api.get<InsightsResponse>('/inventory/insights', { locationId: activeLocationId || undefined, limit: 100 }),
    enabled: can('inventory:read') && tab === 'insights',
  });

  const reconcileLevels = useQuery({
    queryKey: ['inventory', 'reconcile-levels', activeLocationId, reconcileDebounced],
    queryFn: () =>
      api.get<Paginated<InventoryRow>>('/inventory/levels', {
        locationId: activeLocationId || undefined,
        page: 1,
        pageSize: 100,
        search: reconcileDebounced || undefined,
        sort: 'name',
        direction: 'asc',
      }),
    enabled: reconcileOpen,
  });

  const adjust = useMutation({
    mutationFn: (payload: unknown) => api.post('/inventory/adjustments', payload),
    onSuccess: async () => {
      toast('Stock adjustment recorded in the inventory ledger.', 'success');
      setAdjustOpen(false);
      setAdjustProduct(null);
      setAdjustQuantity('');
      setAdjustReason('');
      setAdjustError('');
      await invalidateInventory();
    },
    onError: (error) => setAdjustError(errorMessage(error)),
  });

  const reconcile = useMutation({
    mutationFn: (payload: unknown) => api.post('/inventory/reconcile', payload),
    onSuccess: async (result) => {
      const affected = (result as { adjustedCount?: number })?.adjustedCount;
      toast(
        affected !== undefined
          ? `Stock count submitted. ${affected} line${affected === 1 ? '' : 's'} adjusted.`
          : 'Stock count submitted.',
        'success',
      );
      setReconcileOpen(false);
      setCounted({});
      setReconcileReason('');
      setReconcileError('');
      await invalidateInventory();
    },
    onError: (error) => setReconcileError(errorMessage(error)),
  });

  const invalidateInventory = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
  };

  const changedCounts = useMemo(
    () =>
      Object.entries(counted).filter(([, value]) => value.trim() !== '' && Number.isFinite(Number(value))),
    [counted],
  );

  if (!can('inventory:read')) return <PermissionNotice area="inventory" />;

  const exportBase =
    tab === 'movements'
      ? `/inventory/export?${new URLSearchParams({
          type: 'movements',
          locationId: activeLocationId || '',
          from: range.bounds.from,
          to: range.bounds.to,
          ...(movementType ? { movementType } : {}),
        }).toString()}`
      : `/inventory/export?${new URLSearchParams({
          type: 'levels',
          locationId: activeLocationId || '',
          ...(status !== 'all' ? { status } : {}),
        }).toString()}`;

  const submitAdjust = () => {
    setAdjustError('');
    if (!adjustProduct) {
      setAdjustError('Choose the product to adjust.');
      return;
    }
    const quantity = Number(adjustQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setAdjustError('Enter a quantity greater than zero.');
      return;
    }
    if (adjustReason.trim().length < 3) {
      setAdjustError('Explain why the stock is being adjusted.');
      return;
    }
    adjust.mutate({
      locationId: activeLocationId,
      productId: adjustProduct.id,
      quantity: adjustQuantity,
      movementType: adjustType,
      reason: adjustReason.trim(),
    });
  };

  const submitReconcile = () => {
    setReconcileError('');
    if (!reconcileReason.trim() || reconcileReason.trim().length < 3) {
      setReconcileError('Give a reason for the stock count.');
      return;
    }
    const rows = reconcileLevels.data?.data ?? [];
    const counts = changedCounts
      .map(([productId, value]) => ({
        productId,
        countedQuantity: String(Number(value)),
        current: Number(rows.find((row) => row.productId === productId)?.quantity ?? 0),
      }))
      .filter((row) => Number(row.countedQuantity) !== row.current)
      .map(({ productId, countedQuantity }) => ({ productId, countedQuantity }));
    if (!counts.length) {
      setReconcileError('No counted quantities differ from the recorded stock. Update at least one line.');
      return;
    }
    reconcile.mutate({ locationId: activeLocationId, reason: reconcileReason.trim(), counts });
  };

  return (
    <div>
      <PageHeader
        title="Inventory"
        eyebrow="Live stock ledger"
        description="Every quantity change is an append-only ledger movement. Stock counts and adjustments require a reason and are audited."
        actions={
          <>
            {can('inventory:adjust') ? (
              <button type="button" className="btn-secondary btn-sm" onClick={() => setAdjustOpen(true)}>
                <SlidersHorizontal className="h-3.5 w-3.5" /> Adjust stock
              </button>
            ) : null}
            {can('inventory:reconcile') ? (
              <button type="button" className="btn-primary btn-sm" onClick={() => setReconcileOpen(true)}>
                <ClipboardCheck className="h-3.5 w-3.5" /> Stock count
              </button>
            ) : null}
          </>
        }
      />

      <div className="mb-4">
        <Tabs<InventoryTab>
          tabs={[
            { id: 'levels', label: 'Stock levels' },
            { id: 'movements', label: 'Movements' },
            { id: 'reorder', label: 'Reorder priorities' },
            { id: 'insights', label: 'Stock insights' },
          ]}
          active={tab}
          onChange={(next) => {
            setTab(next);
            setPage(1);
            setSearch('');
          }}
        />
      </div>

      {tab === 'levels' ? (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Stock value at cost"
              value={valuation.isLoading ? '—' : formatMoney(valuation.data?.totalValue ?? '0', currency)}
              detail={`${formatNumber(valuation.data?.skuCount ?? 0)} SKUs`}
              icon={<Warehouse className="h-4 w-4" />}
              tone="brand"
            />
            <StatCard
              label="Units on hand"
              value={valuation.isLoading ? '—' : formatQuantity(valuation.data?.totalQuantity ?? '0')}
              detail={`${valuation.data?.locationCount ?? 0} branch(es)`}
              icon={<Boxes className="h-4 w-4" />}
            />
            <StatCard
              label="Out of stock"
              value={valuation.isLoading ? '—' : (levels.data?.data.filter((row) => row.status === 'OUT_OF_STOCK').length ?? 0)}
              detail="On the current page"
              tone="red"
              icon={<TriangleAlert className="h-4 w-4" />}
            />
            <StatCard
              label="Branches holding stock"
              value={valuation.isLoading ? '—' : (valuation.data?.locationCount ?? 0)}
              detail="Included in the active branch view"
              tone="amber"
              icon={<ArrowDownToLine className="h-4 w-4" />}
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
                placeholder="Search product, SKU or barcode…"
                className="lg:w-80"
              />
              <select
                className="select !w-auto text-xs"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                aria-label="Stock status"
              >
                <option value="all">All stock levels</option>
                <option value="out">Out of stock</option>
                <option value="critical">Critical</option>
                <option value="low">Below reorder level</option>
                <option value="ok">Healthy</option>
              </select>
              <select
                className="select !w-auto text-xs"
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  setPage(1);
                }}
                aria-label="Category"
              >
                <option value="">All categories</option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <div className="lg:ml-auto">
                <ExportButton path={exportBase} filename="stock-levels.csv" />
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            {levels.isLoading ? (
              <TableSkeleton rows={8} cols={7} />
            ) : levels.isError ? (
              <ErrorState message={errorMessage(levels.error)} onRetry={() => void levels.refetch()} />
            ) : !levels.data?.data.length ? (
              <EmptyState icon={<Boxes className="h-5 w-5" />} title="No stock matches these filters" />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Category</th>
                        <th>Branch</th>
                        <th className="text-right">On hand</th>
                        <th className="text-right">Reorder at</th>
                        <th className="text-right">Value</th>
                        <th>Status</th>
                        <th className="text-right">Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {levels.data.data.map((row) => (
                        <tr key={`${row.locationId}-${row.productId}`}>
                          <td>
                            <p className="font-medium text-ink-900">{row.productName}</p>
                            <p className="font-mono text-[11px] text-ink-400">{row.sku}</p>
                          </td>
                          <td className="text-xs text-ink-600">{row.categoryName ?? '—'}</td>
                          <td className="text-xs text-ink-600">{row.locationName}</td>
                          <td className="text-right font-mono text-sm font-semibold">
                            {formatQuantity(row.quantity)} <span className="text-[10px] font-normal text-ink-400">{row.unit}</span>
                          </td>
                          <td className="text-right font-mono text-xs text-ink-500">{formatQuantity(row.reorderLevel)}</td>
                          <td className="text-right font-mono text-xs">{formatMoney(row.value, currency)}</td>
                          <td>
                            <StatusBadge status={row.status} />
                          </td>
                          <td className="whitespace-nowrap text-right text-[11px] text-ink-400">{formatDate(row.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={levels.data.page} pageSize={levels.data.pageSize} total={levels.data.total} onPage={setPage} />
              </>
            )}
          </div>
        </>
      ) : null}

      {tab === 'movements' ? (
        <>
          <div className="card mb-4 p-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <SearchInput
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                placeholder="Search product or SKU…"
                className="lg:w-72"
              />
              <select
                className="select !w-auto text-xs"
                value={movementType}
                onChange={(event) => {
                  setMovementType(event.target.value);
                  setPage(1);
                }}
                aria-label="Movement type"
              >
                <option value="">All movement types</option>
                {MOVEMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {titleCase(type)}
                  </option>
                ))}
              </select>
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
              <ExportButton path={exportBase} filename="stock-movements.csv" />
            </div>
          </div>

          <div className="card overflow-hidden">
            {movements.isLoading ? (
              <TableSkeleton rows={9} cols={7} />
            ) : movements.isError ? (
              <ErrorState message={errorMessage(movements.error)} onRetry={() => void movements.refetch()} />
            ) : !movements.data?.data.length ? (
              <EmptyState icon={<Boxes className="h-5 w-5" />} title="No stock movements in this period" />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Product</th>
                        <th>Type</th>
                        <th className="text-right">Change</th>
                        <th className="text-right">Balance after</th>
                        <th>Reference</th>
                        <th>By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.data.data.map((row) => {
                        const positive = Number(row.quantity) >= 0;
                        return (
                          <tr key={row.id}>
                            <td className="whitespace-nowrap text-xs text-ink-600">{formatDate(row.createdAt, true)}</td>
                            <td>
                              <p className="text-sm font-medium text-ink-900">{row.productName}</p>
                              <p className="font-mono text-[10px] text-ink-400">
                                {row.sku} · {row.locationName}
                              </p>
                            </td>
                            <td className="text-xs text-ink-600">{titleCase(row.movementType)}</td>
                            <td className={`text-right font-mono text-xs font-semibold ${positive ? 'text-brand-700' : 'text-red-600'}`}>
                              <span className="inline-flex items-center gap-1">
                                {positive ? <ArrowUpFromLine className="h-3 w-3" /> : <ArrowDownToLine className="h-3 w-3" />}
                                {positive ? '+' : ''}
                                {formatQuantity(row.quantity)}
                              </span>
                            </td>
                            <td className="text-right font-mono text-xs">{formatQuantity(row.balanceAfter)}</td>
                            <td className="max-w-[220px] text-[11px] text-ink-500">
                              {row.referenceType ? titleCase(row.referenceType) : '—'}
                              {row.reason ? <span className="block truncate text-ink-400">{row.reason}</span> : null}
                            </td>
                            <td className="text-xs text-ink-600">{row.performedByName ?? 'System'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination page={movements.data.page} pageSize={movements.data.pageSize} total={movements.data.total} onPage={setPage} />
              </>
            )}
          </div>
        </>
      ) : null}

      {tab === 'reorder' ? (
        <div className="card overflow-hidden">
          {reorder.isLoading ? (
            <TableSkeleton rows={8} cols={7} />
          ) : reorder.isError ? (
            <ErrorState message={errorMessage(reorder.error)} onRetry={() => void reorder.refetch()} />
          ) : !reorder.data?.length ? (
            <EmptyState
              title="Nothing needs reordering right now"
              description="Products at or below their reorder level appear here with a suggested order quantity based on recent sales and lead time."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Branch</th>
                    <th className="text-right">On hand</th>
                    <th className="text-right">Avg daily</th>
                    <th className="text-right">Days left</th>
                    <th className="text-right">On order</th>
                    <th className="text-right">Suggested order</th>
                    <th>Supplier</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reorder.data.map((row) => (
                    <tr key={`${row.locationId}-${row.productId}`}>
                      <td>
                        <p className="text-sm font-medium text-ink-900">{row.productName}</p>
                        <p className="font-mono text-[10px] text-ink-400">{row.sku}</p>
                        <p className="mt-0.5 max-w-[320px] text-[10px] leading-snug text-ink-400">{row.explanation}</p>
                      </td>
                      <td className="text-xs text-ink-600">{row.locationName}</td>
                      <td className="text-right font-mono text-xs">{formatQuantity(row.quantity)}</td>
                      <td className="text-right font-mono text-xs">{formatNumber(row.averageDailySales, 2)}</td>
                      <td className="text-right font-mono text-xs">{row.daysRemaining ?? '—'}</td>
                      <td className="text-right font-mono text-xs">{formatQuantity(row.pendingPurchaseQuantity)}</td>
                      <td className="text-right font-mono text-xs font-semibold text-brand-700">
                        {formatQuantity(row.recommendedOrderQuantity)}
                      </td>
                      <td className="text-xs text-ink-600">{row.supplierName ?? '—'}</td>
                      <td>
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'insights' ? (
        <div className="space-y-4">
          {insights.isLoading ? (
            <div className="card">
              <TableSkeleton rows={6} cols={5} />
            </div>
          ) : insights.isError ? (
            <div className="card">
              <ErrorState message={errorMessage(insights.error)} onRetry={() => void insights.refetch()} />
            </div>
          ) : (
            <>
              <section className="card overflow-hidden">
                <div className="border-b border-ink-100 px-4 py-3">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                    <TriangleAlert className="h-4 w-4 text-accent-600" /> Reorder now
                  </h2>
                </div>
                <InsightTable rows={insights.data?.lowStock ?? []} kind="low" />
              </section>
              <section className="card overflow-hidden">
                <div className="border-b border-ink-100 px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink-900">Overstocked</h2>
                  <p className="text-xs text-ink-500">More than 60 days of cover based on the last 30 days of sales.</p>
                </div>
                <InsightTable rows={insights.data?.overstock ?? []} kind="over" />
              </section>
              <section className="card overflow-hidden">
                <div className="border-b border-ink-100 px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink-900">Slow moving</h2>
                  <p className="text-xs text-ink-500">No sales in the last 30 days but stock is on hand.</p>
                </div>
                <InsightTable rows={insights.data?.slowMoving ?? []} kind="slow" />
              </section>
            </>
          )}
        </div>
      ) : null}

      <Modal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        title="Adjust stock"
        description="Use this for damage, expiry, opening balances or corrections. Sales and purchases update stock automatically."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setAdjustOpen(false)} disabled={adjust.isPending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={submitAdjust} disabled={adjust.isPending}>
              {adjust.isPending ? <Spinner /> : <SlidersHorizontal className="h-4 w-4" />} Record adjustment
            </button>
          </>
        }
      >
        {adjustError ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{adjustError}</div>
        ) : null}
        <div className="space-y-3">
          <Field label="Product" required>
            <ProductCombobox value={adjustProduct} onChange={setAdjustProduct} locationId={activeLocationId} showStock />
          </Field>
          <div className="field-row">
            <Field label="Movement type" htmlFor="adjust-type" required>
              <select
                id="adjust-type"
                className="select"
                value={adjustType}
                onChange={(event) => setAdjustType(event.target.value as (typeof ADJUSTMENT_TYPES)[number])}
              >
                {ADJUSTMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {titleCase(type)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantity" htmlFor="adjust-quantity" required hint="Enter a positive number. The movement type decides the direction.">
              <input
                id="adjust-quantity"
                className="input"
                inputMode="decimal"
                value={adjustQuantity}
                onChange={(event) => setAdjustQuantity(event.target.value)}
                placeholder="e.g. 12"
              />
            </Field>
          </div>
          <Field label="Reason" htmlFor="adjust-reason" required>
            <textarea
              id="adjust-reason"
              className="input min-h-20"
              value={adjustReason}
              maxLength={500}
              onChange={(event) => setAdjustReason(event.target.value)}
              placeholder="e.g. 6 bottles broken during shelving"
            />
          </Field>
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-[11px] text-ink-500">
            Branch: {activeLocationId ? 'the branch selected in the header' : 'not selected'}. Adjustments cannot be
            edited or deleted; a wrong adjustment is corrected with another adjustment that explains why.
          </p>
        </div>
      </Modal>

      <Modal
        open={reconcileOpen}
        onClose={() => setReconcileOpen(false)}
        title="Stock count"
        description="Enter what you physically counted. Only lines that differ from the ledger are submitted, and each difference becomes an audited ledger movement."
        size="xl"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReconcileOpen(false)} disabled={reconcile.isPending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={submitReconcile} disabled={reconcile.isPending}>
              {reconcile.isPending ? <Spinner /> : <ClipboardCheck className="h-4 w-4" />} Submit count
            </button>
          </>
        }
      >
        {reconcileError ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{reconcileError}</div>
        ) : null}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput
            value={reconcileSearch}
            onChange={setReconcileSearch}
            placeholder="Find a product…"
            className="flex-1 min-w-52"
          />
          <span className="text-xs text-ink-500">
            {changedCounts.length} line{changedCounts.length === 1 ? '' : 's'} counted
          </span>
        </div>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-ink-200">
          {reconcileLevels.isLoading ? (
            <TableSkeleton rows={6} cols={3} />
          ) : !reconcileLevels.data?.data.length ? (
            <EmptyState compact title="No products found" />
          ) : (
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right">Recorded</th>
                  <th className="text-right">Counted</th>
                </tr>
              </thead>
              <tbody>
                {reconcileLevels.data.data.map((row) => (
                  <tr key={row.productId}>
                    <td>
                      <p className="text-sm font-medium text-ink-900">{row.productName}</p>
                      <p className="font-mono text-[10px] text-ink-400">{row.sku}</p>
                    </td>
                    <td className="text-right font-mono text-xs text-ink-500">{formatQuantity(row.quantity)}</td>
                    <td className="text-right">
                      <input
                        className="input !w-24 !py-1 text-right text-xs"
                        inputMode="decimal"
                        placeholder={formatQuantity(row.quantity)}
                        value={counted[row.productId] ?? ''}
                        onChange={(event) =>
                          setCounted((current) => ({ ...current, [row.productId]: event.target.value }))
                        }
                        aria-label={`Counted quantity for ${row.productName}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Field label="Reason for the count" htmlFor="reconcile-reason" required className="mt-3">
          <input
            id="reconcile-reason"
            className="input"
            value={reconcileReason}
            maxLength={500}
            onChange={(event) => setReconcileReason(event.target.value)}
            placeholder="e.g. Monthly physical count, 26 October"
          />
        </Field>
        <p className="mt-2 text-[11px] text-ink-500">
          Leave a line blank when the physical count matches the ledger. Counts greater than recorded stock create an
          adjustment in; lower counts create an adjustment out with the reason above.
        </p>
      </Modal>
    </div>
  );
}

function InsightTable({
  rows,
  kind,
}: {
  rows: Array<{
    productId: string;
    productName: string;
    sku: string;
    locationName?: string;
    quantity: string;
    soldLast30Days?: string;
    averageDailySales?: string;
    daysOfCover?: number;
    recommendedOrderQuantity?: string;
    explanation?: string;
  }>;
  kind: 'low' | 'over' | 'slow';
}) {
  if (!rows.length) {
    return <p className="px-4 py-6 text-center text-sm text-ink-500">No products in this category.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Branch</th>
            <th className="text-right">On hand</th>
            {kind !== 'slow' ? <th className="text-right">Avg daily</th> : null}
            {kind !== 'low' ? <th className="text-right">Sold in 30d</th> : null}
            {kind === 'over' ? <th className="text-right">Days cover</th> : null}
            {kind === 'low' ? <th className="text-right">Suggested order</th> : null}

          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.productId}-${row.locationName ?? ''}`}>
              <td>
                <p className="text-sm font-medium text-ink-900">{row.productName}</p>
                <p className="font-mono text-[10px] text-ink-400">{row.sku}</p>
                {row.explanation ? <p className="mt-0.5 max-w-[360px] text-[10px] text-ink-400">{row.explanation}</p> : null}
              </td>
              <td className="text-xs text-ink-600">{row.locationName ?? '—'}</td>
              <td className="text-right font-mono text-xs">{formatQuantity(row.quantity)}</td>
              {kind !== 'slow' ? (
                <td className="text-right font-mono text-xs">{row.averageDailySales ? formatNumber(row.averageDailySales, 2) : '—'}</td>
              ) : null}
              {kind !== 'low' ? (
                <td className="text-right font-mono text-xs">{row.soldLast30Days ? formatQuantity(row.soldLast30Days) : '—'}</td>
              ) : null}
              {kind === 'over' ? <td className="text-right font-mono text-xs">{row.daysOfCover ?? '—'}</td> : null}
              {kind === 'low' ? (
                <td className="text-right font-mono text-xs font-semibold text-brand-700">
                  {row.recommendedOrderQuantity ?? '—'}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
