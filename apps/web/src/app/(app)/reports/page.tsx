'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Boxes, CircleDollarSign, Percent, Receipt, Truck, Users } from 'lucide-react';
import type { PaymentMethod, ProfitExplanation, SalesSummaryReport } from '@kampalasmart/shared';
import { PAYMENT_METHOD_LABELS } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney, formatNumber, formatPercent, formatQuantity, titleCase } from '@/lib/format';
import { DateRangeFilter, useDateRange } from '@/components/date-range';
import { ExportButton, PermissionNotice } from '@/components/export-button';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  StatCard,
  StatusBadge,
  TableSkeleton,
  Tabs,
  cn,
  useDebounced,
} from '@/components/ui';

type ReportTab = 'overview' | 'profit' | 'products' | 'stock' | 'customers' | 'suppliers' | 'tax';
type Granularity = 'day' | 'week' | 'month';

interface ReportRange {
  from: string;
  to: string;
  days: number;
}

interface ProductReportRow {
  productId: string;
  name: string;
  sku: string;
  categoryName: string | null;
  supplierName: string | null;
  unit: string;
  quantitySold: string;
  revenue: string;
  cost: string;
  profit: string;
  marginPercent: number | null;
  stockOnHand: string;
  averageDailySales: string;
  daysOfCover: number | null;
}

interface ProductReport {
  range: ReportRange;
  totals: { revenue: string; profit: string; quantity: string; products: number; productsSold: number };
  rows: ProductReportRow[];
}

interface StockReportRow {
  productId: string;
  productName: string;
  sku: string;
  categoryName: string | null;
  locationId: string;
  locationName: string;
  quantity: string;
  unitCost: string;
  value: string;
  reorderLevel: string;
  safetyStock: string;
  status: 'OUT_OF_STOCK' | 'CRITICAL' | 'LOW' | 'OK';
}

interface StockReport {
  asOf: string;
  range: ReportRange;
  totals: {
    value: string;
    quantity: string;
    skuCount: number;
    locationCount: number;
    lowStock: number;
    critical: number;
    outOfStock: number;
  };
  byLocation: Array<{ locationId: string; name: string; value: string; quantity: string; skuCount: number }>;
  byCategory: Array<{ name: string; value: string; quantity: string; skuCount: number }>;
  movements: Array<{ movementType: string; quantity: string; value: string; count: number }>;
  rows: StockReportRow[];
}

interface CustomerReport {
  range: ReportRange;
  totals: {
    revenue: string;
    identifiedRevenue: string;
    anonymousRevenue: string;
    transactions: number;
    newCustomers: number;
    repeatCustomers: number;
    totalCustomers: number;
    averageSpend: string;
  };
  rows: Array<{
    customerId: string;
    name: string;
    phone: string | null;
    email: string | null;
    spend: string;
    profit: string;
    transactions: number;
    averageSale: string;
    lastPurchaseAt: string | null;
  }>;
}

interface SupplierReport {
  range: ReportRange;
  totals: { spend: string; netSpend: string; purchases: number; returns: string; suppliers: number };
  rows: Array<{
    supplierId: string;
    name: string;
    phone: string | null;
    email: string | null;
    purchases: number;
    spend: string;
    tax: string;
    returns: string;
    returnCount: number;
    netSpend: string;
    lastPurchaseAt: string | null;
  }>;
}

