'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
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
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  ClipboardList,
  CreditCard,
  PackagePlus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { DashboardData, PaymentMethod } from '@kampalasmart/shared';
import { PAYMENT_METHOD_LABELS } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney, formatNumber, formatPercent, formatQuantity, relativeTime } from '@/lib/format';
import { EmptyState, ErrorState, PageHeader, StatCard, StatusBadge, TableSkeleton, cn } from '@/components/ui';

function TrendTooltip({
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
          <span className="font-mono font-semibold text-ink-900">
            {formatMoney(entry.value, currency, { compact: currency === 'UGX' })}
          </span>
        </p>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { business, activeLocationId, activeLocation, can, user } = useAuth();
  const [trendDays, setTrendDays] = useState(7);
  const currency = business?.currency ?? 'UGX';

  const dashboard = useQuery({
    queryKey: ['dashboard', activeLocationId, trendDays],
    queryFn: () =>
      api.get<DashboardData>('/reports/dashboard', {
        locationId: activeLocationId || undefined,
        trendDays,
      }),
    enabled: can('reports:read'),
  });

  const trendData = useMemo(
    () =>
      (dashboard.data?.trend ?? []).map((point) => ({
        ...point,
        label: new Date(`${point.date}T00:00:00`).toLocaleDateString('en-GB', {
          weekday: 'short',
          day: 'numeric',
        }),
        salesValue: Number(point.sales),
        profitValue: Number(point.profit),
      })),
    [dashboard.data],
  );

  if (!can('reports:read')) {
    return (
      <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-700">
          <ShoppingCart className="h-5 w-5" />
        </span>
        <h1 className="mt-3 text-lg font-semibold text-ink-950">Your workspace starts at the till</h1>
        <p className="mt-1 text-sm text-ink-600">
          Cashier accounts do not include business analytics. Open the point of sale to serve the next
          customer, or ask the owner for a manager role if you need reports.
        </p>
        <Link href="/pos" className="btn-primary mt-4">
          Open point of sale <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  if (dashboard.isLoading) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Loading today’s trading position…" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="card card-pad">
              <div className="skeleton h-3 w-20" />
              <div className="skeleton mt-3 h-7 w-32" />
              <div className="skeleton mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <div className="card"><div className="skeleton m-4 h-64" /></div>
          <div className="card"><TableSkeleton rows={5} cols={2} /></div>
        </div>
      </div>
    );
  }

  if (dashboard.isError) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <div className="card">
          <ErrorState message={errorMessage(dashboard.error)} onRetry={() => void dashboard.refetch()} />
        </div>
      </div>
    );
  }

  const data = dashboard.data!;
  const lowStock = data.lowStock ?? [];
  const todayLabel = formatDate(new Date());

  return (
    <div>
      <PageHeader
        eyebrow={`${activeLocation?.name ?? 'All branches'} · ${todayLabel}`}
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${user?.name.split(' ')[0]}`}
        description="Live trading position, stock risks and the actions that need you."
        actions={
          <>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => void dashboard.refetch()}
              disabled={dashboard.isFetching}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', dashboard.isFetching && 'animate-spin')} /> Refresh
            </button>
            <Link href="/pos" className="btn-primary btn-sm">
              <ShoppingCart className="h-3.5 w-3.5" /> New sale
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Net sales today"
          value={formatMoney(data.today.sales, currency, { compact: currency === 'UGX' })}
          detail={`${formatNumber(data.today.transactions)} transaction${data.today.transactions === 1 ? '' : 's'} · avg ticket ${formatMoney(data.today.averageSale, currency)}`}
          trend={data.comparison.salesChangePercent}
          icon={<Wallet className="h-5 w-5" />}
          tone="brand"
        />
        <StatCard
          label="Gross profit today"
          value={formatMoney(data.today.profit, currency, { compact: currency === 'UGX' })}
          detail={
            Number(data.today.sales) > 0
              ? `${formatPercent((Number(data.today.profit) / Number(data.today.sales)) * 100)} margin`
              : 'No sales yet today'
          }
          trend={data.comparison.profitChangePercent}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="brand"
        />
        <StatCard
          label="Discounts & refunds"
          value={formatMoney(Number(data.today.discounts) + Number(data.today.refunds), currency, {
            compact: currency === 'UGX',
          })}
          detail={`${formatMoney(data.today.discounts, currency)} discounts · ${formatMoney(data.today.refunds, currency)} refunds`}
          icon={<RotateCcw className="h-5 w-5" />}
          tone="amber"
        />
        <StatCard
          label="Stock at cost"
          value={formatMoney(data.inventoryValue, currency, { compact: currency === 'UGX' })}
          detail={`${lowStock.length ? `${lowStock.length} item${lowStock.length === 1 ? '' : 's'} need attention` : 'No low-stock alerts'}`}
          icon={<Boxes className="h-5 w-5" />}
          tone={lowStock.length ? 'red' : 'default'}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <section className="card card-pad min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink-950">Sales and profit trend</h2>
              <p className="text-xs text-ink-500">Completed sales minus refunds, tax excluded from profit.</p>
            </div>
            <div className="flex rounded-lg border border-ink-200 p-0.5">
              {[7, 14, 30].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setTrendDays(days)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-[11px] font-semibold',
                    trendDays === days ? 'bg-brand-700 text-white' : 'text-ink-500 hover:bg-ink-50',
                  )}
                >
                  {days}d
                </button>
              ))}
            </div>
          </div>
          {trendData.length === 0 ? (
            <EmptyState compact title="No trading history yet" description="Complete a sale to start building the trend." />
          ) : (
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 5, right: 5, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22916a" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#22916a" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f58207" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#f58207" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9edec" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#647771' }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#647771' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) => formatMoney(value, currency, { compact: true })}
                    width={58}
                  />
                  <Tooltip content={<TrendTooltip currency={currency} />} />
                  <Area
                    type="monotone"
                    dataKey="salesValue"
                    name="Net sales"
                    stroke="#147555"
                    strokeWidth={2}
                    fill="url(#salesFill)"
                  />
                  <Area
                    type="monotone"
                    dataKey="profitValue"
                    name="Gross profit"
                    stroke="#d95f02"
                    strokeWidth={1.8}
                    fill="url(#profitFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="card">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-ink-950">Reorder priorities</h2>
              <p className="text-xs text-ink-500">Based on real sales velocity and lead time.</p>
            </div>
            <Link href="/inventory?tab=low" className="text-xs font-semibold text-brand-700">
              Inventory →
            </Link>
          </div>
          {lowStock.length === 0 ? (
            <EmptyState compact title="Stock is healthy" description="No products are below their reorder level." icon={<Boxes className="h-5 w-5" />} />
          ) : (
            <div className="divide-y divide-ink-100">
              {lowStock.slice(0, 5).map((item) => (
                <div key={`${item.productId}-${item.locationId}`} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{item.productName}</p>
                      <p className="text-[10px] text-ink-400">
                        {item.sku} · {item.locationName}
                      </p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px]">
                    <span className="text-ink-500">
                      On hand <span className="font-mono font-semibold text-ink-800">{formatQuantity(item.quantity)}</span> · reorder{' '}
                      {formatQuantity(item.reorderLevel)}
                    </span>
                    <span className="font-semibold text-brand-700">+{formatQuantity(item.recommendedOrderQuantity)}</span>
                  </div>
                  {item.daysRemaining !== null ? (
                    <p className="mt-0.5 text-[10px] text-ink-400">
                      ~{item.daysRemaining.toFixed(1)} days left · {item.leadTimeDays}-day lead time
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <section className="card xl:col-span-2">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-950">Recent sales</h2>
            <Link href="/sales" className="text-xs font-semibold text-brand-700">
              All sales →
            </Link>
          </div>
          {data.recentSales.length === 0 ? (
            <EmptyState
              compact
              title="No sales recorded yet"
              description="Your first completed sale will appear here."
              action={<Link href="/pos" className="btn-primary btn-sm">Open POS</Link>}
              icon={<ReceiptText className="h-5 w-5" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Branch</th>
                    <th>Cashier</th>
                    <th>Payment</th>
                    <th className="text-right">Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentSales.map((sale) => (
                    <tr key={sale.id}>
                      <td>
                        <Link href={`/sales/${sale.id}`} className="font-mono text-xs font-semibold text-brand-700 hover:underline">
                          {sale.saleNumber}
                        </Link>
                        <p className="text-[10px] text-ink-400">{relativeTime(sale.createdAt)}</p>
                      </td>
                      <td className="text-xs">{sale.locationName}</td>
                      <td className="text-xs">{sale.cashierName}</td>
                      <td className="text-xs">
                        {sale.paymentMethod ? PAYMENT_METHOD_LABELS[sale.paymentMethod as PaymentMethod] : '—'}
                      </td>
                      <td className="text-right font-mono text-xs font-semibold">{formatMoney(sale.total, currency)}</td>
                      <td><StatusBadge status={sale.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-950">Needs your attention</h2>
            <p className="text-xs text-ink-500">Approvals and sync issues across the business.</p>
          </div>
          <div className="divide-y divide-ink-100">
            {[
              {
                label: 'Refunds awaiting approval',
                count: data.pending.refunds,
                href: '/refunds?status=PENDING',
                icon: <RotateCcw className="h-4 w-4" />,
              },
              {
                label: 'Stock transfers pending',
                count: data.pending.transfers,
                href: '/transfers?status=PENDING',
                icon: <ArrowRight className="h-4 w-4" />,
              },
              {
                label: 'Sync conflicts',
                count: data.pending.syncConflicts,
                href: '/sync',
                icon: <AlertTriangle className="h-4 w-4" />,
              },
              {
                label: 'Low stock products',
                count: lowStock.length,
                href: '/inventory?tab=low',
                icon: <Boxes className="h-4 w-4" />,
              },
            ].map((item) => (
              <Link key={item.label} href={item.href} className="flex items-center justify-between px-4 py-3 hover:bg-ink-50">
                <span className="flex items-center gap-2.5 text-sm text-ink-700">
                  <span className={cn('grid h-7 w-7 place-items-center rounded-lg', item.count ? 'bg-accent-50 text-accent-700' : 'bg-ink-100 text-ink-400')}>
                    {item.icon}
                  </span>
                  {item.label}
                </span>
                <span className={cn('font-mono text-sm font-semibold', item.count ? 'text-ink-950' : 'text-ink-400')}>
                  {item.count}
                </span>
              </Link>
            ))}
          </div>
          <div className="border-t border-ink-100 p-3">
            <div className="grid grid-cols-2 gap-2">
              <Link href="/purchases/new" className="btn-secondary btn-sm">
                <ClipboardList className="h-3.5 w-3.5" /> New purchase
              </Link>
              <Link href="/products" className="btn-secondary btn-sm">
                <PackagePlus className="h-3.5 w-3.5" /> Add product
              </Link>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="card">
          <div className="border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-950">Top products today</h2>
          </div>
          {data.topProducts.length === 0 ? (
            <EmptyState compact title="No product sales yet" description="Top sellers appear after the first sale." />
          ) : (
            <div className="divide-y divide-ink-100">
              {data.topProducts.slice(0, 5).map((product, index) => (
                <div key={product.productId} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-ink-100 font-mono text-[10px] font-bold text-ink-600">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ink-900">{product.name}</p>
                    <p className="text-[10px] text-ink-400">
                      {formatQuantity(product.quantity)} sold · {formatMoney(product.profit, currency)} profit
                    </p>
                  </div>
                  <span className="font-mono text-xs font-semibold text-ink-800">{formatMoney(product.revenue, currency, { compact: true })}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-950">Payment mix today</h2>
          </div>
          {data.paymentBreakdown.length === 0 ? (
            <EmptyState compact title="No payments yet" description="Payment methods appear once you sell." />
          ) : (
            <div className="space-y-3 p-4">
              {(() => {
                const totalPaid = data.paymentBreakdown.reduce((sum, row) => sum + Number(row.amount), 0);
                return data.paymentBreakdown.map((row) => {
                  const percent = totalPaid ? (Number(row.amount) / totalPaid) * 100 : 0;
                  return (
                    <div key={row.method}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-ink-600">{PAYMENT_METHOD_LABELS[row.method as PaymentMethod] ?? row.method}</span>
                        <span className="font-mono font-semibold text-ink-900">{formatMoney(row.amount, currency, { compact: true })}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${percent}%` }} />
                      </div>
                      <p className="mt-0.5 text-[10px] text-ink-400">{row.count} payment{row.count === 1 ? '' : 's'} · {percent.toFixed(0)}%</p>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </section>

        <section className="card">
          <div className="border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-950">Branch performance</h2>
          </div>
          {data.branchPerformance.length === 0 ? (
            <EmptyState compact title="No branch sales yet" description="Performance appears after trading starts." />
          ) : (
            <div className="divide-y divide-ink-100">
              {data.branchPerformance.map((branch) => (
                <div key={branch.locationId} className="px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-ink-900">{branch.name}</p>
                    <p className="font-mono text-xs font-semibold text-ink-800">{formatMoney(branch.sales, currency, { compact: true })}</p>
                  </div>
                  <p className="mt-0.5 text-[10px] text-ink-400">
                    {branch.transactions} sale{branch.transactions === 1 ? '' : 's'} · {formatMoney(branch.profit, currency)} profit
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[10px] text-ink-400">
        <CreditCard className="h-3 w-3" /> Figures use's server-confirmed transactions only. Offline sales appear after sync.
      </p>
    </div>
  );
}
