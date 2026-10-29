'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Barcode,
  CreditCard,
  Minus,
  PauseCircle,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShoppingCart,
  Smartphone,
  Trash2,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PricingError,
  discountLimitForRole,
  discountPercent,
  priceCart,
  type Customer,
  type PaymentMethod,
  type PriceableProduct,
  type PricedCart,
  type Sale,
  type TaxRate,
} from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/offline/sync';
import { getDb, type CachedProduct, type LocalSale } from '@/lib/offline/db';
import { api, errorMessage } from '@/lib/api';
import { formatMoney, formatQuantity, formatTime } from '@/lib/format';
import { printReceipt } from '@/lib/print';
import { PageHeader, Spinner, StatusBadge, cn } from '@/components/ui';
import { useToast } from '@/components/toast';
import { ReceiptView, receiptFromPricedCart, type ReceiptData } from '@/components/receipt';
import { Modal } from '@/components/ui';

interface CartLine {
  productId: string;
  quantity: string;
  unitPrice: string;
}

interface HeldCart {
  id: string;
  label: string;
  createdAt: string;
  lines: CartLine[];
  customerId: string;
  notes: string;
  discountType: 'PERCENT' | 'AMOUNT';
  discountValue: string;
}

const HELD_KEY = 'ks_held_carts';

function useCatalogue(locationId: string) {
  const products = useLiveQuery(
    async () => {
      if (typeof window === 'undefined') return [];
      return getDb().products.toArray();
    },
    [locationId],
    [] as CachedProduct[],
  );
  const inventory = useLiveQuery(
    async () => {
      if (typeof window === 'undefined' || !locationId) return [];
      return getDb().inventory.where('locationId').equals(locationId).toArray();
    },
    [locationId],
    [],
  );
  const customers = useLiveQuery(
    async () => {
      if (typeof window === 'undefined') return [];
      return getDb().customers.toArray();
    },
    [],
    [],
  );
  const taxRates = useLiveQuery(
    async () => {
      if (typeof window === 'undefined') return [];
      return getDb().taxRates.toArray();
    },
    [],
    [] as TaxRate[],
  );
  const stocked = useMemo(() => {
    const stock = new Map(inventory.map((row) => [row.productId, row.quantity]));
    return products.map((product) => ({ ...product, stock: stock.get(product.id) ?? product.stock ?? '0' }));
  }, [products, inventory]);
  return { products: stocked, customers, taxRates };
}

