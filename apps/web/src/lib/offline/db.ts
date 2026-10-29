import Dexie, { type Table } from 'dexie';
import type {
  Customer,
  LocalOutboxStatus,
  TaxRate,
  Product,
  Location,
  OfflineSalePayload,
  PricedCart,
} from '@kampalasmart/shared';

export interface CachedProduct extends Omit<Product, 'stock'> {
  stock: string;
}

export interface CachedInventory {
  key: string;
  locationId: string;
  productId: string;
  quantity: string;
}

export interface CachedCustomer extends Customer {
  localUpdatedAt: string;
}

export interface LocalSale {
  clientId: string;
  saleId: string | null;
  saleNumber: string;
  locationId: string;
  customerName: string | null;
  total: string;
  paymentMethod: string;
  payments: Array<{ method: string; amount: string; reference?: string | null }>;
  status: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'FAILED';
  createdAt: string;
  receipt: PricedCart;
  error: string | null;
}

export interface OutboxEvent {
  clientId: string;
  type: 'SALE';
  status: LocalOutboxStatus;
  payload: OfflineSalePayload;
  receipt: PricedCart;
  cashierId: string;
  createdAt: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  deviceKey: string;
}

export interface LocalConflict {
  id: string;
  clientId: string;
  reason: string;
  details: unknown;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface MetaRow {
  key: string;
  value: string;
}

export interface SnapshotLocation {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
}

export class KampalaSmartDB extends Dexie {
  products!: Table<CachedProduct, string>;
  categories!: Table<{ id: string; name: string }, string>;
  customers!: Table<CachedCustomer, string>;
  taxRates!: Table<TaxRate, string>;
  inventory!: Table<CachedInventory, string>;
  locations!: Table<SnapshotLocation, string>;
  outbox!: Table<OutboxEvent, string>;
  localSales!: Table<LocalSale, string>;
  conflicts!: Table<LocalConflict, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('kampalasmart');
    this.version(1).stores({
      products: 'id, name, sku, barcode, categoryId, updatedAt',
      categories: 'id, name',
      customers: 'id, name, phone, updatedAt',
      taxRates: 'id, name',
      inventory: 'key, locationId, productId, [locationId+productId]',
      locations: 'id, name',
      outbox: 'clientId, status, createdAt',
      localSales: 'clientId, saleNumber, createdAt, status',
      conflicts: 'id, clientId, status, createdAt',
      meta: 'key',
    });
  }
}

let instance: KampalaSmartDB | null = null;

export function getDb(): KampalaSmartDB {
  if (typeof window === 'undefined') {
    throw new Error('The local database is only available in the browser.');
  }
  if (!instance) instance = new KampalaSmartDB();
  return instance;
}

export function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getDeviceKey(): string {
  const key = 'ks_device_key';
  let value = localStorage.getItem(key);
  if (!value) {
    value = `web-${newClientId()}`;
    localStorage.setItem(key, value);
  }
  return value;
}

export async function getMeta(key: string): Promise<string | null> {
  const row = await getDb().meta.get(key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await getDb().meta.put({ key, value });
}

export async function clearLocalData(): Promise<void> {
  const db = getDb();
  await db.transaction(
    'rw',
    [db.products, db.categories, db.customers, db.taxRates, db.inventory, db.locations, db.localSales, db.conflicts, db.meta],
    async () => {
      await Promise.all([
        db.products.clear(),
        db.categories.clear(),
        db.customers.clear(),
        db.taxRates.clear(),
        db.inventory.clear(),
        db.locations.clear(),
        db.localSales.clear(),
        db.conflicts.clear(),
        db.meta.clear(),
      ]);
    },
  );
}

export const snapshotProduct = (product: Product, stock: string): CachedProduct => ({
  ...product,
  stock,
});

export const inventoryKey = (locationId: string, productId: string): string =>
  `${locationId}:${productId}`;

export function locationProducts(
  products: CachedProduct[],
  inventory: CachedInventory[],
  locationId: string,
): CachedProduct[] {
  const stock = new Map(
    inventory.filter((row) => row.locationId === locationId).map((row) => [row.productId, row.quantity]),
  );
  return products.map((product) => ({ ...product, stock: stock.get(product.id) ?? '0' }));
}

export function mergeBootstrapLocations(locations: Location[]): SnapshotLocation[] {
  return locations.map((location) => ({
    id: location.id,
    name: location.name,
    code: location.code,
    isDefault: location.isDefault,
  }));
}
