import type {
  BusinessPlan,
  MovementType,
  NotificationSeverity,
  NotificationType,
  PaymentMethod,
  PaymentStatus,
  PurchaseStatus,
  RefundStatus,
  SaleStatus,
  SubscriptionStatus,
  TransferStatus,
} from './constants';
import type { Permission, UserRole } from './roles';

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface BusinessSettings {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  locale: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  logoUrl: string | null;
  taxEnabled: boolean;
  taxInclusive: boolean;
  taxRate: string;
  allowNegativeStock: boolean;
  maxCashierDiscountPercent: string;
  maxManagerDiscountPercent: string;
  refundApprovalThreshold: string;
  defaultLeadTimeDays: number;
  receiptFooter: string | null;
  plan: BusinessPlan;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  createdAt: string;
}

export interface Location {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  isDefault: boolean;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  businessId: string;
  permissions: Permission[];
  locationIds: string[];
  emailVerified: boolean;
}

export interface AuthSession {
  user: SessionUser;
  business: BusinessSettings;
  locations: Location[];
  csrfToken: string;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  productCount?: number;
}

export interface TaxRate {
  id: string;
  name: string;
  rate: string;
  isInclusive: boolean;
  isDefault: boolean;
  isActive: boolean;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  brand: string | null;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  sellingPrice: string;
  costPrice: string;
  taxRateId: string | null;
  taxRate: string;
  taxInclusive: boolean;
  reorderLevel: string;
  safetyStock: string;
  leadTimeDays: number;
  unit: string;
  isActive: boolean;
  imageUrl: string | null;
  stock?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryRow {
  productId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  categoryName: string | null;
  unit: string;
  locationId: string;
  locationName: string;
  quantity: string;
  reorderLevel: string;
  safetyStock: string;
  value: string;
  status: 'OUT_OF_STOCK' | 'CRITICAL' | 'LOW' | 'OK';
  updatedAt: string;
}

export interface InventoryMovement {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  locationId: string;
  locationName: string;
  movementType: MovementType;
  quantity: string;
  unitCost: string;
  balanceAfter: string;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  performedBy: string | null;
  performedByName: string | null;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  totalSpent: string;
  purchaseCount: number;
  lastPurchaseAt: string | null;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  productCount: number;
  purchaseCount: number;
  totalPurchased: string;
  lastPurchaseAt: string | null;
  createdAt: string;
}

export interface SaleItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
  unitCost: string;
  refundedQuantity: string;
}

export interface Payment {
  id: string;
  method: PaymentMethod;
  amount: string;
  reference: string | null;
  status: PaymentStatus;
  provider: string;
  createdAt: string;
}

export interface Refund {
  id: string;
  refundNumber: string;
  saleId: string;
  saleNumber: string;
  reason: string;
  status: RefundStatus;
  total: string;
  requestedByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
  items?: RefundItem[];
}

export interface RefundItem {
  id: string;
  saleItemId: string;
  productName: string;
  sku: string;
  quantity: string;
  amount: string;
  restock: boolean;
}

export interface Sale {
  id: string;
  saleNumber: string;
  locationId: string;
  locationName: string;
  cashierId: string;
  cashierName: string;
  customerId: string | null;
  customerName: string | null;
  status: SaleStatus;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  costTotal: string;
  grossProfit: string;
  notes: string | null;
  isOffline: boolean;
  createdAt: string;
  items?: SaleItem[];
  payments?: Payment[];
  refunds?: Refund[];
}

export interface SaleSummary {
  id: string;
  saleNumber: string;
  locationName: string;
  cashierName: string;
  customerName: string | null;
  status: SaleStatus;
  total: string;
  paymentMethod: PaymentMethod | null;
  createdAt: string;
}

export interface PurchaseItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: string;
  receivedQuantity: string;
  unitCost: string;
  lineTotal: string;
}

export interface Purchase {
  id: string;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  locationId: string;
  locationName: string;
  status: PurchaseStatus;
  reference: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  notes: string | null;
  items: PurchaseItem[];
  createdByName: string | null;
  createdAt: string;
  receivedAt: string | null;
}

export interface TransferItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: string;
  unitCost: string;
}

