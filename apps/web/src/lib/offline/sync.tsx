'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  priceCart,
  type OfflineSalePayload,
  type PricedCart,
  type SyncBootstrap,
  type SyncEventResult,
  type SyncOverview,
  type SyncPushResponse,
  type SyncPullResponse,
  type TaxRate,
} from '@kampalasmart/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';import {
  getDb,
  getDeviceKey,
  getMeta,
  inventoryKey,
  mergeBootstrapLocations,
  newClientId,
  setMeta,
  type CachedInventory,
  type CachedProduct,
  type LocalSale,
  type OutboxEvent,
} from './db';

const SYNC_INTERVAL_MS = 30_000;
const PULL_INTERVAL_MS = 90_000;
const BATCH_SIZE = 40;

function isServerUnreachable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 0 ||
      error.status === 503 ||
      error.code === 'NETWORK_ERROR' ||
      error.code === 'OFFLINE')
  );
}

interface SyncContextValue {
  ready: boolean;
  bootstrapping: boolean;
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  conflictCount: number;
  lastSyncAt: string | null;
  error: string | null;
  bootstrap: () => Promise<void>;
  syncNow: () => Promise<void>;
  submitSale: (input: {
    locationId: string;
    customerId?: string | null;
    customerName?: string | null;
    lines: Array<{ productId: string; quantity: string; unitPrice?: string }>;
    cartDiscount?: { type: 'PERCENT' | 'AMOUNT'; value: string } | null;
    payments: Array<{ method: string; amount: string; reference?: string | null }>;
    notes?: string | null;
  }) => Promise<LocalSale>;
  retryEvent: (clientId: string) => Promise<void>;
  discardEvent: (clientId: string, reason: string) => Promise<void>;
  refreshConflicts: () => Promise<void>;
  serverConflicts: SyncOverview | null;
}

const SyncContext = createContext<SyncContextValue | null>(null);

async function openDb() {
  const db = getDb();
  if (!db.isOpen()) await db.open();
  return db;
}

function buildTaxMap(taxRates: TaxRate[]) {
  return new Map(taxRates.map((rate) => [rate.id, rate]));
}

