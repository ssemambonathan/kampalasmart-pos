'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ReceiptText, SearchX } from 'lucide-react';
import type { Paginated, PaymentMethod, SaleSummary } from '@kampalasmart/shared';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, SALE_STATUSES } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney, formatTime, titleCase } from '@/lib/format';
import { DateRangeFilter, useDateRange } from '@/components/date-range';
import { ExportButton, PermissionNotice } from '@/components/export-button';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  StatusBadge,
  TableSkeleton,
  useDebounced,
} from '@/components/ui';

export default function SalesPage() {
  const { business, activeLocationId, can } = useAuth();
  const currency = business?.currency ?? 'UGX';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [pageSize] = useState(25);
  const debouncedSearch = useDebounced(search, 300);
  const range = useDateRange('30d');

  const filters = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    status: status || undefined,
    paymentMethod: method || undefined,
    locationId: activeLocationId || undefined,
    from: range.bounds.from,
    to: range.bounds.to,
  };

  const sales = useQuery({
    queryKey: ['sales', filters],
    queryFn: () => api.get<Paginated<SaleSummary>>('/sales', filters),
    enabled: can('sales:read:own'),
  });

  if (!can('sales:read:own')) return <PermissionNotice area="sales" />;

  const exportPath = `/sales/export?${new URLSearchParams(
    Object.entries(filters)
      .filter(([key, value]) => key !== 'page' && key !== 'pageSize' && value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  ).toString()}`;

  const updateStatus = (value: string) => {
    setStatus(value);
    setPage(1);
  };
  const updateMethod = (value: string) => {
    setMethod(value);
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Sales"
        eyebrow="Every receipt"
        description="Every server-confirmed sale in this branch. Offline sales appear here only after the server accepts them."
        actions={<ExportButton path={exportPath} filename="sales.csv" />}
      />

      <div className="card mb-4 p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search sale number, customer or cashier…"
            className="lg:w-80"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select className="select !w-auto text-xs" value={status} onChange={(event) => updateStatus(event.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {SALE_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {titleCase(option)}
                </option>
              ))}
            </select>
            <select className="select !w-auto text-xs" value={method} onChange={(event) => updateMethod(event.target.value)} aria-label="Filter by payment method">
              <option value="">All payment methods</option>
              {PAYMENT_METHODS.map((option) => (
                <option key={option} value={option}>
                  {PAYMENT_METHOD_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
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
        {sales.isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : sales.isError ? (
          <ErrorState message={errorMessage(sales.error)} onRetry={() => void sales.refetch()} />
        ) : !sales.data?.data.length ? (
          <EmptyState
            icon={<SearchX className="h-5 w-5" />}
            title="No sales match these filters"
            description="Try a wider date range or clear the search. Sales made on a till appear after they sync."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Sale</th>
                    <th>When</th>
                    <th>Branch</th>
                    <th>Cashier</th>
                    <th>Customer</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th className="text-right">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sales.data.data.map((sale) => (
                    <tr key={sale.id}>
                      <td>
                        <Link href={`/sales/${sale.id}`} className="font-mono text-xs font-semibold text-brand-700 hover:underline">
                          {sale.saleNumber}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap text-xs text-ink-600">
                        {formatDate(sale.createdAt)}
                        <span className="ml-1 text-ink-400">{formatTime(sale.createdAt)}</span>
                      </td>
                      <td className="text-xs text-ink-600">{sale.locationName}</td>
                      <td className="text-xs text-ink-700">{sale.cashierName}</td>
                      <td className="text-xs text-ink-700">{sale.customerName ?? <span className="text-ink-400">Walk-in</span>}</td>
                      <td className="text-xs text-ink-600">
                        {sale.paymentMethod ? PAYMENT_METHOD_LABELS[sale.paymentMethod as PaymentMethod] : '—'}
                      </td>
                      <td>
                        <StatusBadge status={sale.status} />
                      </td>
                      <td className="whitespace-nowrap text-right font-mono text-sm font-semibold text-ink-900">
                        {formatMoney(sale.total, currency)}
                      </td>
                      <td className="text-right">
                        <Link href={`/sales/${sale.id}`} className="btn-ghost btn-sm" aria-label={`Open ${sale.saleNumber}`}>
                          Open <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={sales.data.page} pageSize={sales.data.pageSize} total={sales.data.total} onPage={setPage} />
          </>
        )}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-400">
        <ReceiptText className="h-3.5 w-3.5" />
        Cashiers see only their own sales; managers and owners see the branch they are working in.
      </p>
    </div>
  );
}