export default function PosPage() {
  const { user, business, activeLocationId, activeLocation, can } = useAuth();
  const { ready, bootstrapping, online, syncing, pendingCount, submitSale, syncNow, bootstrap } = useSync();
  const { toast } = useToast();
  const { products, customers, taxRates } = useCatalogue(activeLocationId);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountType, setDiscountType] = useState<'PERCENT' | 'AMOUNT'>('PERCENT');
  const [discountValue, setDiscountValue] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [notes, setNotes] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [paymentReference, setPaymentReference] = useState('');
  const [splitMode, setSplitMode] = useState(false);
  const [splitPayments, setSplitPayments] = useState<Array<{ method: PaymentMethod; amount: string; reference: string }>>([]);
  const [tendered, setTendered] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receiptSale, setReceiptSale] = useState<LocalSale | null>(null);
  const [receiptServer, setReceiptServer] = useState<Sale | null>(null);
  const [receiptFetching, setReceiptFetching] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [customerModal, setCustomerModal] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });
  const [customerSaving, setCustomerSaving] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [held, setHeld] = useState<HeldCart[]>([]);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HELD_KEY);
      if (raw) setHeld(JSON.parse(raw) as HeldCart[]);
    } catch {
      setHeld([]);
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const recent = useLiveQuery(
    async () => {
      if (typeof window === 'undefined') return [];
      const rows = await getDb().localSales.orderBy('createdAt').reverse().limit(12).toArray();
      return rows.filter((row) => row.locationId === activeLocationId);
    },
    [activeLocationId, receiptSale],
    [] as LocalSale[],
  );

  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const taxMap = useMemo(() => new Map(taxRates.map((rate) => [rate.id, rate])), [taxRates]);
  const customerMap = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);

  const priceableProducts = useMemo(() => {
    const map = new Map<string, PriceableProduct>();
    for (const product of products) {
      const rate = product.taxRateId ? taxMap.get(product.taxRateId) : null;
      map.set(product.id, {
        id: product.id,
        name: product.name,
        sku: product.sku,
        sellingPrice: product.sellingPrice,
        costPrice: product.costPrice,
        taxRate: rate?.rate ?? product.taxRate,
        taxInclusive: rate?.isInclusive ?? product.taxInclusive,
        stock: product.stock,
      });
    }
    return map;
  }, [products, taxMap]);

  const discount = useMemo(
    () =>
      discountValue.trim() && Number(discountValue) > 0
        ? { type: discountType, value: discountValue.trim() }
        : null,
    [discountType, discountValue],
  );

  const priced = useMemo((): { cart: PricedCart | null; error: string | null } => {
    if (!cart.length) return { cart: null, error: null };
    try {
      return {
        cart: priceCart(
          cart.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineDiscount: null,
          })),
          priceableProducts,
          {
            cartDiscount: discount,
            taxEnabled: business?.taxEnabled ?? false,
            allowNegativeStock: business?.allowNegativeStock ?? false,
          },
        ),
        error: null,
      };
    } catch (pricingError) {
      return {
        cart: null,
        error: pricingError instanceof PricingError ? pricingError.message : 'This cart cannot be priced.',
      };
    }
  }, [cart, priceableProducts, discount, business]);

  const total = priced.cart?.total ?? '0.00';
  const itemCount = priced.cart?.itemCount ?? cart.length;
  const discountLimit = business && user ? discountLimitForRole(user.role, business) : null;
  const discountPercentUsed = priced.cart ? Number(discountPercent(priced.cart.subtotal, priced.cart.discountTotal)) : 0;
  const discountBlocked = discountLimit !== null && discountPercentUsed > discountLimit + 1e-9;

  const splitTotal = splitPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const paid = splitMode ? splitTotal : Number(total);
  const remaining = Number(total) - paid;
  const tenderNumber = tendered.trim() === '' ? Number(total) : Number(tendered);
  const change = !splitMode && paymentMethod === 'CASH' ? Math.max(0, tenderNumber - Number(total)) : 0;
  const tenderShort = !splitMode && paymentMethod === 'CASH' && tenderNumber < Number(total) - 0.004;
  const canCharge =
    Boolean(priced.cart) &&
    cart.length > 0 &&
    !discountBlocked &&
    !submitting &&
    (!splitMode || (Math.abs(remaining) < 0.005 && splitPayments.some((payment) => Number(payment.amount) > 0))) &&
    !tenderShort;

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products) {
      if (product.categoryId) map.set(product.categoryId, product.categoryName ?? 'Uncategorised');
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [products]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((product) => (categoryId === 'all' ? true : product.categoryId === categoryId))
      .filter((product) =>
        term
          ? product.name.toLowerCase().includes(term) ||
            product.sku.toLowerCase().includes(term) ||
            (product.barcode ?? '').toLowerCase().includes(term)
          : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, categoryId, search]);

  const addProduct = useCallback(
    (product: CachedProduct) => {
      if (Number(product.stock) <= 0 && !business?.allowNegativeStock) {
        toast(`${product.name} is out of stock at ${activeLocation?.name ?? 'this branch'}.`, 'error');
        return;
      }
      setCart((current) => {
        const existing = current.find((line) => line.productId === product.id);
        if (existing) {
          return current.map((line) =>
            line.productId === product.id
              ? { ...line, quantity: (Number(line.quantity) + 1).toFixed(3).replace(/\.?0+$/, '') }
              : line,
          );
        }
        return [...current, { productId: product.id, quantity: '1', unitPrice: product.sellingPrice }];
      });
      setError(null);
    },
    [business?.allowNegativeStock, activeLocation?.name, toast],
  );

  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const term = search.trim().toLowerCase();
    if (!term) return;
    const exact = products.find(
      (product) => product.barcode?.toLowerCase() === term || product.sku.toLowerCase() === term,
    );
    const target = exact ?? (filtered.length === 1 ? filtered[0] : null);
    if (target) {
      addProduct(target);
      setSearch('');
    } else if (!filtered.length) {
      toast('No product matches that code.', 'error');
    }
  };

  const setQuantity = (productId: string, value: string) => {
    if (!/^\d{0,7}(\.\d{0,3})?$/.test(value)) return;
    setCart((current) =>
      current.map((line) => (line.productId === productId ? { ...line, quantity: value } : line)),
    );
  };

  const bumpQuantity = (productId: string, delta: number) => {
    setCart((current) => {
      const line = current.find((row) => row.productId === productId);
      if (!line) return current;
      const next = Math.max(0, Number(line.quantity) + delta);
      if (next === 0) return current.filter((row) => row.productId !== productId);
      return current.map((row) =>
        row.productId === productId
          ? { ...row, quantity: Number.isInteger(next) ? String(next) : next.toFixed(3) }
          : row,
      );
    });
  };

  const changePrice = (productId: string, value: string) => {
    if (!/^\d{0,10}(\.\d{0,2})?$/.test(value)) return;
    setCart((current) =>
      current.map((line) => (line.productId === productId ? { ...line, unitPrice: value } : line)),
    );
  };

  const resetSale = useCallback(() => {
    setCart([]);
    setDiscountValue('');
    setCustomerId('');
    setNotes('');
    setNotesOpen(false);
    setPaymentMethod('CASH');
    setPaymentReference('');
    setSplitMode(false);
    setSplitPayments([]);
    setTendered('');
    setError(null);
  }, []);

  const charge = async () => {
    if (!priced.cart || !activeLocationId) return;
    if (discountBlocked) {
      setError(`This ${discountPercentUsed.toFixed(1)}% discount exceeds your ${discountLimit}% limit. A manager must authorise it.`);
      return;
    }
    if (splitMode && Math.abs(remaining) >= 0.005) {
      setError(`Payments must equal the sale total. ${remaining > 0 ? 'Remaining' : 'Over by'} ${formatMoney(Math.abs(remaining), business?.currency)}.`);
      return;
    }
    if (tenderShort) {
      setError(`The cash tendered is short by ${formatMoney(Number(total) - tenderNumber, business?.currency)}.`);
      return;
    }
    const payments = splitMode
      ? splitPayments
          .filter((payment) => Number(payment.amount) > 0)
          .map((payment) => ({
            method: payment.method,
            amount: Number(payment.amount).toFixed(2),
            reference: payment.reference.trim() || null,
          }))
      : [
          {
            method: paymentMethod,
            amount: total,
            reference: paymentReference.trim() || null,
          },
        ];
    setSubmitting(true);
    setError(null);
    try {
      const sale = await submitSale({
        locationId: activeLocationId,
        customerId: customerId || null,
        customerName: customerId ? customerMap.get(customerId)?.name ?? null : null,
        lines: cart.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
        cartDiscount: discount,
        payments,
        notes: notes.trim() || null,
      });
      setReceiptSale(sale);
      setReceiptServer(null);
      resetSale();
      setCartOpen(false);
      if (sale.status === 'SYNCED') {
        toast(`Sale ${sale.saleNumber} recorded.`);
      } else if (sale.status === 'PENDING') {
        toast('Saved on this device. It will sync when the connection returns.', 'info');
      } else if (sale.status === 'CONFLICT') {
        toast('Stock conflict: the sale is held for a manager to resolve.', 'error');
      } else {
        toast(sale.error ?? 'The server rejected this sale.', 'error');
      }
    } catch (chargeError) {
      setError(errorMessage(chargeError));
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!receiptSale?.saleId) {
      setReceiptServer(null);
      return;
    }
    setReceiptFetching(true);
    api
      .get<Sale>(`/sales/${receiptSale.saleId}`)
      .then((sale) => {
        if (!cancelled) setReceiptServer(sale);
      })
      .catch(() => {
        if (!cancelled) setReceiptServer(null);
      })
      .finally(() => {
        if (!cancelled) setReceiptFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [receiptSale]);

  const receiptData = useMemo((): ReceiptData | null => {
    if (!receiptSale || !business) return null;
    if (receiptServer) {
      const taxRatesInSale = [...new Set(receiptServer.items?.map((item) => item.taxRate).filter((rate) => Number(rate) > 0) ?? [])];
      return {
        businessName: business.name,
        address: business.address,
        phone: business.phone,
        footer: business.receiptFooter,
        currency: business.currency,
        reference: receiptServer.saleNumber,
        branchName: receiptServer.locationName,
        cashierName: receiptServer.cashierName,
        customerName: receiptServer.customerName,
        createdAt: receiptServer.createdAt,
        items:
          receiptServer.items?.map((item) => ({
            name: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
          })) ?? [],
        subtotal: receiptServer.subtotal,
        discountTotal: receiptServer.discountTotal,
        taxTotal: receiptServer.taxTotal,
        total: receiptServer.total,
        payments:
          receiptServer.payments?.map((payment) => ({
            method: payment.method,
            amount: payment.amount,
            reference: payment.reference,
          })) ?? [],
        taxLabel: taxRatesInSale.length ? `VAT ${taxRatesInSale.join('/')}%` : 'Tax',
      };
    }
    return receiptFromPricedCart({
      businessName: business.name,
      address: business.address,
      phone: business.phone,
      footer: business.receiptFooter,
      currency: business.currency,
      reference: receiptSale.saleNumber,
      branchName: activeLocation?.name ?? '',
      cashierName: user?.name ?? null,
      customerName: receiptSale.customerName,
      createdAt: receiptSale.createdAt,
      cart: receiptSale.receipt,
      payments: receiptSale.payments?.length
        ? receiptSale.payments
        : [{ method: receiptSale.paymentMethod, amount: receiptSale.total }],
      pendingNote:
        receiptSale.status === 'SYNCED'
          ? receiptFetching
            ? 'Confirming with server…'
            : null
          : receiptSale.status === 'PENDING'
            ? 'Offline sale — awaiting sync'
            : receiptSale.status === 'CONFLICT'
              ? 'Held — stock conflict'
              : 'Rejected — contact a manager',
    });
  }, [receiptSale, receiptServer, business, activeLocation, user, receiptFetching]);

  const saveHeld = () => {
    if (!cart.length) {
      toast('There is no sale to hold.', 'error');
      return;
    }
    const snapshot: HeldCart = {
      id: `held-${Date.now()}`,
      label: `Held ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${cart.length} item${cart.length === 1 ? '' : 's'}`,
      createdAt: new Date().toISOString(),
      lines: cart,
      customerId,
      notes,
      discountType,
      discountValue,
    };
    const next = [snapshot, ...held].slice(0, 20);
    setHeld(next);
    localStorage.setItem(HELD_KEY, JSON.stringify(next));
    resetSale();
    toast('Sale held on this device.');
  };

  const resumeHeld = (snapshot: HeldCart) => {
    setCart(snapshot.lines);
    setCustomerId(snapshot.customerId);
    setNotes(snapshot.notes);
    setDiscountType(snapshot.discountType);
    setDiscountValue(snapshot.discountValue);
    const next = held.filter((item) => item.id !== snapshot.id);
    setHeld(next);
    localStorage.setItem(HELD_KEY, JSON.stringify(next));
    setHeldOpen(false);
    toast('Held sale restored.');
  };

  const removeHeld = (id: string) => {
    const next = held.filter((item) => item.id !== id);
    setHeld(next);
    localStorage.setItem(HELD_KEY, JSON.stringify(next));
  };

  const saveCustomer = async () => {
    if (!newCustomer.name.trim()) {
      toast('Customer name is required.', 'error');
      return;
    }
    setCustomerSaving(true);
    try {
      const customer = await api.post<Customer>('/customers', {
        name: newCustomer.name.trim(),
        phone: newCustomer.phone.trim() || null,
      });
      const db = getDb();
      await db.customers.put({ ...customer, localUpdatedAt: new Date().toISOString() });
      setCustomerId(customer.id);
      setCustomerModal(false);
      setNewCustomer({ name: '', phone: '' });
      toast(`${customer.name} added.`);
    } catch (customerError) {
      toast(errorMessage(customerError), 'error');
    } finally {
      setCustomerSaving(false);
    }
  };

  const renderCart = () => (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-100 bg-white px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-ink-950">Current sale</p>
          <p className="text-[11px] text-ink-500">
            {itemCount ? `${itemCount} line${itemCount === 1 ? '' : 's'}` : 'Empty cart'} · {activeLocation?.name}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={saveHeld}
            disabled={!cart.length}
            title="Hold this sale on the device"
          >
            <PauseCircle className="h-3.5 w-3.5" /> Hold
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setHeldOpen(true)}
          >
            Held{held.length ? ` (${held.length})` : ''}
          </button>
          <button
            type="button"
            className="btn-ghost p-1.5 lg:hidden"
            onClick={() => setCartOpen(false)}
            aria-label="Close cart"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto bg-ink-50/40">
        {cart.length === 0 ? (
          <div className="grid h-full place-items-center px-6 py-10 text-center">
            <div>
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-ink-100 text-ink-400">
                <ShoppingCart className="h-5 w-5" />
              </span>
              <p className="mt-3 text-sm font-semibold text-ink-700">Ready for the next customer</p>
              <p className="mt-1 text-xs text-ink-500">Tap a product, or scan a barcode.</p>
              <button type="button" className="btn-secondary btn-sm mt-4" onClick={() => searchRef.current?.focus()}>
                <Barcode className="h-3.5 w-3.5" /> Scan or search (F2)
              </button>
            </div>
            {recent.length ? (
              <div className="mt-6 w-full border-t border-ink-200 pt-4 text-left">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Earlier at this till</p>
                <div className="mt-2 space-y-1">
                  {recent.slice(0, 3).map((sale) => (
                    <button
                      key={sale.clientId}
                      type="button"
                      onClick={() => setReceiptSale(sale)}
                      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-white"
                    >
                      <span className="flex items-center gap-2">
                        <StatusBadge status={sale.status} />
                        <span className="font-mono text-[10px] text-ink-500">{sale.saleNumber}</span>
                      </span>
                      <span className="font-mono text-[10px] text-ink-700">{formatMoney(sale.total, business?.currency)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="divide-y divide-ink-100">
            {cart.map((line) => {
              const product = productMap.get(line.productId);
              if (!product) return null;
              const pricedLine = priced.cart?.lines.find((row) => row.productId === line.productId);
              return (
                <div key={line.productId} className="bg-white px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{product.name}</p>
                      <p className="text-[10px] text-ink-400">
                        {product.sku} · {formatMoney(line.unitPrice || product.sellingPrice, business?.currency)} each
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => setCart((current) => current.filter((row) => row.productId !== line.productId))}
                      aria-label={`Remove ${product.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center rounded-lg border border-ink-200">
                      <button
                        type="button"
                        className="p-1.5 text-ink-600 hover:bg-ink-50"
                        onClick={() => bumpQuantity(line.productId, -1)}
                        aria-label={`Reduce ${product.name}`}
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <input
                        className="w-12 border-x border-ink-200 py-1 text-center font-mono text-xs focus:outline-none"
                        value={line.quantity}
                        onChange={(event) => setQuantity(line.productId, event.target.value)}
                        aria-label={`Quantity for ${product.name}`}
                        inputMode="decimal"
                      />
                      <button
                        type="button"
                        className="p-1.5 text-ink-600 hover:bg-ink-50"
                        onClick={() => bumpQuantity(line.productId, 1)}
                        aria-label={`Increase ${product.name}`}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {can('sales:price-override') ? (
                        <input
                          className="w-20 rounded border border-ink-200 px-1.5 py-1 text-right font-mono text-[11px] focus:border-brand-500 focus:outline-none"
                          value={line.unitPrice}
                          onChange={(event) => changePrice(line.productId, event.target.value)}
                          aria-label={`Unit price for ${product.name}`}
                          inputMode="decimal"
                        />
                      ) : null}
                      <span className="min-w-[70px] text-right font-mono text-xs font-semibold text-ink-900">
                        {pricedLine ? formatMoney(pricedLine.lineTotal, business?.currency) : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-ink-200 bg-white px-4 py-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <select
              className="select !py-1.5 text-xs"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              aria-label="Customer"
            >
              <option value="">Walk-in customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                  {customer.phone ? ` · ${customer.phone}` : ''}
                </option>
              ))}
            </select>
            {can('customers:write') ? (
              <button
                type="button"
                className="btn-secondary btn-sm shrink-0"
                onClick={() => setCustomerModal(true)}
                aria-label="Add customer"
              >
                <UserPlus className="h-3.5 w-3.5" /> New
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-1">
              <select
                className="select !w-[82px] !py-1.5 text-xs"
                value={discountType}
                onChange={(event) => setDiscountType(event.target.value as 'PERCENT' | 'AMOUNT')}
                aria-label="Discount type"
              >
                <option value="PERCENT">% off</option>
                <option value="AMOUNT">{business?.currency ?? 'UGX'} off</option>
              </select>
              <input
                className="input !py-1.5 text-xs"
                placeholder="0"
                value={discountValue}
                onChange={(event) => setDiscountValue(event.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                aria-label="Discount value"
              />
            </div>
            <button
              type="button"
              className={cn('btn-ghost btn-sm', notesOpen && 'bg-ink-100')}
              onClick={() => setNotesOpen((open) => !open)}
            >
              Notes
            </button>
          </div>
          {discountBlocked ? (
            <p className="rounded bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800">
              {discountPercentUsed.toFixed(1)}% discount exceeds your {discountLimit}% limit. A manager must authorise this sale.
            </p>
          ) : null}
          {notesOpen ? (
            <textarea
              className="input min-h-[56px] resize-none text-xs"
              placeholder="Notes for this sale (visible on the receipt)"
              value={notes}
              maxLength={1000}
              onChange={(event) => setNotes(event.target.value)}
            />
          ) : null}
        </div>

        <div className="mt-3 rounded-lg bg-ink-50 px-3 py-2.5">
          <div className="flex items-center justify-between text-xs text-ink-500">
            <span>Subtotal</span>
            <span className="font-mono">{formatMoney(priced.cart?.subtotal ?? 0, business?.currency)}</span>
          </div>
          {Number(priced.cart?.discountTotal ?? 0) > 0 ? (
            <div className="mt-0.5 flex items-center justify-between text-xs text-brand-700">
              <span>Discount</span>
              <span className="font-mono">−{formatMoney(priced.cart?.discountTotal ?? 0, business?.currency)}</span>
            </div>
          ) : null}
          {Number(priced.cart?.taxTotal ?? 0) > 0 ? (
            <div className="mt-0.5 flex items-center justify-between text-xs text-ink-500">
              <span>Tax</span>
              <span className="font-mono">{formatMoney(priced.cart?.taxTotal ?? 0, business?.currency)}</span>
            </div>
          ) : null}
          <div className="mt-1.5 flex items-end justify-between border-t border-ink-200 pt-1.5">
            <span className="text-xs font-semibold text-ink-700">Total</span>
            <span className="font-mono text-lg font-bold text-ink-950">{formatMoney(total, business?.currency)}</span>
          </div>
        </div>

        {!splitMode ? (
          <div className="mt-2.5 space-y-2">
            <div className="flex gap-1">
              {PAYMENT_METHODS.filter((method) => method !== 'OTHER').map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPaymentMethod(method)}
                  className={cn(
                    'flex-1 rounded-lg border px-1 py-1.5 text-[10px] font-semibold transition-colors',
                    paymentMethod === method
                      ? 'border-brand-600 bg-brand-50 text-brand-800'
                      : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50',
                  )}
                >
                  {PAYMENT_METHOD_LABELS[method]}
                </button>
              ))}
            </div>
            {paymentMethod === 'CASH' ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Wallet className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
                    <input
                      className="input !py-1.5 pl-8 font-mono text-xs"
                      placeholder={`Tendered (${formatMoney(total, business?.currency)})`}
                      value={tendered}
                      onChange={(event) => setTendered(event.target.value.replace(/[^0-9.]/g, ''))}
                      inputMode="decimal"
                      aria-label="Cash tendered"
                    />
                  </div>
                  <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setTendered(total)}>
                    Exact
                  </button>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className={tenderShort ? 'font-semibold text-red-600' : 'text-ink-500'}>
                    {tenderShort
                      ? `Short ${formatMoney(Number(total) - tenderNumber, business?.currency)}`
                      : 'Change due'}
                  </span>
                  <span className={cn('font-mono font-semibold', tenderShort ? 'text-red-600' : 'text-brand-700')}>
                    {tenderShort ? '—' : formatMoney(change, business?.currency)}
                  </span>
                </div>
              </div>
            ) : (
              <input
                className="input !py-1.5 text-xs"
                placeholder="Reference / transaction ID (optional)"
                value={paymentReference}
                maxLength={120}
                onChange={(event) => setPaymentReference(event.target.value)}
              />
            )}
            {Number(total) > 0 ? (
              <button
                type="button"
                className="text-[10px] font-semibold text-brand-700 hover:text-brand-800"
                onClick={() => {
                  setSplitMode(true);
                  setSplitPayments([
                    { method: paymentMethod, amount: total, reference: '' },
                    { method: paymentMethod === 'CASH' ? 'MOBILE_MONEY' : 'CASH', amount: '0.00', reference: '' },
                  ]);
                }}
              >
                + Split payment across methods
              </button>
            ) : null}
          </div>
        ) : (
          <div className="mt-2.5 space-y-1.5">
            {splitPayments.map((payment, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <select
                  className="select !w-[104px] !py-1.5 text-[11px]"
                  value={payment.method}
                  onChange={(event) =>
                    setSplitPayments((rows) =>
                      rows.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, method: event.target.value as PaymentMethod } : row,
                      ),
                    )
                  }
                  aria-label={`Payment ${index + 1} method`}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {PAYMENT_METHOD_LABELS[method]}
                    </option>
                  ))}
                </select>
                <input
                  className="input !py-1.5 font-mono text-xs"
                  value={payment.amount}
                  onChange={(event) =>
                    setSplitPayments((rows) =>
                      rows.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, amount: event.target.value.replace(/[^0-9.]/g, '') } : row,
                      ),
                    )
                  }
                  inputMode="decimal"
                  aria-label={`Payment ${index + 1} amount`}
                />
                {splitPayments.length > 1 ? (
                  <button
                    type="button"
                    className="rounded p-1 text-ink-400 hover:text-red-600"
                    onClick={() => setSplitPayments((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}
                    aria-label={`Remove payment ${index + 1}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
            <div className="flex items-center justify-between text-[11px]">
              <button
                type="button"
                className="font-semibold text-brand-700"
                onClick={() =>
                  setSplitPayments((rows) => [
                    ...rows,
                    { method: 'CASH', amount: Math.max(0, remaining).toFixed(2), reference: '' },
                  ])
                }
              >
                + Add method
              </button>
              <span className={Math.abs(remaining) < 0.005 ? 'font-semibold text-brand-700' : 'font-semibold text-red-600'}>
                {Math.abs(remaining) < 0.005
                  ? 'Fully paid'
                  : remaining > 0
                    ? `Remaining ${formatMoney(remaining, business?.currency)}`
                    : `Over by ${formatMoney(Math.abs(remaining), business?.currency)}`}
              </span>
            </div>
            <button type="button" className="text-[10px] text-ink-500 underline" onClick={() => setSplitMode(false)}>
              Use a single payment method
            </button>
          </div>
        )}

        {priced.error ? (
          <p className="mt-2 rounded bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-700">{priced.error}</p>
        ) : null}
        {error ? (
          <p className="mt-2 rounded bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          className="btn-primary mt-2.5 w-full py-2.5"
          onClick={charge}
          disabled={!canCharge}
        >
          {submitting ? <Spinner /> : <CreditCard className="h-4 w-4" />}
          {submitting ? 'Recording sale…' : `Charge ${formatMoney(total, business?.currency)}`}
        </button>
        <p className="mt-1.5 flex items-center justify-center gap-1 text-[10px] text-ink-400">
          <span className={cn('h-1.5 w-1.5 rounded-full', online ? 'bg-brand-500' : 'bg-accent-500')} />
          {online ? (syncing ? 'Contacting server…' : 'Online — server confirms each sale') : 'Offline — sale will be saved on this device'}
        </p>
      </div>
    </div>
  );

  return (
    <div>
      <div className="no-print">
        <PageHeader
          eyebrow={activeLocation?.name}
          title="Point of sale"
          description="Server-authoritative prices and stock. Works offline from the device catalogue."
          actions={
            <>
              {pendingCount > 0 ? (
                <button type="button" className="btn-secondary btn-sm" onClick={() => void syncNow()}>
                  <RefreshCw className="h-3.5 w-3.5" /> Sync {pendingCount} queued
                </button>
              ) : null}
              {held.length ? (
                <button type="button" className="btn-secondary btn-sm" onClick={() => setHeldOpen(true)}>
                  <PauseCircle className="h-3.5 w-3.5" /> Held sales ({held.length})
                </button>
              ) : null}
            </>
          }
        />
      </div>

      {!ready && products.length === 0 ? (
        <div className="card mx-auto max-w-lg p-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-700">
            {bootstrapping ? <Spinner className="h-5 w-5" /> : <ShoppingCart className="h-5 w-5" />}
          </span>
          <h2 className="mt-3 text-lg font-semibold text-ink-950">
            {bootstrapping ? 'Preparing the offline catalogue…' : 'No catalogue on this device yet'}
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            {bootstrapping
              ? 'Products, prices and stock are being stored locally so the till can keep working without a connection.'
              : 'Connect to the internet once to download your products and stock to this device.'}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" className="btn-primary" onClick={() => void bootstrap()} disabled={bootstrapping}>
              {bootstrapping ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Retry download
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-4">
          <section className="min-w-0 flex-1">
            <div className="card mb-3 p-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  ref={searchRef}
                  className="input !py-2.5 pl-9 pr-20"
                  placeholder="Search products, SKU or scan a barcode…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={onSearchKey}
                  aria-label="Search catalogue"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-1 sm:flex">
                  <Barcode className="h-3.5 w-3.5 text-ink-400" />
                  <span className="kbd">F2</span>
                </span>
              </div>
              <div className="scroll-thin mt-2 flex gap-1 overflow-x-auto pb-0.5">
                <button
                  type="button"
                  onClick={() => setCategoryId('all')}
                  className={cn(
                    'whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-semibold',
                    categoryId === 'all' ? 'bg-brand-700 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200',
                  )}
                >
                  All products
                </button>
                {categories.map(([id, name]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setCategoryId(id)}
                    className={cn(
                      'whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-semibold',
                      categoryId === id ? 'bg-brand-700 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200',
                    )}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="card p-10 text-center">
                <p className="text-sm font-semibold text-ink-700">No products match “{search}”</p>
                <p className="mt-1 text-xs text-ink-500">Try another name or clear the category filter.</p>
                <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => { setSearch(''); setCategoryId('all'); }}>
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 pb-20 sm:grid-cols-3 xl:grid-cols-4 lg:pb-0">
                {filtered.map((product) => {
                  const stock = Number(product.stock);
                  const out = stock <= 0 && !business?.allowNegativeStock;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addProduct(product)}
                      className={cn(
                        'group flex flex-col rounded-xl border bg-white p-3 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-pop focus-visible:-translate-y-0.5',
                        out ? 'border-ink-200 opacity-70' : 'border-ink-200',
                      )}
                      aria-label={`Add ${product.name}, ${formatMoney(product.sellingPrice, business?.currency)}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 min-h-[34px] text-[12px] font-semibold leading-tight text-ink-900">
                          {product.name}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold',
                            out
                              ? 'bg-red-50 text-red-700'
                              : stock <= Number(product.reorderLevel)
                                ? 'bg-accent-50 text-accent-800'
                                : 'bg-brand-50 text-brand-700',
                          )}
                        >
                          {out ? 'Out' : `${formatQuantity(stock)} ${product.unit}`}
                        </span>
                      </div>
                      <div className="mt-2 flex items-end justify-between">
                        <span className="font-mono text-sm font-semibold text-ink-950">
                          {formatMoney(product.sellingPrice, business?.currency)}
                        </span>
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-ink-100 text-ink-500 transition-colors group-hover:bg-brand-600 group-hover:text-white">
                          <Plus className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="hidden w-[380px] shrink-0 lg:block">
            <div className="sticky top-[72px] h-[calc(100vh-88px)] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
              {renderCart()}
            </div>
          </aside>
        </div>
      )}

      {cart.length > 0 ? (
        <div className="fixed inset-x-0 bottom-[57px] z-20 border-t border-ink-200 bg-white px-4 py-2.5 shadow-[0_-4px_12px_rgba(16,24,40,0.08)] lg:hidden">
          <button type="button" className="btn-primary w-full justify-between py-2.5" onClick={() => setCartOpen(true)}>
            <span className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" /> {cart.length} item{cart.length === 1 ? '' : 's'}
            </span>
            <span className="font-mono">{formatMoney(total, business?.currency)}</span>
          </button>
        </div>
      ) : null}

      {cartOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/40" onClick={() => setCartOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-pop">
            {renderCart()}
          </div>
        </div>
      ) : null}

      <Modal
        open={Boolean(receiptSale)}
        onClose={() => setReceiptSale(null)}
        title={
          !receiptSale
            ? 'Receipt'
            : receiptSale.status === 'SYNCED'
              ? `Sale recorded · ${receiptSale.saleNumber}`
              : receiptSale.status === 'PENDING'
                ? 'Saved on this device'
                : receiptSale.status === 'CONFLICT'
                  ? 'Sale held — stock conflict'
                  : 'Sale rejected by the server'
        }
        description={
          receiptSale?.status === 'PENDING'
            ? 'This sale is queued in the offline outbox. It will be sent to the server automatically and get a permanent sale number.'
            : receiptSale?.status === 'CONFLICT'
              ? 'The sale was not applied because stock changed on another device. A manager must resolve it in the sync centre.'
              : receiptSale?.status === 'FAILED'
                ? receiptSale.error ?? 'The server rejected this sale.'
                : undefined
        }
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReceiptSale(null)}>
              Close
            </button>
            {receiptSale?.saleId ? (
              <a href={`/sales/${receiptSale.saleId}`} className="btn-secondary">
                Open sale
              </a>
            ) : null}
            <button type="button" className="btn-primary" onClick={printReceipt} disabled={!receiptData}>
              <Printer className="h-4 w-4" /> Print receipt
            </button>
          </>
        }
      >
        {receiptSale?.status === 'PENDING' ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-xs text-accent-900">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Keep this receipt. The permanent sale number appears in the sync centre once sent.</p>
          </div>
        ) : null}
        {receiptSale?.status === 'CONFLICT' ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {receiptSale.error} — resolve in <a href="/sync" className="font-semibold underline">sync centre</a>.
          </div>
        ) : null}
        {receiptData ? (
          <ReceiptView data={receiptData} />
        ) : (
          <div className="grid place-items-center py-10">
            <Spinner />
          </div>
        )}
        {receiptFetching ? <p className="mt-2 text-center text-[10px] text-ink-400">Fetching the server receipt…</p> : null}
      </Modal>

      <div className="receipt-print hidden">
        {receiptData ? <ReceiptView data={receiptData} /> : null}
      </div>

      <Modal
        open={customerModal}
        onClose={() => setCustomerModal(false)}
        title="Add a customer"
        description="Customers are shared across branches and their purchase history is calculated from real sales."
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCustomerModal(false)} disabled={customerSaving}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={saveCustomer} disabled={customerSaving}>
              {customerSaving ? <Spinner /> : <UserPlus className="h-4 w-4" />} Save customer
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="customer-name">Full name *</label>
            <input
              id="customer-name"
              className="input"
              value={newCustomer.name}
              onChange={(event) => setNewCustomer((current) => ({ ...current, name: event.target.value }))}
              placeholder="e.g. Aisha Nakato"
            />
          </div>
          <div>
            <label className="label" htmlFor="customer-phone">Phone</label>
            <input
              id="customer-phone"
              className="input"
              value={newCustomer.phone}
              onChange={(event) => setNewCustomer((current) => ({ ...current, phone: event.target.value }))}
              placeholder="+256 7xx xxx xxx"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={heldOpen}
        onClose={() => setHeldOpen(false)}
        title="Held sales"
        description="Held carts are stored only on this device and are not sent to the server."
        footer={<button type="button" className="btn-secondary" onClick={() => setHeldOpen(false)}>Close</button>}
      >
        {held.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">No sales are on hold.</p>
        ) : (
          <div className="space-y-2">
            {held.map((snapshot) => (
              <div key={snapshot.id} className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-ink-900">{snapshot.label}</p>
                  <p className="text-[10px] text-ink-500">
                    {formatTime(snapshot.createdAt)}
                    {snapshot.customerId ? ` · ${customerMap.get(snapshot.customerId)?.name ?? 'customer'}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" className="btn-primary btn-sm" onClick={() => resumeHeld(snapshot)}>
                    Resume
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-red-600"
                    onClick={() => removeHeld(snapshot.id)}
                    aria-label={`Delete ${snapshot.label}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
