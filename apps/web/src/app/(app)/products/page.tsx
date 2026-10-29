'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Boxes,
  FileUp,
  FolderTree,
  History,
  Package,
  PackagePlus,
  Pencil,
  Upload,
} from 'lucide-react';
import type { Category, Paginated, Product, ProductImportResult, Supplier, TaxRate } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney, formatQuantity } from '@/lib/format';
import { ExportButton, PermissionNotice } from '@/components/export-button';
import { useToast } from '@/components/toast';
import {
  ConfirmDialog,
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

interface ProductListResponse extends Paginated<Product> {
  locationId: string;
}

interface LedgerResponse {
  product: { id: string; name: string; sku: string; unit: string; costPrice: string };
  location: { id: string; name: string };
  currentQuantity: string;
  updatedAt: string | null;
  movements: Array<{
    id: string;
    movementType: string;
    quantity: string;
    unitCost: string;
    totalCost: string;
    balanceAfter: string;
    referenceType: string | null;
    reason: string | null;
    performedByName: string | null;
    createdAt: string;
  }>;
}

interface ProductFormState {
  name: string;
  sku: string;
  barcode: string;
  brand: string;
  description: string;
  categoryId: string;
  supplierId: string;
  sellingPrice: string;
  costPrice: string;
  taxRateId: string;
  reorderLevel: string;
  safetyStock: string;
  leadTimeDays: string;
  unit: string;
  imageUrl: string;
  isActive: boolean;
  openingQuantity: string;
}

const EMPTY_FORM: ProductFormState = {
  name: '',
  sku: '',
  barcode: '',
  brand: '',
  description: '',
  categoryId: '',
  supplierId: '',
  sellingPrice: '',
  costPrice: '',
  taxRateId: '',
  reorderLevel: '0',
  safetyStock: '0',
  leadTimeDays: '3',
  unit: 'piece',
  imageUrl: '',
  isActive: true,
  openingQuantity: '',
};

const IMPORT_TEMPLATE =
  'name,sku,barcode,brand,category,supplier,unit,selling_price,cost_price,tax_rate,reorder_level,safety_stock,lead_time_days';

export default function ProductsPage() {
  const { business, activeLocationId, can } = useAuth();
  const currency = business?.currency ?? 'UGX';
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [categoryId, setCategoryId] = useState('');
  const [stockStatus, setStockStatus] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);

  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState('');

  const [importOpen, setImportOpen] = useState(false);
  const [importCsv, setImportCsv] = useState('');
  const [importResult, setImportResult] = useState<ProductImportResult | null>(null);
  const [importError, setImportError] = useState('');

  const [ledgerProduct, setLedgerProduct] = useState<Product | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const categories = useQuery({
    queryKey: ['categories', includeInactive],
    queryFn: () => api.get<Category[]>('/categories', { includeInactive: includeInactive ? true : undefined }),
    enabled: can('products:read'),
    staleTime: 60_000,
  });

  const suppliers = useQuery({
    queryKey: ['suppliers', 'options'],
    queryFn: () => api.get<Paginated<Supplier>>('/suppliers', { page: 1, pageSize: 100 }),
    enabled: can('products:write'),
    staleTime: 120_000,
  });

  const taxRates = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => api.get<TaxRate[]>('/settings/tax-rates'),
    enabled: can('settings:read') && can('products:write'),
    staleTime: 120_000,
  });

  const products = useQuery({
    queryKey: ['products', { page, search: debounced, categoryId, stockStatus, includeInactive, activeLocationId }],
    queryFn: () =>
      api.get<ProductListResponse>('/products', {
        page,
        pageSize: 25,
        search: debounced || undefined,
        categoryId: categoryId || undefined,
        stockStatus: stockStatus || undefined,
        includeInactive: includeInactive ? true : undefined,
        locationId: activeLocationId || undefined,
      }),
    enabled: can('products:read'),
  });

  const ledger = useQuery({
    queryKey: ['product-ledger', ledgerProduct?.id, activeLocationId],
    queryFn: () =>
      api.get<LedgerResponse>(`/inventory/product/${ledgerProduct?.id}/ledger`, {
        locationId: activeLocationId || undefined,
      }),
    enabled: Boolean(ledgerProduct) && can('inventory:read'),
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['categories'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
  };

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing ? api.patch<Product>(`/products/${editing.id}`, payload) : api.post<Product>('/products', payload),
    onSuccess: async () => {
      toast(editing ? 'Product updated.' : 'Product created.', 'success');
      setFormOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      setFormError('');
      await invalidate();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: async () => {
      toast('Product archived. Its sales and stock history are preserved.', 'success');
      setArchiveTarget(null);
      await invalidate();
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  const createCategory = useMutation({
    mutationFn: (payload: { name: string }) => api.post<Category>('/categories', payload),
    onSuccess: async () => {
      toast('Category created.', 'success');
      setCategoryName('');
      setCategoryError('');
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (error) => setCategoryError(errorMessage(error)),
  });

  const toggleCategory = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch<Category>(`/categories/${id}`, { isActive }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  });

  const importProducts = useMutation({
    mutationFn: (csv: string) => api.post<ProductImportResult>('/products/import', { csv }),
    onSuccess: async (result) => {
      setImportResult(result);
      setImportError('');
      await invalidate();
    },
    onError: (error) => setImportError(errorMessage(error)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setForm({
      name: product.name,
      sku: product.sku,
      barcode: product.barcode ?? '',
      brand: product.brand ?? '',
      description: product.description ?? '',
      categoryId: product.categoryId ?? '',
      supplierId: product.supplierId ?? '',
      sellingPrice: product.sellingPrice,
      costPrice: product.costPrice,
      taxRateId: product.taxRateId ?? '',
      reorderLevel: product.reorderLevel,
      safetyStock: product.safetyStock,
      leadTimeDays: String(product.leadTimeDays),
      unit: product.unit,
      imageUrl: product.imageUrl ?? '',
      isActive: product.isActive,
      openingQuantity: '',
    });
    setFormError('');
    setFormOpen(true);
  };

  const submit = () => {
    setFormError('');
    if (!form.name.trim()) return setFormError('Product name is required.');
    if (!form.sku.trim()) return setFormError('An SKU is required and must be unique.');
    if (!/^\d+(\.\d{1,2})?$/.test(form.sellingPrice)) return setFormError('Selling price must be a non-negative amount with up to 2 decimals.');
    if (!/^\d+(\.\d{1,2})?$/.test(form.costPrice)) return setFormError('Cost price must be a non-negative amount with up to 2 decimals.');
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      sku: form.sku.trim(),
      barcode: form.barcode.trim() || null,
      brand: form.brand.trim() || null,
      description: form.description.trim() || null,
      categoryId: form.categoryId || null,
      supplierId: form.supplierId || null,
      sellingPrice: form.sellingPrice,
      costPrice: form.costPrice,
      taxRateId: form.taxRateId || null,
      reorderLevel: form.reorderLevel || '0',
      safetyStock: form.safetyStock || '0',
      leadTimeDays: Number(form.leadTimeDays || 0),
      unit: form.unit.trim() || 'piece',
      imageUrl: form.imageUrl.trim() || null,
      isActive: form.isActive,
    };
    if (!editing) {
      if (form.openingQuantity.trim()) payload.openingQuantity = form.openingQuantity.trim();
      payload.openingLocationId = activeLocationId;
    }
    save.mutate(payload);
  };

  const set = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const exportPath = useMemo(
    () =>
      `/products/export?${new URLSearchParams({
        locationId: activeLocationId || '',
        ...(debounced ? { search: debounced } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(stockStatus ? { stockStatus } : {}),
        ...(includeInactive ? { includeInactive: 'true' } : {}),
      }).toString()}`,
    [activeLocationId, debounced, categoryId, stockStatus, includeInactive],
  );

  if (!can('products:read')) return <PermissionNotice area="products" />;

  return (
    <div>
      <PageHeader
        title="Products"
        eyebrow="Catalogue"
        description="Products, prices and reorder rules for the whole business. Stock is held per branch."
        actions={
          <>
            <ExportButton path={exportPath} filename="products.csv" />
            {can('categories:read') ? (
              <button type="button" className="btn-secondary btn-sm" onClick={() => setCategoryOpen(true)}>
                <FolderTree className="h-3.5 w-3.5" /> Categories
              </button>
            ) : null}
            {can('products:write') ? (
              <>
                <button type="button" className="btn-secondary btn-sm" onClick={() => { setImportOpen(true); setImportResult(null); setImportError(''); }}>
                  <FileUp className="h-3.5 w-3.5" /> Import CSV
                </button>
                <button type="button" className="btn-primary btn-sm" onClick={openCreate}>
                  <PackagePlus className="h-3.5 w-3.5" /> New product
                </button>
              </>
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
              setPage(1);
            }}
            placeholder="Search name, SKU, barcode or brand…"
            className="lg:w-80"
          />
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
          <select
            className="select !w-auto text-xs"
            value={stockStatus}
            onChange={(event) => {
              setStockStatus(event.target.value);
              setPage(1);
            }}
            aria-label="Stock status"
          >
            <option value="">Any stock level</option>
            <option value="out">Out of stock</option>
            <option value="low">Low stock</option>
            <option value="ok">In stock</option>
          </select>
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
            Include archived
          </label>
        </div>
      </div>

      <div className="card overflow-hidden">
        {products.isLoading ? (
          <TableSkeleton rows={9} cols={7} />
        ) : products.isError ? (
          <ErrorState message={errorMessage(products.error)} onRetry={() => void products.refetch()} />
        ) : !products.data?.data.length ? (
          <EmptyState
            icon={<Package className="h-5 w-5" />}
            title="No products found"
            description={can('products:write') ? 'Create a product or import your catalogue from CSV.' : undefined}
            action={
              can('products:write') ? (
                <button type="button" className="btn-primary btn-sm" onClick={openCreate}>
                  New product
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Supplier</th>
                    <th className="text-right">Selling</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">On hand</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.data.data.map((product) => (
                    <tr key={product.id} className={!product.isActive ? 'opacity-60' : undefined}>
                      <td>
                        <p className="font-medium text-ink-900">{product.name}</p>
                        <p className="font-mono text-[11px] text-ink-400">
                          {product.sku}
                          {product.barcode ? ` · ${product.barcode}` : ''}
                          {product.brand ? ` · ${product.brand}` : ''}
                        </p>
                      </td>
                      <td className="text-xs text-ink-600">{product.categoryName ?? '—'}</td>
                      <td className="text-xs text-ink-600">{product.supplierName ?? '—'}</td>
                      <td className="text-right font-mono text-xs">{formatMoney(product.sellingPrice, currency)}</td>
                      <td className="text-right font-mono text-xs text-ink-500">{formatMoney(product.costPrice, currency)}</td>
                      <td className="text-right font-mono text-xs">
                        {formatQuantity(product.stock ?? '0')} <span className="text-[10px] text-ink-400">{product.unit}</span>
                      </td>
                      <td>
                        {product.isActive ? (
                          <span className={Number(product.stock ?? 0) <= 0 ? 'badge-red' : Number(product.stock ?? 0) <= Number(product.reorderLevel) ? 'badge-amber' : 'badge-green'}>
                            {Number(product.stock ?? 0) <= 0 ? 'Out of stock' : Number(product.stock ?? 0) <= Number(product.reorderLevel) ? 'Low' : 'In stock'}
                          </span>
                        ) : (
                          <span className="badge-slate">Archived</span>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          {can('inventory:read') ? (
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setLedgerProduct(product)} title="Stock history">
                              <History className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                          {can('products:write') ? (
                            <button type="button" className="btn-ghost btn-sm" onClick={() => openEdit(product)}>
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </button>
                          ) : null}
                          {can('products:delete') && product.isActive ? (
                            <button
                              type="button"
                              className="btn-ghost btn-sm text-red-600"
                              onClick={() => setArchiveTarget(product)}
                              title="Archive product"
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={products.data.page} pageSize={products.data.pageSize} total={products.data.total} onPage={setPage} />
          </>
        )}
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New product'}
        description={editing ? 'Changing prices is audited; past sales keep the prices they were sold at.' : 'The product is added to every active branch with zero stock unless you record opening quantity.'}
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)} disabled={save.isPending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={submit} disabled={save.isPending}>
              {save.isPending ? <Spinner /> : <Package className="h-4 w-4" />}
              {editing ? 'Save changes' : 'Create product'}
            </button>
          </>
        }
      >
        {formError ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{formError}</div>
        ) : null}
        <div className="space-y-3">
          <div className="field-row">
            <Field label="Name" required>
              <input className="input" value={form.name} onChange={(event) => set('name', event.target.value)} maxLength={160} />
            </Field>
            <Field label="SKU" required hint="Letters, numbers, dot, dash and underscore.">
              <input className="input font-mono" value={form.sku} onChange={(event) => set('sku', event.target.value)} maxLength={64} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Barcode">
              <input className="input font-mono" value={form.barcode} onChange={(event) => set('barcode', event.target.value)} maxLength={64} />
            </Field>
            <Field label="Brand">
              <input className="input" value={form.brand} onChange={(event) => set('brand', event.target.value)} maxLength={80} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Category">
              <select className="select" value={form.categoryId} onChange={(event) => set('categoryId', event.target.value)}>
                <option value="">Uncategorised</option>
                {(categories.data ?? []).filter((category) => category.isActive).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Supplier">
              <select className="select" value={form.supplierId} onChange={(event) => set('supplierId', event.target.value)}>
                <option value="">No default supplier</option>
                {(suppliers.data?.data ?? []).map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="field-row">
            <Field label={`Selling price (${currency})`} required>
              <input className="input font-mono" inputMode="decimal" value={form.sellingPrice} onChange={(event) => set('sellingPrice', event.target.value)} />
            </Field>
            <Field label={`Cost price (${currency})`} required>
              <input className="input font-mono" inputMode="decimal" value={form.costPrice} onChange={(event) => set('costPrice', event.target.value)} />
            </Field>
          </div>
          <div className="field-row">
            <Field
              label="Tax rate"
              hint={can('settings:read') ? undefined : 'Your role cannot list tax rates; the business default applies.'}
            >
              {can('settings:read') ? (
                <select className="select" value={form.taxRateId} onChange={(event) => set('taxRateId', event.target.value)}>
                  <option value="">Business default</option>
                  {(taxRates.data ?? []).map((rate) => (
                    <option key={rate.id} value={rate.id}>
                      {rate.name} · {rate.rate}%
                    </option>
                  ))}
                </select>
              ) : (
                <input className="input" value={editing ? `${editing.taxRate}%` : 'Business default'} readOnly disabled />
              )}
            </Field>
            <Field label="Unit">
              <input className="input" value={form.unit} onChange={(event) => set('unit', event.target.value)} maxLength={24} placeholder="piece, kg, litre…" />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Reorder level" hint="Alert when stock reaches this level.">
              <input className="input font-mono" inputMode="decimal" value={form.reorderLevel} onChange={(event) => set('reorderLevel', event.target.value)} />
            </Field>
            <Field label="Safety stock" hint="Buffer kept for demand spikes.">
              <input className="input font-mono" inputMode="decimal" value={form.safetyStock} onChange={(event) => set('safetyStock', event.target.value)} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Lead time (days)">
              <input className="input" type="number" min={0} max={365} value={form.leadTimeDays} onChange={(event) => set('leadTimeDays', event.target.value)} />
            </Field>
            {!editing ? (
              <Field label="Opening quantity" hint="Recorded as an opening balance in the selected branch.">
                <input className="input font-mono" inputMode="decimal" value={form.openingQuantity} onChange={(event) => set('openingQuantity', event.target.value)} placeholder="0" />
              </Field>
            ) : (
              <Field label="Status">
                <Toggle checked={form.isActive} onChange={(next) => set('isActive', next)} label={form.isActive ? 'Active' : 'Archived'} description="Archived products stay in old sales and stock history." />
              </Field>
            )}
          </div>
          <Field label="Description">
            <textarea className="input min-h-16" value={form.description} onChange={(event) => set('description', event.target.value)} maxLength={1000} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={categoryOpen}
        onClose={() => setCategoryOpen(false)}
        title="Categories"
        description="Categories group products for reporting. Archived categories keep their products and history."
        footer={
          <button type="button" className="btn-secondary" onClick={() => setCategoryOpen(false)}>
            Done
          </button>
        }
      >
        {can('categories:write') ? (
          <div className="mb-3 flex gap-2">
            <input
              className="input"
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder="New category name"
              maxLength={80}
            />
            <button
              type="button"
              className="btn-primary btn-sm shrink-0"
              disabled={createCategory.isPending || categoryName.trim().length < 1}
              onClick={() => createCategory.mutate({ name: categoryName.trim() })}
            >
              <Upload className="h-3.5 w-3.5" /> Add
            </button>
          </div>
        ) : null}
        {categoryError ? <p className="mb-2 text-xs text-red-600">{categoryError}</p> : null}
        <div className="divide-y divide-ink-100 rounded-lg border border-ink-200">
          {(categories.data ?? []).map((category) => (
            <div key={category.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div>
                <p className={`text-sm font-medium ${category.isActive ? 'text-ink-900' : 'text-ink-400 line-through'}`}>
                  {category.name}
                </p>
                <p className="text-[11px] text-ink-400">{category.productCount ?? 0} products</p>
              </div>
              {can('categories:write') ? (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={toggleCategory.isPending}
                  onClick={() => toggleCategory.mutate({ id: category.id, isActive: !category.isActive })}
                >
                  {category.isActive ? 'Archive' : 'Restore'}
                </button>
              ) : null}
            </div>
          ))}
          {!categories.data?.length ? <p className="px-3 py-6 text-center text-sm text-ink-500">No categories yet.</p> : null}
        </div>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import products from CSV"
        description="Up to 1,000 rows per import. Existing SKUs are updated; nothing is deleted."
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setImportOpen(false)}>
              Close
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={importProducts.isPending || !importCsv.trim()}
              onClick={() => importProducts.mutate(importCsv)}
            >
              {importProducts.isPending ? <Spinner /> : <FileUp className="h-4 w-4" />} Import
            </button>
          </>
        }
      >
        <div className="mb-3 rounded-lg bg-ink-50 px-3 py-2 text-[11px] text-ink-600">
          <p className="font-semibold text-ink-700">Expected header</p>
          <p className="mt-1 break-all font-mono">{IMPORT_TEMPLATE}</p>
          <p className="mt-1">Only name, sku, selling_price and cost_price are required. Categories, suppliers and tax rates are matched by name.</p>
        </div>
        <div className="mb-3 flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="text-xs"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setImportCsv(await file.text());
              setImportResult(null);
            }}
          />
        </div>
        <textarea
          className="input min-h-40 font-mono text-xs"
          value={importCsv}
          onChange={(event) => setImportCsv(event.target.value)}
          placeholder={`${IMPORT_TEMPLATE}\nSugar 1kg,SUG-001,,,Groceries,,piece,4500,3800,VAT 18%,12,6,3`}
        />
        {importError ? <p className="mt-2 text-xs text-red-600">{importError}</p> : null}
        {importResult ? (
          <div className="mt-3 rounded-lg border border-ink-200 p-3 text-xs">
            <p className="font-semibold text-ink-800">
              {importResult.imported} imported · {importResult.updated} updated · {importResult.skipped} skipped
            </p>
            {importResult.errors.length ? (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-red-600">
                {importResult.errors.map((error, index) => (
                  <li key={`${error.row}-${index}`}>Row {error.row}: {error.message}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-brand-700">No row errors.</p>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(ledgerProduct)}
        onClose={() => setLedgerProduct(null)}
        title={ledgerProduct ? `${ledgerProduct.name} stock history` : 'Stock history'}
        description={ledger.data ? `${ledger.data.location.name} · on hand ${formatQuantity(ledger.data.currentQuantity)} ${ledger.data.product.unit}` : undefined}
        size="xl"
        footer={
          <button type="button" className="btn-secondary" onClick={() => setLedgerProduct(null)}>
            Close
          </button>
        }
      >
        {ledger.isLoading ? (
          <div className="grid place-items-center py-10">
            <Spinner />
          </div>
        ) : ledger.isError ? (
          <ErrorState message={errorMessage(ledger.error)} onRetry={() => void ledger.refetch()} />
        ) : !ledger.data?.movements.length ? (
          <EmptyState compact title="No stock movements yet" description="Purchases, sales, transfers and counts will appear here." />
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-lg border border-ink-200">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th className="text-right">Change</th>
                  <th className="text-right">Balance</th>
                  <th>Reason</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="whitespace-nowrap text-[11px] text-ink-500">{formatDate(movement.createdAt, true)}</td>
                    <td className="text-xs">{movement.movementType.replaceAll('_', ' ').toLowerCase()}</td>
                    <td className={`text-right font-mono text-xs ${Number(movement.quantity) >= 0 ? 'text-brand-700' : 'text-red-600'}`}>
                      {Number(movement.quantity) >= 0 ? '+' : ''}
                      {formatQuantity(movement.quantity)}
                    </td>
                    <td className="text-right font-mono text-xs">{formatQuantity(movement.balanceAfter)}</td>
                    <td className="max-w-[220px] text-[11px] text-ink-500">
                      {movement.reason ?? movement.referenceType ?? '—'}
                    </td>
                    <td className="text-[11px] text-ink-500">{movement.performedByName ?? 'System'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-400">
          <Boxes className="h-3.5 w-3.5" /> Balances are recomputed from the append-only ledger; history cannot be edited.
        </p>
      </Modal>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => archiveTarget && archive.mutate(archiveTarget.id)}
        title="Archive product?"
        message={
          archiveTarget
            ? `${archiveTarget.name} will be hidden from the catalogue and point of sale. Existing sales, purchases and stock movements are kept. You can restore it later from the archived filter.`
            : ''
        }
        confirmLabel="Archive product"
        tone="danger"
        busy={archive.isPending}
      />
    </div>
  );
}
