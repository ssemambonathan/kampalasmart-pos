'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Pencil, Phone, Plus, SearchX, Truck } from 'lucide-react';
import type { Paginated, Supplier } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { PermissionNotice } from '@/components/export-button';
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
  TableSkeleton,
  Toggle,
  useDebounced,
} from '@/components/ui';

interface SupplierForm {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
}

const EMPTY: SupplierForm = {
  name: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
  isActive: true,
};

export default function SuppliersPage() {
  const { business, can } = useAuth();
  const currency = business?.currency ?? 'UGX';
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierForm>(EMPTY);
  const [error, setError] = useState('');

  const suppliers = useQuery({
    queryKey: ['suppliers', { page, search: debounced, includeInactive }],
    queryFn: () =>
      api.get<Paginated<Supplier>>('/suppliers', {
        page,
        pageSize: 25,
        search: debounced || undefined,
        includeInactive: includeInactive ? true : undefined,
      }),
    enabled: can('suppliers:read'),
  });

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing ? api.patch<Supplier>(`/suppliers/${editing.id}`, payload) : api.post<Supplier>('/suppliers', payload),
    onSuccess: async () => {
      toast(editing ? 'Supplier updated.' : 'Supplier created.', 'success');
      setOpen(false);
      setEditing(null);
      setForm(EMPTY);
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  if (!can('suppliers:read')) return <PermissionNotice area="suppliers" />;

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setError('');
    setOpen(true);
  };

  const openEdit = (supplier: Supplier) => {
    setEditing(supplier);
    setForm({
      name: supplier.name,
      contactName: supplier.contactName ?? '',
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      notes: supplier.notes ?? '',
      isActive: supplier.isActive,
    });
    setError('');
    setOpen(true);
  };

  const set = <K extends keyof SupplierForm>(key: K, value: SupplierForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = () => {
    setError('');
    if (!form.name.trim()) return setError('Supplier name is required.');
    if (form.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return setError('Enter a valid email address or leave it blank.');
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      contactName: form.contactName.trim() || null,
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
        title="Suppliers"
        eyebrow="Buying network"
        description="Suppliers are shared across branches. Purchase history is calculated from real received purchases and returns."
        actions={
          can('suppliers:write') ? (
            <button type="button" className="btn-primary btn-sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> New supplier
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
            placeholder="Search supplier, contact, phone or email…"
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
        {suppliers.isLoading ? (
          <TableSkeleton rows={7} cols={6} />
        ) : suppliers.isError ? (
          <ErrorState message={errorMessage(suppliers.error)} onRetry={() => void suppliers.refetch()} />
        ) : !suppliers.data?.data.length ? (
          <EmptyState
            icon={<SearchX className="h-5 w-5" />}
            title="No suppliers found"
            description="Add the businesses you buy stock from to use purchase orders and receive stock."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Contact</th>
                    <th className="text-right">Products</th>
                    <th className="text-right">Purchases</th>
                    <th className="text-right">Total purchased</th>
                    <th>Last purchase</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {suppliers.data.data.map((supplier) => (
                    <tr key={supplier.id} className={!supplier.isActive ? 'opacity-60' : undefined}>
                      <td>
                        <p className="font-medium text-ink-900">{supplier.name}</p>
                        <p className="text-[11px] text-ink-400">{supplier.address ?? 'No address on file'}</p>
                      </td>
                      <td className="text-xs text-ink-600">
                        {supplier.contactName ? <p className="font-medium text-ink-700">{supplier.contactName}</p> : null}
                        {supplier.phone ? (
                          <p className="flex items-center gap-1">
                            <Phone className="h-3 w-3 text-ink-400" /> {supplier.phone}
                          </p>
                        ) : null}
                        {supplier.email ? (
                          <p className="flex items-center gap-1">
                            <Mail className="h-3 w-3 text-ink-400" /> {supplier.email}
                          </p>
                        ) : null}
                        {!supplier.contactName && !supplier.phone && !supplier.email ? '—' : null}
                      </td>
                      <td className="text-right font-mono text-xs">{supplier.productCount}</td>
                      <td className="text-right font-mono text-xs">{supplier.purchaseCount}</td>
                      <td className="text-right font-mono text-xs font-semibold">{formatMoney(supplier.totalPurchased, currency)}</td>
                      <td className="whitespace-nowrap text-xs text-ink-500">
                        {supplier.lastPurchaseAt ? formatDate(supplier.lastPurchaseAt) : 'Never'}
                      </td>
                      <td className="text-right">
                        {can('suppliers:write') ? (
                          <button type="button" className="btn-ghost btn-sm" onClick={() => openEdit(supplier)}>
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                        ) : (
                          <span className={`badge ${supplier.isActive ? 'badge-green' : 'badge-slate'}`}>
                            {supplier.isActive ? 'Active' : 'Inactive'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={suppliers.data.page} pageSize={suppliers.data.pageSize} total={suppliers.data.total} onPage={setPage} />
          </>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New supplier'}
        description="Supplier records are shared by all branches."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={save.isPending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={submit} disabled={save.isPending}>
              {save.isPending ? <Spinner /> : <Truck className="h-4 w-4" />}
              {editing ? 'Save changes' : 'Create supplier'}
            </button>
          </>
        }
      >
        {error ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</div>
        ) : null}
        <div className="space-y-3">
          <Field label="Supplier name" required>
            <input className="input" value={form.name} onChange={(event) => set('name', event.target.value)} maxLength={160} />
          </Field>
          <div className="field-row">
            <Field label="Contact person">
              <input className="input" value={form.contactName} onChange={(event) => set('contactName', event.target.value)} maxLength={120} />
            </Field>
            <Field label="Phone">
              <input className="input" value={form.phone} onChange={(event) => set('phone', event.target.value)} maxLength={30} />
            </Field>
          </div>
          <Field label="Email">
            <input className="input" type="email" value={form.email} onChange={(event) => set('email', event.target.value)} maxLength={255} />
          </Field>
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
              label={form.isActive ? 'Active supplier' : 'Inactive supplier'}
              description="Inactive suppliers cannot be chosen on new purchase orders; past purchases are kept."
            />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
