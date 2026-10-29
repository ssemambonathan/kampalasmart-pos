'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Pencil, Phone, Plus, UserRound, Users } from 'lucide-react';
import type { Customer, Paginated } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { PermissionNotice } from '@/components/export-button';
import { useToast } from '@/components/toast';
import {
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
  Toggle,
  useDebounced,
} from '@/components/ui';

interface CustomerDetail extends Customer {
  recentSales: Array<{
    id: string;
    saleNumber: string;
    status: string;
    total: string;
    itemCount: number;
    locationName: string;
    cashierName: string;
    createdAt: string;
  }>;
}

interface CustomerForm {
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
}

const EMPTY: CustomerForm = { name: '', phone: '', email: '', address: '', notes: '', isActive: true };

export default function CustomersPage() {
  const { business, can } = useAuth();
  const currency = business?.currency ?? 'UGX';
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerForm>(EMPTY);
  const [error, setError] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const customers = useQuery({
    queryKey: ['customers', { page, search: debounced, includeInactive }],
    queryFn: () =>
      api.get<Paginated<Customer>>('/customers', {
        page,
        pageSize: 25,
        search: debounced || undefined,
        includeInactive: includeInactive ? true : undefined,
      }),
    enabled: can('customers:read'),
  });

  const detail = useQuery({
    queryKey: ['customer', detailId],
    queryFn: () => api.get<CustomerDetail>(`/customers/${detailId}`),
    enabled: Boolean(detailId) && can('customers:read'),
  });

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing ? api.patch<Customer>(`/customers/${editing.id}`, payload) : api.post<Customer>('/customers', payload),
    onSuccess: async () => {
      toast(editing ? 'Customer updated.' : 'Customer created.', 'success');
      setFormOpen(false);
      setEditing(null);
      setForm(EMPTY);
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  if (!can('customers:read')) return <PermissionNotice area="customers" />;

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setError('');
    setFormOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditing(customer);
    setForm({
      name: customer.name,
      phone: customer.phone ?? '',
      email: customer.email ?? '',
      address: customer.address ?? '',
      notes: customer.notes ?? '',
      isActive: customer.isActive,
    });
    setError('');
    setFormOpen(true);
  };

  const set = <K extends keyof CustomerForm>(key: K, value: CustomerForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = () => {
    setError('');
    if (!form.name.trim()) return setError('Customer name is required.');
    if (form.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return setError('Enter a valid email address or leave it blank.');
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    };
    if (editing) payload.isActive = form.isActive;
    save.mutate(payload);
  };

  return (
    <div>
      <PageHeader
        title="Customers"
        eyebrow="Relationships"
        description="Customers are shared across branches. Spend and purchase counts come from completed sales, not estimates."
        actions={
          can('customers:write') ? (
            <button type="button" className="btn-primary btn-sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> New customer
            </button>
          ) : null
        }
      />

      <div className="card mb-4 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search name, phone or email…"
            className="sm:w-96"
          />
          <label className="flex items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600"
              checked={includeInactive}
              onChange={(event) => {
                setIncludeInactive(event.target.checked);
                setPage(1);
              }}
            />
            Include inactive
          </label>
        </div>
      </div>

      <div className="card overflow-hidden">
        {customers.isLoading ? (
          <TableSkeleton rows={7} cols={6} />
        ) : customers.isError ? (
          <ErrorState message={errorMessage(customers.error)} onRetry={() => void customers.refetch()} />
        ) : !customers.data?.data.length ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="No customers found"
            description="Add a customer at the till or here. Walk-in sales stay anonymous."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Contact</th>
                    <th className="text-right">Purchases</th>
                    <th className="text-right">Total spent</th>
                    <th>Last purchase</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {customers.data.data.map((customer) => (
                    <tr key={customer.id} className={!customer.isActive ? 'opacity-60' : undefined}>
                      <td>
                        <button
                          type="button"
                          className="text-left font-medium text-ink-900 hover:text-brand-700"
                          onClick={() => setDetailId(customer.id)}
                        >
                          {customer.name}
                        </button>
                        <p className="text-[11px] text-ink-400">Since {formatDate(customer.createdAt)}</p>
                      </td>
                      <td className="text-xs text-ink-600">
                        {customer.phone ? (
                          <p className="flex items-center gap-1">
                            <Phone className="h-3 w-3 text-ink-400" /> {customer.phone}
                          </p>
                        ) : null}
                        {customer.email ? (
                          <p className="flex items-center gap-1">
                            <Mail className="h-3 w-3 text-ink-400" /> {customer.email}
                          </p>
                        ) : null}
                        {!customer.phone && !customer.email ? '—' : null}
                      </td>
                      <td className="text-right font-mono text-xs">{customer.purchaseCount}</td>
                      <td className="text-right font-mono text-xs font-semibold">{formatMoney(customer.totalSpent, currency)}</td>
                      <td className="whitespace-nowrap text-xs text-ink-500">
                        {customer.lastPurchaseAt ? formatDate(customer.lastPurchaseAt) : 'Never'}
                      </td>
                      <td>
                        <span className={`badge ${customer.isActive ? 'badge-green' : 'badge-slate'}`}>
                          {customer.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="text-right">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setDetailId(customer.id)}>
                          View
                        </button>
                        {can('customers:write') ? (
                          <button type="button" className="btn-ghost btn-sm" onClick={() => openEdit(customer)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={customers.data.page} pageSize={customers.data.pageSize} total={customers.data.total} onPage={setPage} />
          </>
        )}
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New customer'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)} disabled={save.isPending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={submit} disabled={save.isPending}>
              {save.isPending ? <Spinner /> : <UserRound className="h-4 w-4" />}
              {editing ? 'Save changes' : 'Create customer'}
            </button>
          </>
        }
      >
        {error ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</div>
        ) : null}
        <div className="space-y-3">
          <Field label="Customer name" required>
            <input className="input" value={form.name} onChange={(event) => set('name', event.target.value)} maxLength={160} />
          </Field>
          <div className="field-row">
            <Field label="Phone">
              <input className="input" value={form.phone} onChange={(event) => set('phone', event.target.value)} maxLength={30} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" value={form.email} onChange={(event) => set('email', event.target.value)} maxLength={255} />
            </Field>
          </div>
          <Field label="Address">
            <input className="input" value={form.address} onChange={(event) => set('address', event.target.value)} maxLength={300} />
          </Field>
          <Field label="Notes">
            <textarea className="input min-h-16" value={form.notes} onChange={(event) => set('notes', event.target.value)} maxLength={1000} />
          </Field>
          {editing ? (
            <Toggle
              checked={form.isActive}
              onChange={(next) => set('isActive', next)}
              label={form.isActive ? 'Active customer' : 'Inactive customer'}
              description="Inactive customers are hidden from the till; their history is kept."
            />
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={detail.data?.name ?? 'Customer'}
        description={detail.data ? `Customer since ${formatDate(detail.data.createdAt)}` : undefined}
        size="lg"
        footer={
          <>
            {can('customers:write') && detail.data ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const customer = detail.data;
                  setDetailId(null);
                  if (customer) openEdit(customer);
                }}
              >
                <Pencil className="h-4 w-4" /> Edit customer
              </button>
            ) : null}
            <button type="button" className="btn-primary" onClick={() => setDetailId(null)}>
              Close
            </button>
          </>
        }
      >
        {detail.isLoading ? (
          <div className="grid place-items-center py-10">
            <Spinner />
          </div>
        ) : detail.isError || !detail.data ? (
          <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-ink-200 p-3">
                <KeyValue label="Phone">{detail.data.phone ?? '—'}</KeyValue>
                <KeyValue label="Email">{detail.data.email ?? '—'}</KeyValue>
                <KeyValue label="Address">{detail.data.address ?? '—'}</KeyValue>
              </div>
              <div className="rounded-lg border border-ink-200 p-3">
                <KeyValue label="Purchases">{detail.data.purchaseCount}</KeyValue>
                <KeyValue label="Total spent">{formatMoney(detail.data.totalSpent, currency)}</KeyValue>
                <KeyValue label="Last purchase">
                  {detail.data.lastPurchaseAt ? formatDate(detail.data.lastPurchaseAt) : 'Never'}
                </KeyValue>
              </div>
            </div>
            {detail.data.notes ? (
              <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">{detail.data.notes}</p>
            ) : null}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink-900">Recent sales</h3>
              {detail.data.recentSales.length ? (
                <div className="overflow-hidden rounded-lg border border-ink-200">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Sale</th>
                        <th>When</th>
                        <th>Branch</th>
                        <th>Status</th>
                        <th className="text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.recentSales.map((sale) => (
                        <tr key={sale.id}>
                          <td>
                            <Link href={`/sales/${sale.id}`} className="font-mono text-xs text-brand-700 hover:underline">
                              {sale.saleNumber}
                            </Link>
                            <p className="text-[10px] text-ink-400">{sale.itemCount} lines</p>
                          </td>
                          <td className="whitespace-nowrap text-[11px] text-ink-500">{formatDate(sale.createdAt, true)}</td>
                          <td className="text-[11px] text-ink-500">{sale.locationName}</td>
                          <td>
                            <StatusBadge status={sale.status} />
                          </td>
                          <td className="text-right font-mono text-xs">{formatMoney(sale.total, currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-ink-200 px-3 py-6 text-center text-sm text-ink-500">
                  This customer has no recorded sales yet.
                </p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