interface TaxReport {
  range: ReportRange;
  totals: {
    outputTax: string;
    refundTax: string;
    netOutputTax: string;
    inputTax: string;
    netTaxDue: string;
  };
  rows: Array<{ taxRate: string; tax: string; grossSales: string; netSales: string }>;
  disclaimer: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-semibold text-ink-800">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ink-500">
            <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} /> {entry.name}
          </span>
          <span className="font-mono font-semibold text-ink-900">{formatMoney(entry.value, currency)}</span>
        </p>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const { business, activeLocationId, activeLocation, can } = useAuth();
  const currency = business?.currency ?? 'UGX';
  const [tab, setTab] = useState<ReportTab>('overview');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [productSearch, setProductSearch] = useState('');
  const debouncedProductSearch = useDebounced(productSearch, 300);
  const range = useDateRange('30d');

  const scope = {
    from: range.query.from,
    to: range.query.to,
    locationId: activeLocationId || undefined,
  };

  const summary = useQuery({
    queryKey: ['report-sales-summary', scope, granularity],
    queryFn: () => api.get<SalesSummaryReport>('/reports/sales-summary', { ...scope, granularity }),
    enabled: can('reports:read') && tab === 'overview',
  });

  const profit = useQuery({
    queryKey: ['report-profit', scope],
    queryFn: () => api.get<ProfitExplanation>('/reports/profit-explanation', scope),
    enabled: can('reports:read') && can('analytics:read') && tab === 'profit',
  });

  const products = useQuery({
    queryKey: ['report-products', scope, debouncedProductSearch],
    queryFn: () =>
      api.get<ProductReport>('/reports/products', {
        ...scope,
        search: debouncedProductSearch || undefined,
      }),
    enabled: can('reports:read') && tab === 'products',
  });

  const stock = useQuery({
    queryKey: ['report-stock', scope],
    queryFn: () => api.get<StockReport>('/reports/stock', scope),
    enabled: can('reports:read') && tab === 'stock',
  });

  const customers = useQuery({
    queryKey: ['report-customers', scope],
    queryFn: () => api.get<CustomerReport>('/reports/customers', scope),
    enabled: can('reports:read') && tab === 'customers',
  });

  const suppliers = useQuery({
    queryKey: ['report-suppliers', scope],
    queryFn: () => api.get<SupplierReport>('/reports/suppliers', scope),
    enabled: can('reports:read') && tab === 'suppliers',
  });

  const tax = useQuery({
    queryKey: ['report-tax', scope],
    queryFn: () => api.get<TaxReport>('/reports/tax', scope),
    enabled: can('reports:read') && tab === 'tax',
  });

  if (!can('reports:read')) return <PermissionNotice area="reports and analytics" />;

  const exportQuery = (report: 'products' | 'stock' | 'customers' | 'suppliers' | 'tax', extra?: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    params.set('report', report);
    Object.entries({ ...scope, ...extra }).forEach(([key, value]) => {
      if (value !== undefined) params.set(key, value);
    });
    return `/reports/export?${params.toString()}`;
  };

  const tabs: Array<{ id: ReportTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'profit', label: 'Profit change' },
    { id: 'products', label: 'Products' },
    { id: 'stock', label: 'Stock' },
    { id: 'customers', label: 'Customers' },
    { id: 'suppliers', label: 'Suppliers' },
    { id: 'tax', label: 'Tax' },
  ];

  const summarySeries =
    summary.data?.series.map((point) => ({
      ...point,
      label: point.period,
      salesValue: Number(point.sales),
      profitValue: Number(point.profit),
    })) ?? [];

  return (
    <div>
      <PageHeader
        title="Reports"
        eyebrow="Evidence, not guesses"
        description={`Computed from recorded sales and stock for ${activeLocation?.name ?? 'all branches you can see'}. Refunds, discounts and tax are separated so the numbers can be checked.`}
        actions={
          <>
            {tab === 'products' ? (
              <ExportButton
                path={exportQuery('products', { search: debouncedProductSearch || undefined })}
                filename="product-report.csv"
              />
            ) : null}
            {tab === 'stock' ? <ExportButton path={exportQuery('stock')} filename="stock-report.csv" /> : null}
            {tab === 'customers' ? <ExportButton path={exportQuery('customers')} filename="customer-report.csv" /> : null}
            {tab === 'suppliers' ? <ExportButton path={exportQuery('suppliers')} filename="supplier-report.csv" /> : null}
            {tab === 'tax' ? <ExportButton path={exportQuery('tax')} filename="tax-report.csv" /> : null}
          </>
        }
      />

      <div className="card mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter
            preset={range.preset}
            range={range.range}
            onPreset={range.setPreset}
            onRange={range.setRange}
          />
          {tab === 'overview' ? (
            <select
              className="select !w-auto text-xs"
              value={granularity}
              onChange={(event) => setGranularity(event.target.value as Granularity)}
              aria-label="Series granularity"
            >
              <option value="day">Daily series</option>
              <option value="week">Weekly series</option>
              <option value="month">Monthly series</option>
            </select>
          ) : null}
          <span className="ml-auto text-[11px] text-ink-400">
            {range.query.from} to {range.query.to} · inclusive business dates
          </span>
        </div>
      </div>

      <div className="mb-4">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
      </div>

      {tab === 'overview' ? (
        summary.isLoading ? (
          <ReportLoading />
        ) : summary.isError ? (
          <div className="card">
            <ErrorState message={errorMessage(summary.error)} onRetry={() => void summary.refetch()} />
          </div>
        ) : !summary.data ? null : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Gross sales"
                value={formatMoney(summary.data.totals.grossSales, currency)}
                detail={`${formatNumber(summary.data.totals.transactions)} transactions`}
                icon={<CircleDollarSign className="h-5 w-5" />}
                tone="brand"
              />
              <StatCard
                label="Net revenue"
                value={formatMoney(summary.data.totals.netSales, currency)}
                detail="After discounts, refunds and tax"
                icon={<Receipt className="h-5 w-5" />}
              />
              <StatCard
                label="Gross profit"
                value={formatMoney(summary.data.totals.grossProfit, currency)}
                detail={
                  Number(summary.data.totals.netSales) > 0
                    ? `${formatPercent((Number(summary.data.totals.grossProfit) / Number(summary.data.totals.netSales)) * 100)} margin on net revenue`
                    : 'No net revenue'
                }
                icon={<BarChart3 className="h-5 w-5" />}
                tone="brand"
              />
              <StatCard
                label="Average sale"
                value={formatMoney(summary.data.totals.averageSale, currency)}
                detail={`${formatQuantity(summary.data.totals.itemsSold)} items sold`}
                icon={<Percent className="h-5 w-5" />}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
              <section className="card card-pad">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-ink-900">Sales and profit</h2>
                    <p className="text-xs text-ink-500">
                      Sales exclude tax and refunds; profit is net sales less the cost recorded on each sale line.
                    </p>
                  </div>
                  <span className="badge badge-slate">{titleCase(granularity)}</span>
                </div>
                {summarySeries.length ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={summarySeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="reportSales" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#0f766e" stopOpacity={0.28} />
                            <stop offset="100%" stopColor="#0f766e" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="reportProfit" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#d97706" stopOpacity={0.24} />
                            <stop offset="100%" stopColor="#d97706" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8e6" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#647771' }} axisLine={false} tickLine={false} minTickGap={16} />
                        <YAxis
                          tick={{ fontSize: 10, fill: '#647771' }}
                          axisLine={false}
                          tickLine={false}
                          width={54}
                          tickFormatter={(value: number) =>
                            formatMoney(value, currency, { compact: true })
                          }
                        />
                        <Tooltip content={<ChartTooltip currency={currency} />} />
                        <Area type="monotone" dataKey="salesValue" name="Net sales" stroke="#0f766e" strokeWidth={2} fill="url(#reportSales)" />
                        <Area type="monotone" dataKey="profitValue" name="Profit" stroke="#d97706" strokeWidth={2} fill="url(#reportProfit)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-ink-200 px-3 py-10 text-center text-sm text-ink-500">
                    No sales were recorded in this range.
                  </p>
                )}
              </section>

              <section className="card overflow-hidden">
                <div className="border-b border-ink-100 px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink-900">Payment methods</h2>
                </div>
                {summary.data.byPaymentMethod.length ? (
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Method</th>
                        <th className="text-right">Sales</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.data.byPaymentMethod.map((row) => (
                        <tr key={row.method}>
                          <td className="text-xs">{PAYMENT_METHOD_LABELS[row.method as PaymentMethod] ?? row.method}</td>
                          <td className="text-right font-mono text-xs">{formatNumber(row.count)}</td>
                          <td className="text-right font-mono text-xs font-semibold">{formatMoney(row.amount, currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-4 py-8 text-center text-sm text-ink-500">No payments in this range.</p>
                )}
                <div className="border-t border-ink-100 px-4 py-3 text-xs text-ink-500">
                  Discounts {formatMoney(summary.data.totals.discounts, currency)} · Refunds{' '}
                  {formatMoney(summary.data.totals.refunds, currency)} · Cost of goods{' '}
                  {formatMoney(summary.data.totals.costOfGoods, currency)}
                </div>
              </section>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="card overflow-hidden">
                <div className="border-b border-ink-100 px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink-900">By branch</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Branch</th>
                        <th className="text-right">Net sales</th>
                        <th className="text-right">Profit</th>
                        <th className="text-right">Transactions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.data.byLocation.map((row) => (
                        <tr key={row.locationId}>
                          <td className="text-xs font-medium text-ink-800">{row.name}</td>
                          <td className="text-right font-mono text-xs">{formatMoney(row.sales, currency)}</td>
                          <td className="text-right font-mono text-xs">{formatMoney(row.profit, currency)}</td>
                          <td className="text-right font-mono text-xs">{formatNumber(row.transactions)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card overflow-hidden">
                <div className="border-b border-ink-100 px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink-900">By cashier</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Cashier</th>
                        <th className="text-right">Net sales</th>
                        <th className="text-right">Profit</th>
                        <th className="text-right">Transactions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.data.byCashier.length ? (
                        summary.data.byCashier.map((row) => (
                          <tr key={row.userId}>
                            <td className="text-xs font-medium text-ink-800">{row.name}</td>
                            <td className="text-right font-mono text-xs">{formatMoney(row.sales, currency)}</td>
                            <td className="text-right font-mono text-xs">{formatMoney(row.profit, currency)}</td>
                            <td className="text-right font-mono text-xs">{formatNumber(row.transactions)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-xs text-ink-500">
                            No cashier activity in this range.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="card overflow-hidden">
                <div className="border-b border-ink-100 px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink-900">Top products</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Revenue</th>
                        <th className="text-right">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.data.topProducts.length ? (
                        summary.data.topProducts.map((row) => (
                          <tr key={row.productId}>
                            <td>
                              <p className="text-xs font-medium text-ink-800">{row.name}</p>
                              <p className="font-mono text-[10px] text-ink-400">{row.sku}</p>
                            </td>
                            <td className="text-right font-mono text-xs">{formatQuantity(row.quantity)}</td>
                            <td className="text-right font-mono text-xs">{formatMoney(row.revenue, currency)}</td>
                            <td className="text-right font-mono text-xs">{formatMoney(row.profit, currency)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-xs text-ink-500">
                            No product sales in this range.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card overflow-hidden">
                <div className="border-b border-ink-100 px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink-900">By category</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Revenue</th>
                        <th className="text-right">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.data.byCategory.length ? (
                        summary.data.byCategory.map((row) => (
                          <tr key={`${row.categoryId ?? 'none'}-${row.name}`}>
                            <td className="text-xs font-medium text-ink-800">{row.name}</td>
                            <td className="text-right font-mono text-xs">{formatQuantity(row.quantity)}</td>
                            <td className="text-right font-mono text-xs">{formatMoney(row.sales, currency)}</td>
                            <td className="text-right font-mono text-xs">{formatMoney(row.profit, currency)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-xs text-ink-500">
                            No category activity in this range.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <section className="card overflow-hidden">
              <div className="border-b border-ink-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-900">Discounted sales</h2>
                <p className="text-xs text-ink-500">Every discount shown here is attached to a recorded sale.</p>
              </div>
              {summary.data.discounts.length ? (
                <div className="overflow-x-auto">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Sale</th>
                        <th>Cashier</th>
                        <th>When</th>
                        <th className="text-right">Discount</th>
                        <th className="text-right">Sale total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.data.discounts.map((row) => (
                        <tr key={row.saleNumber}>
                          <td className="font-mono text-xs">{row.saleNumber}</td>
                          <td className="text-xs text-ink-600">{row.cashierName}</td>
                          <td className="whitespace-nowrap text-xs text-ink-500">{formatDate(row.createdAt, true)}</td>
                          <td className="text-right font-mono text-xs">{formatMoney(row.discount, currency)}</td>
                          <td className="text-right font-mono text-xs">{formatMoney(row.total, currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-6 text-center text-sm text-ink-500">No discounts were given in this range.</p>
              )}
            </section>
          </div>
        )
      ) : null}

      {tab === 'profit' ? (
        !can('analytics:read') ? (
          <PermissionNotice area="profit analytics" />
        ) : profit.isLoading ? (
          <ReportLoading />
        ) : profit.isError ? (
          <div className="card">
            <ErrorState message={errorMessage(profit.error)} onRetry={() => void profit.refetch()} />
          </div>
        ) : !profit.data ? null : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Current profit"
                value={formatMoney(profit.data.currentPeriod.profit, currency)}
                detail={`${formatDate(profit.data.currentPeriod.from)} to ${formatDate(profit.data.currentPeriod.to)}`}
                icon={<BarChart3 className="h-5 w-5" />}
                tone="brand"
              />
              <StatCard
                label="Previous profit"
                value={formatMoney(profit.data.previousPeriod.profit, currency)}
                detail={`${formatDate(profit.data.previousPeriod.from)} to ${formatDate(profit.data.previousPeriod.to)}`}
                icon={<Receipt className="h-5 w-5" />}
              />
              <StatCard
                label="Profit change"
                value={formatMoney(profit.data.profitChange, currency)}
                detail={
                  profit.data.profitChangePercent === null
                    ? 'No comparable prior period'
                    : `${profit.data.profitChangePercent.toFixed(1)}% against the prior period`
                }
                trend={profit.data.profitChangePercent}
                icon={<Percent className="h-5 w-5" />}
                tone={Number(profit.data.profitChange) < 0 ? 'red' : 'brand'}
              />
              <StatCard
                label="Margin"
                value={formatPercent(profit.data.currentPeriod.marginPercent)}
                detail={`Prior period ${formatPercent(profit.data.previousPeriod.marginPercent)}`}
                icon={<CircleDollarSign className="h-5 w-5" />}
              />
            </div>

            <section className="card overflow-hidden">
              <div className="border-b border-ink-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-900">Why profit moved</h2>
                <p className="text-xs text-ink-500">
                  Each driver is measured against the previous comparable period. Impacts are estimates of contribution, not
                  audited allocations.
                </p>
              </div>
              <ul className="divide-y divide-ink-100">
                {profit.data.reasons.map((reason) => (
                  <li key={reason.title} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="max-w-2xl">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink-900">{reason.title}</span>
                        <StatusBadge
                          status={reason.direction === 'UP' ? 'COMPLETED' : reason.direction === 'DOWN' ? 'REJECTED' : 'INACTIVE'}
                          label={reason.direction === 'UP' ? 'Helped' : reason.direction === 'DOWN' ? 'Hurt' : 'Neutral'}
                        />
                      </div>
                      <p className="mt-1 text-xs text-ink-600">{reason.detail}</p>
                    </div>
                    <span
                      className={cn(
                        'whitespace-nowrap font-mono text-sm font-semibold',
                        reason.direction === 'UP' ? 'text-brand-700' : reason.direction === 'DOWN' ? 'text-red-600' : 'text-ink-600',
                      )}
                    >
                      {formatMoney(reason.impact, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="card card-pad">
                <h2 className="text-sm font-semibold text-ink-900">Largest product contributor</h2>
                {profit.data.largestContributor ? (
                  <div className="mt-2">
                    <p className="text-sm text-ink-800">{profit.data.largestContributor.name}</p>
                    <p className="mt-1 font-mono text-lg font-semibold text-ink-950">
                      {formatMoney(profit.data.largestContributor.profitChange, currency)}
                    </p>
                    <p className="mt-1 text-xs text-ink-500">Change in profit contributed by this product.</p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-ink-500">No single product explains the change in this period.</p>
                )}
              </section>
              <section className="card card-pad">
                <h2 className="text-sm font-semibold text-ink-900">Suggested action</h2>
                <p className="mt-2 text-sm text-ink-700">{profit.data.suggestedAction}</p>
                <p className="mt-3 text-[11px] text-ink-400">{profit.data.basedOn}</p>
              </section>
            </div>
          </div>
        )
      ) : null}

      {tab === 'products' ? (
        products.isLoading ? (
          <ReportLoading />
        ) : products.isError ? (
          <div className="card">
            <ErrorState message={errorMessage(products.error)} onRetry={() => void products.refetch()} />
          </div>
        ) : !products.data ? null : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Revenue" value={formatMoney(products.data.totals.revenue, currency)} detail="Net of tax on sold lines" />
              <StatCard label="Gross profit" value={formatMoney(products.data.totals.profit, currency)} />
              <StatCard label="Quantity sold" value={formatQuantity(products.data.totals.quantity)} />
              <StatCard
                label="Products sold"
                value={`${formatNumber(products.data.totals.productsSold)} / ${formatNumber(products.data.totals.products)}`}
                detail="Products with at least one sale out of the active catalogue"
              />
            </div>

            <div className="card p-3">
              <SearchInput
                value={productSearch}
                onChange={setProductSearch}
                placeholder="Search product name or SKU…"
                className="sm:w-96"
              />
            </div>

            <section className="card overflow-hidden">
              {products.data.rows.length ? (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Category</th>
                        <th className="text-right">Sold</th>
                        <th className="text-right">Revenue</th>
                        <th className="text-right">Profit</th>
                        <th className="text-right">Margin</th>
                        <th className="text-right">On hand</th>
                        <th className="text-right">Cover</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.data.rows.map((row) => (
                        <tr key={row.productId}>
                          <td>
                            <p className="text-sm font-medium text-ink-900">{row.name}</p>
                            <p className="font-mono text-[10px] text-ink-400">
                              {row.sku}
                              {row.supplierName ? ` · ${row.supplierName}` : ''}
                            </p>
                          </td>
                          <td className="text-xs text-ink-500">{row.categoryName ?? 'Uncategorised'}</td>
                          <td className="text-right font-mono text-xs">
                            {formatQuantity(row.quantitySold)} <span className="text-[10px] text-ink-400">{row.unit}</span>
                          </td>
                          <td className="text-right font-mono text-xs">{formatMoney(row.revenue, currency)}</td>
                          <td className="text-right font-mono text-xs">{formatMoney(row.profit, currency)}</td>
                          <td className="text-right font-mono text-xs">
                            {row.marginPercent === null ? '—' : formatPercent(row.marginPercent)}
                          </td>
                          <td className="text-right font-mono text-xs">{formatQuantity(row.stockOnHand)}</td>
                          <td className="text-right font-mono text-xs">
                            {row.daysOfCover === null ? '—' : `${formatNumber(row.daysOfCover, 1)}d`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon={<Boxes className="h-5 w-5" />}
                  title="No products matched"
                  description="Adjust the search or date range. Archived products are not included."
                />
              )}
            </section>
          </div>
        )
      ) : null}

      {tab === 'stock' ? (
        stock.isLoading ? (
          <ReportLoading />
        ) : stock.isError ? (
          <div className="card">
            <ErrorState message={errorMessage(stock.error)} onRetry={() => void stock.refetch()} />
          </div>
        ) : !stock.data ? null : (
          <div className="space-y-4">
            <p className="text-xs text-ink-500">
              Valued at current product cost as of {formatDate(stock.data.asOf, true)}. This is an internal valuation, not a
              purchase quote.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Stock value" value={formatMoney(stock.data.totals.value, currency)} detail={`${formatNumber(stock.data.totals.skuCount)} SKUs`} icon={<Boxes className="h-5 w-5" />} tone="brand" />
              <StatCard label="Units on hand" value={formatQuantity(stock.data.totals.quantity)} detail={`Across ${formatNumber(stock.data.totals.locationCount)} branches`} />
              <StatCard label="Reorder needed" value={formatNumber(stock.data.totals.lowStock)} detail={`${formatNumber(stock.data.totals.critical)} critical`} tone="amber" />
              <StatCard label="Out of stock" value={formatNumber(stock.data.totals.outOfStock)} detail="Product/branch level" tone="red" />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="card overflow-hidden">
                <div className="border-b border-ink-100 px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink-900">Value by branch</h2>
                </div>
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Branch</th>
                      <th className="text-right">SKUs</th>
                      <th className="text-right">Quantity</th>
                      <th className="text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.data.byLocation.map((row) => (
                      <tr key={row.locationId}>
                        <td className="text-xs font-medium text-ink-800">{row.name}</td>
                        <td className="text-right font-mono text-xs">{formatNumber(row.skuCount)}</td>
                        <td className="text-right font-mono text-xs">{formatQuantity(row.quantity)}</td>
                        <td className="text-right font-mono text-xs font-semibold">{formatMoney(row.value, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="card overflow-hidden">
                <div className="border-b border-ink-100 px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink-900">Value by category</h2>
                </div>
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th className="text-right">SKUs</th>
                      <th className="text-right">Quantity</th>
                      <th className="text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.data.byCategory.map((row) => (
                      <tr key={row.name}>
                        <td className="text-xs font-medium text-ink-800">{row.name}</td>
                        <td className="text-right font-mono text-xs">{formatNumber(row.skuCount)}</td>
                        <td className="text-right font-mono text-xs">{formatQuantity(row.quantity)}</td>
                        <td className="text-right font-mono text-xs font-semibold">{formatMoney(row.value, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>

            <section className="card overflow-hidden">
              <div className="border-b border-ink-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-900">Movement summary</h2>
                <p className="text-xs text-ink-500">Ledger movements between {stock.data.range.from} and {stock.data.range.to}.</p>
              </div>
              {stock.data.movements.length ? (
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Movement</th>
                      <th className="text-right">Count</th>
                      <th className="text-right">Quantity</th>
                      <th className="text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.data.movements.map((row) => (
                      <tr key={row.movementType}>
                        <td className="text-xs">{titleCase(row.movementType)}</td>
                        <td className="text-right font-mono text-xs">{formatNumber(row.count)}</td>
                        <td className="text-right font-mono text-xs">{formatQuantity(row.quantity)}</td>
                        <td className="text-right font-mono text-xs">{formatMoney(row.value, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-4 py-6 text-center text-sm text-ink-500">No stock movements in this range.</p>
              )}
            </section>

            <section className="card overflow-hidden">
              <div className="border-b border-ink-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-900">Stock detail</h2>
                <p className="text-xs text-ink-500">Highest value first. Status uses each product’s safety and reorder levels.</p>
              </div>
              <div className="max-h-[520px] overflow-auto">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Branch</th>
                      <th>Status</th>
                      <th className="text-right">On hand</th>
                      <th className="text-right">Unit cost</th>
                      <th className="text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.data.rows.map((row) => (
                      <tr key={`${row.productId}-${row.locationId}`}>
                        <td>
                          <p className="text-xs font-medium text-ink-800">{row.productName}</p>
                          <p className="font-mono text-[10px] text-ink-400">{row.sku}</p>
                        </td>
                        <td className="text-xs text-ink-500">{row.locationName}</td>
                        <td>
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="text-right font-mono text-xs">{formatQuantity(row.quantity)}</td>
                        <td className="text-right font-mono text-xs">{formatMoney(row.unitCost, currency)}</td>
                        <td className="text-right font-mono text-xs font-semibold">{formatMoney(row.value, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )
      ) : null}

      {tab === 'customers' ? (
        customers.isLoading ? (
          <ReportLoading />
        ) : customers.isError ? (
          <div className="card">
            <ErrorState message={errorMessage(customers.error)} onRetry={() => void customers.refetch()} />
          </div>
        ) : !customers.data ? null : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Identified customer revenue" value={formatMoney(customers.data.totals.identifiedRevenue, currency)} detail={`Walk-in ${formatMoney(customers.data.totals.anonymousRevenue, currency)}`} icon={<Users className="h-5 w-5" />} tone="brand" />
              <StatCard label="Average spend" value={formatMoney(customers.data.totals.averageSpend, currency)} detail="Per identified customer in range" />
              <StatCard label="New customers" value={formatNumber(customers.data.totals.newCustomers)} detail={`${formatNumber(customers.data.totals.totalCustomers)} active customers`} />
              <StatCard label="Repeat customers" value={formatNumber(customers.data.totals.repeatCustomers)} detail={`${formatNumber(customers.data.totals.transactions)} transactions incl. walk-ins`} />
            </div>
            <section className="card overflow-hidden">
              <div className="border-b border-ink-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-900">Customer spend</h2>
                <p className="text-xs text-ink-500">Top 200 identified customers. Walk-in sales are excluded from this table.</p>
              </div>
              {customers.data.rows.length ? (
                <div className="overflow-x-auto">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Contact</th>
                        <th className="text-right">Transactions</th>
                        <th className="text-right">Spend</th>
                        <th className="text-right">Avg sale</th>
                        <th className="text-right">Profit</th>
                        <th>Last purchase</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.data.rows.map((row) => (
                        <tr key={row.customerId}>
                          <td className="text-xs font-medium text-ink-800">{row.name}</td>
                          <td className="text-[11px] text-ink-500">{row.phone ?? row.email ?? '—'}</td>
                          <td className="text-right font-mono text-xs">{formatNumber(row.transactions)}</td>
                          <td className="text-right font-mono text-xs font-semibold">{formatMoney(row.spend, currency)}</td>
                          <td className="text-right font-mono text-xs">{formatMoney(row.averageSale, currency)}</td>
                          <td className="text-right font-mono text-xs">{formatMoney(row.profit, currency)}</td>
                          <td className="whitespace-nowrap text-xs text-ink-500">
                            {row.lastPurchaseAt ? formatDate(row.lastPurchaseAt) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-8 text-center text-sm text-ink-500">No identified customer purchases in this range.</p>
              )}
            </section>
          </div>
        )
      ) : null}

      {tab === 'suppliers' ? (
        suppliers.isLoading ? (
          <ReportLoading />
        ) : suppliers.isError ? (
          <div className="card">
            <ErrorState message={errorMessage(suppliers.error)} onRetry={() => void suppliers.refetch()} />
          </div>
        ) : !suppliers.data ? null : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Gross spend" value={formatMoney(suppliers.data.totals.spend, currency)} detail={`${formatNumber(suppliers.data.totals.purchases)} purchase orders`} icon={<Truck className="h-5 w-5" />} />
              <StatCard label="Supplier returns" value={formatMoney(suppliers.data.totals.returns, currency)} tone="amber" />
              <StatCard label="Net spend" value={formatMoney(suppliers.data.totals.netSpend, currency)} detail="Purchases less returns" tone="brand" />
              <StatCard label="Suppliers active" value={formatNumber(suppliers.data.totals.suppliers)} />
            </div>
            <section className="card overflow-hidden">
              <div className="border-b border-ink-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-900">Purchasing by supplier</h2>
                <p className="text-xs text-ink-500">Includes orders created in range, whether or not they have been received.</p>
              </div>
              {suppliers.data.rows.length ? (
                <div className="overflow-x-auto">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Supplier</th>
                        <th>Contact</th>
                        <th className="text-right">Orders</th>
                        <th className="text-right">Spend</th>
                        <th className="text-right">Returns</th>
                        <th className="text-right">Net spend</th>
                        <th>Last order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suppliers.data.rows.map((row) => (
                        <tr key={row.supplierId}>
                          <td className="text-xs font-medium text-ink-800">{row.name}</td>
                          <td className="text-[11px] text-ink-500">{row.phone ?? row.email ?? '—'}</td>
                          <td className="text-right font-mono text-xs">{formatNumber(row.purchases)}</td>
                          <td className="text-right font-mono text-xs">{formatMoney(row.spend, currency)}</td>
                          <td className="text-right font-mono text-xs">{formatMoney(row.returns, currency)}</td>
                          <td className="text-right font-mono text-xs font-semibold">{formatMoney(row.netSpend, currency)}</td>
                          <td className="whitespace-nowrap text-xs text-ink-500">
                            {row.lastPurchaseAt ? formatDate(row.lastPurchaseAt) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-8 text-center text-sm text-ink-500">No supplier activity in this range.</p>
              )}
            </section>
          </div>
        )
      ) : null}

      {tab === 'tax' ? (
        tax.isLoading ? (
          <ReportLoading />
        ) : tax.isError ? (
          <div className="card">
            <ErrorState message={errorMessage(tax.error)} onRetry={() => void tax.refetch()} />
          </div>
        ) : !tax.data ? null : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Output tax" value={formatMoney(tax.data.totals.outputTax, currency)} detail="Tax charged on sales" icon={<Percent className="h-5 w-5" />} />
              <StatCard label="Refund tax" value={formatMoney(tax.data.totals.refundTax, currency)} detail="Tax reversed on completed refunds" tone="amber" />
              <StatCard label="Input tax" value={formatMoney(tax.data.totals.inputTax, currency)} detail="Tax recorded on purchase orders" />
              <StatCard
                label="Net tax position"
                value={formatMoney(tax.data.totals.netTaxDue, currency)}
                detail={`Net output ${formatMoney(tax.data.totals.netOutputTax, currency)} less input tax`}
                tone={Number(tax.data.totals.netTaxDue) > 0 ? 'red' : 'brand'}
              />
            </div>
            <section className="card overflow-hidden">
              <div className="border-b border-ink-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-ink-900">Output tax by rate</h2>
              </div>
              {tax.data.rows.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Rate</th>
                      <th className="text-right">Gross sales</th>
                      <th className="text-right">Net sales</th>
                      <th className="text-right">Tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tax.data.rows.map((row) => (
                      <tr key={row.taxRate}>
                        <td className="font-mono text-xs">{Number(row.taxRate)}%</td>
                        <td className="text-right font-mono text-xs">{formatMoney(row.grossSales, currency)}</td>
                        <td className="text-right font-mono text-xs">{formatMoney(row.netSales, currency)}</td>
                        <td className="text-right font-mono text-xs font-semibold">{formatMoney(row.tax, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-4 py-8 text-center text-sm text-ink-500">No taxed sales in this range.</p>
              )}
            </section>
            <p className="rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-xs text-accent-900">
              {tax.data.disclaimer}
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}

function ReportLoading() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="card card-pad">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton mt-3 h-7 w-32" />
            <div className="skeleton mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="card">
        <TableSkeleton rows={8} cols={6} />
      </div>
    </div>
  );
}