function priceLocalSale(
  payload: OfflineSalePayload,
  products: CachedProduct[],
  taxRates: TaxRate[],
  taxEnabled: boolean,
): PricedCart {
  const taxMap = buildTaxMap(taxRates);
  const productMap = new Map(
    products.map((product) => {
      const rate = product.taxRateId ? taxMap.get(product.taxRateId) : null;
      return [
        product.id,
        {
          id: product.id,
          name: product.name,
          sku: product.sku,
          sellingPrice: product.sellingPrice,
          costPrice: product.costPrice,
          taxRate: product.taxRateId ? (rate?.rate ?? product.taxRate) : product.taxRate,
          taxInclusive: rate?.isInclusive ?? product.taxInclusive,
          stock: product.stock,
        },
      ];
    }),
  );
  return priceCart(
    payload.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineDiscount: item.lineDiscount ?? null,
    })),
    productMap,
    {
      cartDiscount: payload.cartDiscount ?? null,
      taxEnabled,
    },
  );
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { user, business, activeLocationId, can } = useAuth();
  const [ready, setReady] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverConflicts, setServerConflicts] = useState<SyncOverview | null>(null);
  const syncingRef = useRef(false);
  const bootstrapKeyRef = useRef<string | null>(null);

  const dbReady = typeof window !== 'undefined' && Boolean(user);

  const pendingCount =
    useLiveQuery(
      async () => {
        if (!dbReady) return 0;
        const db = await openDb();
        return db.outbox.where('status').anyOf('PENDING', 'SYNCING').count();
      },
      [dbReady],
      0,
    ) ?? 0;

  const conflictCount =
    useLiveQuery(
      async () => {
        if (!dbReady) return 0;
        const db = await openDb();
        const local = await db.outbox.where('status').equals('CONFLICT').count();
        const failed = await db.outbox.where('status').equals('FAILED').count();
        return local + failed;
      },
      [dbReady],
      0,
    ) ?? 0;

  const registerDevice = useCallback(async () => {
    const deviceKey = getDeviceKey();
    try {
      await api.post('/sync/register', {
        deviceKey,
        name:
          typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent)
            ? 'Mobile terminal'
            : 'Web terminal',
        platform: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 40) : 'web',
      });
    } catch (registerError) {
      if (!(registerError instanceof ApiError) || registerError.status !== 403) throw registerError;
    }
    return deviceKey;
  }, []);

  const bootstrapLocation = useCallback(
    async (locationId: string) => {
      if (!locationId || !can('sync:read')) return;
      setBootstrapping(true);
      try {
        await registerDevice();
        const snapshot = await api.get<SyncBootstrap>('/sync/bootstrap', { locationId });
        const db = await openDb();
        const categories = new Map<string, { id: string; name: string }>();
        const stockByProduct = new Map(snapshot.inventory.map((row) => [row.productId, row.quantity]));
        const products: CachedProduct[] = snapshot.products.map((product) => {
          if (product.categoryId && product.categoryName) {
            categories.set(product.categoryId, { id: product.categoryId, name: product.categoryName });
          }
          return {
            ...product,
            stock: stockByProduct.get(product.id) ?? product.stock ?? '0',
          } as CachedProduct;
        });
        const inventory: CachedInventory[] = snapshot.inventory.map((row) => ({
          key: inventoryKey(locationId, row.productId),
          locationId,
          productId: row.productId,
          quantity: row.quantity,
        }));
        await db.transaction(
          'rw',
          [db.products, db.categories, db.inventory, db.customers, db.taxRates, db.locations, db.meta],
          async () => {
            await Promise.all([
              db.products.clear(),
              db.categories.clear(),
              db.inventory.where('locationId').equals(locationId).delete(),
            ]);
            await db.products.bulkPut(products);
            await db.categories.bulkPut([...categories.values()]);
            await db.inventory.bulkPut(inventory);
            await db.customers.clear();
            await db.customers.bulkPut(
              snapshot.customers.map((customer) => ({
                ...customer,
                localUpdatedAt: new Date().toISOString(),
              })),
            );
            await db.taxRates.clear();
            await db.taxRates.bulkPut(snapshot.taxRates);
            await db.locations.bulkPut(mergeBootstrapLocations(snapshot.locations));
            await db.meta.put({ key: `business:${locationId}`, value: JSON.stringify(snapshot.business) });
          },
        );
        const syncedAt = snapshot.serverTime ?? new Date().toISOString();
        await setMeta('lastSyncAt', syncedAt);
        setLastSyncAt(syncedAt);
        setReady(true);
        setError(null);
        setOnline(true);
      } catch (bootstrapError) {
        if (isServerUnreachable(bootstrapError)) setOnline(false);
        if (!(bootstrapError instanceof ApiError) || bootstrapError.status !== 401) {
          setError(
            bootstrapError instanceof Error
              ? bootstrapError.message
              : 'Could not refresh the offline catalogue.',
          );
        }
        const stored = await getMeta('lastSyncAt');
        if (stored) {
          setLastSyncAt(stored);
          setReady(true);
        }
      } finally {
        setBootstrapping(false);
      }
    },
    [can, registerDevice],
  );

  const bootstrap = useCallback(async () => {
    if (!activeLocationId) return;
    await bootstrapLocation(activeLocationId);
  }, [activeLocationId, bootstrapLocation]);

  useEffect(() => {
    if (!user || !activeLocationId) return;
    const key = `${user.id}:${activeLocationId}`;
    if (bootstrapKeyRef.current === key) return;
    bootstrapKeyRef.current = key;
    void bootstrapLocation(activeLocationId);
  }, [user, activeLocationId, bootstrapLocation]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const applyResults = useCallback(
    async (
      events: OutboxEvent[],
      response: SyncPushResponse,
      locationId: string,
    ) => {
      const db = await openDb();
      const conflictIds = new Map<string, string>();
      const resultByClient = new Map<string, SyncEventResult>(
        response.results.map((result) => [result.clientId, result]),
      );

      const resultsWithConflict = response.results.filter((r) => r.status === 'CONFLICT');
      if (resultsWithConflict.length) {
        try {
          const overview = await api.get<SyncOverview>('/sync/overview');
          setServerConflicts(overview);
          for (const conflict of overview.conflicts) {
            conflictIds.set(conflict.clientId, conflict.id);
          }
        } catch {
          // Resolution ids are optional; the conflict is still shown locally.
        }
      }

      await db.transaction('rw', [db.outbox, db.localSales, db.inventory, db.conflicts], async () => {
        for (const event of events) {
          const result = resultByClient.get(event.clientId);
          if (!result) continue;
          const sale = await db.localSales.get(event.clientId);
          if (result.status === 'SYNCED') {
            await db.outbox.update(event.clientId, {
              status: 'SYNCED',
              lastError: null,
              attemptCount: event.attemptCount + 1,
              lastAttemptAt: new Date().toISOString(),
            });
            if (sale) {
              await db.localSales.update(event.clientId, {
                status: 'SYNCED',
                saleId: result.saleId ?? null,
                saleNumber: result.saleNumber ?? sale.saleNumber,
                total: result.sale?.total ?? sale.total,
                error: null,
              });
            }
          } else if (result.status === 'CONFLICT') {
            const details = {
              ...(result.error?.details ?? {}),
              message: result.error?.message ?? 'Stock conflict',
            };
            await db.outbox.update(event.clientId, {
              status: 'CONFLICT',
              attemptCount: event.attemptCount + 1,
              lastAttemptAt: new Date().toISOString(),
              lastError: result.error?.message ?? 'Stock conflict',
            });
            const serverId = conflictIds.get(event.clientId) ?? event.clientId;
            await db.conflicts.put({
              id: serverId,
              clientId: event.clientId,
              reason: result.error?.code ?? 'SYNC_CONFLICT',
              details,
              status: 'OPEN',
              createdAt: new Date().toISOString(),
              resolvedAt: null,
              resolution: null,
            });
            if (sale) {
              await db.localSales.update(event.clientId, {
                status: 'CONFLICT',
                error: result.error?.message ?? 'Stock conflict',
              });
            }
          } else {
            await db.outbox.update(event.clientId, {
              status: 'FAILED',
              attemptCount: event.attemptCount + 1,
              lastAttemptAt: new Date().toISOString(),
              lastError: result.error?.message ?? 'The server rejected this sale.',
            });
            if (sale) {
              await db.localSales.update(event.clientId, {
                status: 'FAILED',
                error: result.error?.message ?? 'The server rejected this sale.',
              });
            }
          }
        }
        if (response.inventory?.length) {
          await db.inventory.bulkPut(
            response.inventory.map((row) => ({
              key: inventoryKey(locationId, row.productId),
              locationId,
              productId: row.productId,
              quantity: row.quantity,
            })),
          );
        }
      });
    },
    [],
  );

  const syncOutbox = useCallback(async () => {
    if (syncingRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (!can('sales:create')) return;
    syncingRef.current = true;
    setSyncing(true);
    setError(null);
    try {
      const db = await openDb();
      const deviceKey = getDeviceKey();
      for (;;) {
        const batch = await db.outbox
          .where('status')
          .equals('PENDING')
          .limit(BATCH_SIZE)
          .toArray();
        // A queued sale is only sent by the cashier who captured it, so the
        // server never attributes another person's offline sale to this login.
        const pending = batch.filter((event) => !event.cashierId || event.cashierId === user?.id);
        if (!pending.length) break;
        const locationId = pending[0].payload.locationId;
        await db.outbox.bulkUpdate(
          pending.map((event) => ({ key: event.clientId, changes: { status: 'SYNCING' as const } })),
        );
        try {
          const response = await api.post<SyncPushResponse>('/sync/push', {
            deviceKey,
            events: pending.map((event) => {
              // The event id travels in the envelope; the sale payload itself
              // must match the server contract, which rejects extra fields.
              const { clientId: _clientId, ...payload } = event.payload;
              return { clientId: event.clientId, type: 'SALE' as const, payload };
            }),
          });
          await applyResults(pending, response, locationId);
          setLastSyncAt(response.serverTime);
          await setMeta('lastSyncAt', response.serverTime);
          setOnline(true);
        } catch (pushError) {
          await db.outbox.bulkUpdate(
            pending.map((event) => ({
              key: event.clientId,
              changes: {
                status: 'PENDING' as const,
                attemptCount: event.attemptCount + 1,
                lastAttemptAt: new Date().toISOString(),
                lastError:
                  pushError instanceof Error ? pushError.message : 'The sale could not be sent.',
              },
            })),
          );
          throw pushError;
        }
      }
    } catch (syncError) {
      if (isServerUnreachable(syncError)) setOnline(false);
      if (!(syncError instanceof ApiError) || syncError.status !== 401) {
        setError(syncError instanceof Error ? syncError.message : 'Sync failed.');
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [applyResults, can, user?.id]);

  const pull = useCallback(async () => {
    if (!activeLocationId || !can('sync:read')) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      const since = (await getMeta('lastSyncAt')) ?? new Date(Date.now() - 86_400_000).toISOString();
      const response = await api.get<SyncPullResponse>('/sync/pull', {
        locationId: activeLocationId,
        since,
      });
      const db = await openDb();
      await db.transaction('rw', [db.products, db.inventory, db.customers], async () => {
        if (response.products.length) {
          const existing = await db.products.bulkGet(response.products.map((p) => p.id));
          const merged = response.products.map((product, index) => ({
            ...(existing[index] ?? {}),
            ...product,
            stock: existing[index]?.stock ?? '0',
          })) as CachedProduct[];
          await db.products.bulkPut(merged);
        }
        if (response.inventory.length) {
          await db.inventory.bulkPut(
            response.inventory.map((row) => ({
              key: inventoryKey(activeLocationId, row.productId),
              locationId: activeLocationId,
              productId: row.productId,
              quantity: row.quantity,
            })),
          );
        }
        if (response.customers.length) {
          await db.customers.bulkPut(
            response.customers.map((customer) => ({
              ...customer,
              localUpdatedAt: new Date().toISOString(),
            })),
          );
        }
      });
      setLastSyncAt(response.serverTime);
      await setMeta('lastSyncAt', response.serverTime);
      setOnline(true);
    } catch (pullError) {
      if (isServerUnreachable(pullError)) setOnline(false);
      throw pullError;
    }
  }, [activeLocationId, can]);

  const refreshConflicts = useCallback(async () => {
    if (!can('sync:manage')) return;
    try {
      const overview = await api.get<SyncOverview>('/sync/overview');
      setServerConflicts(overview);
      setOnline(true);
    } catch (overviewError) {
      if (isServerUnreachable(overviewError)) setOnline(false);
      // Offline or insufficient permission; local conflicts remain visible.
    }
  }, [can]);

  const syncNow = useCallback(async () => {
    if (!user) return;
    await syncOutbox();
    try {
      await pull();
      await refreshConflicts();
    } catch {
      // The outbox result is the critical path; catalogue refresh can retry later.
    }
  }, [user, syncOutbox, pull, refreshConflicts]);

  useEffect(() => {
    if (!user || !ready) return;
    void syncNow();
    const interval = window.setInterval(() => {
      if (navigator.onLine) void syncNow();
    }, SYNC_INTERVAL_MS);
    const pullInterval = window.setInterval(() => {
      if (navigator.onLine) void pull().catch(() => undefined);
    }, PULL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void syncNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      window.clearInterval(interval);
      window.clearInterval(pullInterval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [user, ready, syncNow, pull]);

  const submitSale = useCallback<SyncContextValue['submitSale']>(
    async (input) => {
      if (!user) throw new Error('You must be signed in to sell.');
      if (!business) throw new Error('Business settings are unavailable.');
      const db = await openDb();
      const lines = input.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      }));
      const productIds = [...new Set(lines.map((line) => line.productId))];
      const products = await db.products.bulkGet(productIds);
      const inventory = await db.inventory.bulkGet(
        productIds.map((id) => inventoryKey(input.locationId, id)),
      );
      const stockMap = new Map(inventory.filter(Boolean).map((row) => [row!.productId, row!.quantity]));
      const localProducts = products
        .filter((product): product is CachedProduct => Boolean(product))
        .map((product) => ({ ...product, stock: stockMap.get(product.id) ?? '0' }));
      const taxRates = await db.taxRates.toArray();
      const payload: OfflineSalePayload = {
        clientId: newClientId(),
        locationId: input.locationId,
        customerId: input.customerId ?? null,
        occurredAt: new Date().toISOString(),
        items: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice as string,
        })),
        cartDiscount: input.cartDiscount ?? null,
        payments: input.payments.map((payment) => ({
          method: payment.method as OfflineSalePayload['payments'][number]['method'],
          amount: payment.amount,
          reference: payment.reference ?? null,
        })),
        notes: input.notes ?? null,
      };
      const receipt = priceLocalSale(payload, localProducts, taxRates, business.taxEnabled);
      const event: OutboxEvent = {
        clientId: payload.clientId,
        type: 'SALE',
        status: 'PENDING',
        payload,
        receipt,
        cashierId: user?.id ?? '',
        createdAt: payload.occurredAt,
        attemptCount: 0,
        lastAttemptAt: null,
        lastError: null,
        deviceKey: getDeviceKey(),
      };
      const sale: LocalSale = {
        clientId: payload.clientId,
        saleId: null,
        saleNumber: `LOCAL-${payload.clientId.slice(0, 8).toUpperCase()}`,
        locationId: input.locationId,
        customerName: input.customerName ?? null,
        total: receipt.total,
        paymentMethod: input.payments[0]?.method ?? 'CASH',
        payments: input.payments.map((payment) => ({
          method: payment.method,
          amount: payment.amount,
          reference: payment.reference ?? null,
        })),
        status: 'PENDING',
        createdAt: payload.occurredAt,
        receipt,
        error: null,
      };
      await db.transaction('rw', [db.outbox, db.localSales, db.inventory], async () => {
        await db.outbox.add(event);
        await db.localSales.add(sale);
        for (const item of lines) {
          const key = inventoryKey(input.locationId, item.productId);
          const row = await db.inventory.get(key);
          const current = Number(row?.quantity ?? 0);
          const next = Math.max(0, current - Number(item.quantity));
          await db.inventory.put({
            key,
            locationId: input.locationId,
            productId: item.productId,
            quantity: next.toFixed(3),
          });
        }
      });
      if (typeof navigator === 'undefined' || navigator.onLine) {
        await syncOutbox();
      }
      return (await db.localSales.get(payload.clientId)) ?? sale;
    },
    [user, business, syncOutbox],
  );

  const retryEvent = useCallback(async (clientId: string) => {
    const db = await openDb();
    await db.outbox.update(clientId, {
      status: 'PENDING',
      lastError: null,
    });
    await db.localSales.update(clientId, { status: 'PENDING', error: null });
    await db.conflicts.delete(clientId);
    await syncOutbox();
  }, [syncOutbox]);

  const discardEvent = useCallback(
    async (clientId: string, reason: string) => {
      const db = await openDb();
      const event = await db.outbox.get(clientId);
      if (!event) return;
      // Preserve the rejected transaction locally as a voided record; never
      // silently erase it from the cashier's sales history.
      await db.transaction('rw', [db.outbox, db.localSales], async () => {
        await db.localSales.update(clientId, {
          status: 'FAILED',
          error: `Voided locally: ${reason}`,
        });
        await db.outbox.delete(clientId);
      });
    },
    [],
  );

  useEffect(() => {
    if (!user) {
      setReady(false);
      setLastSyncAt(null);
      setServerConflicts(null);
      bootstrapKeyRef.current = null;
      return;
    }
    const db = getDb();
    void getMeta('lastSyncAt').then((value) => {
      if (value) setLastSyncAt(value);
    });
    void db.products.count().then((count) => {
      if (count > 0) setReady(true);
    });
  }, [user]);

  const value = useMemo<SyncContextValue>(
    () => ({
      ready,
      bootstrapping,
      online,
      syncing,
      pendingCount,
      conflictCount,
      lastSyncAt,
      error,
      bootstrap,
      syncNow,
      submitSale,
      retryEvent,
      discardEvent,
      refreshConflicts,
      serverConflicts,
    }),
    [
      ready,
      bootstrapping,
      online,
      syncing,
      pendingCount,
      conflictCount,
      lastSyncAt,
      error,
      bootstrap,
      syncNow,
      submitSale,
      retryEvent,
      discardEvent,
      refreshConflicts,
      serverConflicts,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSync must be used inside SyncProvider');
  return context;
}