export interface StockTransfer {
  id: string;
  transferNumber: string;
  fromLocationId: string;
  fromLocationName: string;
  toLocationId: string;
  toLocationName: string;
  status: TransferStatus;
  notes: string | null;
  requestedByName: string | null;
  approvedByName: string | null;
  items: TransferItem[];
  createdAt: string;
  completedAt: string | null;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole: UserRole | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface LowStockItem {
  productId: string;
  productName: string;
  sku: string;
  locationId: string;
  locationName: string;
  quantity: string;
  reorderLevel: string;
  safetyStock: string;
  averageDailySales: string;
  daysRemaining: number | null;
  status: 'OUT_OF_STOCK' | 'CRITICAL' | 'LOW' | 'OVERSTOCK' | 'SLOW_MOVING';
  recommendedOrderQuantity: string;
  leadTimeDays: number;
  pendingPurchaseQuantity: string;
  supplierName: string | null;
  explanation: string;
}

export interface DashboardData {
  today: {
    sales: string;
    transactions: number;
    profit: string;
    refunds: string;
    discounts: string;
    averageSale: string;
  };
  comparison: {
    salesChangePercent: number | null;
    profitChangePercent: number | null;
    transactionChangePercent: number | null;
  };
  trend: Array<{ date: string; sales: string; profit: string; transactions: number }>;
  topProducts: Array<{
    productId: string;
    name: string;
    quantity: string;
    revenue: string;
    profit: string;
  }>;
  paymentBreakdown: Array<{ method: PaymentMethod; amount: string; count: number }>;
  branchPerformance: Array<{
    locationId: string;
    name: string;
    sales: string;
    transactions: number;
    profit: string;
  }>;
  lowStock: LowStockItem[];
  recentSales: SaleSummary[];
  inventoryValue: string;
  pending: { refunds: number; transfers: number; syncConflicts: number };
}

export interface SalesSummaryReport {
  totals: {
    grossSales: string;
    netSales: string;
    discounts: string;
    tax: string;
    refunds: string;
    costOfGoods: string;
    grossProfit: string;
    transactions: number;
    averageSale: string;
    itemsSold: string;
  };
  series: Array<{ period: string; sales: string; profit: string; transactions: number }>;
  byPaymentMethod: Array<{ method: PaymentMethod; amount: string; count: number }>;
  byLocation: Array<{ locationId: string; name: string; sales: string; profit: string; transactions: number }>;
  byCashier: Array<{ userId: string; name: string; sales: string; profit: string; transactions: number }>;
  byCategory: Array<{ categoryId: string | null; name: string; sales: string; profit: string; quantity: string }>;
  topProducts: Array<{
    productId: string;
    name: string;
    sku: string;
    quantity: string;
    revenue: string;
    profit: string;
  }>;
  discounts: Array<{ saleNumber: string; cashierName: string; discount: string; total: string; createdAt: string }>;
}

export interface ProfitExplanation {
  currentPeriod: { from: string; to: string; revenue: string; profit: string; marginPercent: number };
  previousPeriod: { from: string; to: string; revenue: string; profit: string; marginPercent: number };
  profitChange: string;
  profitChangePercent: number | null;
  reasons: Array<{ title: string; detail: string; impact: string; direction: 'UP' | 'DOWN' | 'NEUTRAL' }>;
  largestContributor: { productId: string; name: string; profitChange: string } | null;
  suggestedAction: string;
  basedOn: string;
}

export interface AssistantAnswer {
  question: string;
  answer: string;
  metrics: Record<string, string | number>;
  suggestions: string[];
  generatedBy: 'RULES_ENGINE' | 'AI_PROVIDER';
}

export interface SyncInventoryLevel {
  productId: string;
  quantity: string;
}

export interface OfflineSalePayload {
  clientId: string;
  locationId: string;
  customerId?: string | null;
  occurredAt: string;
  items: Array<{
    productId: string;
    quantity: string;
    unitPrice: string;
    lineDiscount?: { type: 'PERCENT' | 'AMOUNT'; value: string } | null;
  }>;
  cartDiscount?: { type: 'PERCENT' | 'AMOUNT'; value: string } | null;
  payments: Array<{ method: PaymentMethod; amount: string; reference?: string | null }>;
  notes?: string | null;
}

export interface SyncPushEvent {
  clientId: string;
  type: 'SALE';
  payload: OfflineSalePayload;
}

export interface SyncEventResult {
  clientId: string;
  status: 'SYNCED' | 'FAILED' | 'CONFLICT';
  saleId?: string;
  saleNumber?: string;
  sale?: Sale;
  error?: { code: string; message: string; details?: unknown };
  conflicts?: Array<{ productId: string; productName: string; requested: string; available: string }>;
}

export interface SyncPushResponse {
  results: SyncEventResult[];
  inventory: SyncInventoryLevel[];
  serverTime: string;
  deviceId: string;
}

export interface SyncBootstrap {
  business: BusinessSettings;
  locations: Location[];
  taxRates: TaxRate[];
  products: Product[];
  inventory: SyncInventoryLevel[];
  customers: Customer[];
  serverTime: string;
}

export interface SyncPullResponse {
  products: Product[];
  inventory: SyncInventoryLevel[];
  customers: Customer[];
  serverTime: string;
}

export interface SyncOverview {
  pendingConflicts: number;
  lastSyncAt: string | null;
  devices: Array<{
    id: string;
    name: string;
    lastSeenAt: string | null;
    lastSyncAt: string | null;
    pendingEvents: number;
  }>;
  conflicts: Array<{
    id: string;
    deviceName: string;
    clientId: string;
    reason: string;
    createdAt: string;
    resolvedAt: string | null;
    status: string;
    resolution: string | null;
    details: unknown;
  }>;
}

export interface FileExportResult {
  filename: string;
  contentType: string;
  content: string;
}

export interface ProductImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}
