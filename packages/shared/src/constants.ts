export const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  MOBILE_MONEY: 'Mobile Money',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank Transfer',
  OTHER: 'Other',
};

export const PAYMENT_STATUSES = ['COMPLETED', 'PENDING', 'FAILED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const MOVEMENT_TYPES = [
  'PURCHASE',
  'SALE',
  'SALE_RETURN',
  'PURCHASE_RETURN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'DAMAGE',
  'EXPIRY',
  'OPENING_BALANCE',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const INBOUND_MOVEMENTS: readonly MovementType[] = [
  'PURCHASE',
  'SALE_RETURN',
  'ADJUSTMENT_IN',
  'TRANSFER_IN',
  'OPENING_BALANCE',
];

export const OUTBOUND_MOVEMENTS: readonly MovementType[] = [
  'SALE',
  'PURCHASE_RETURN',
  'ADJUSTMENT_OUT',
  'TRANSFER_OUT',
  'DAMAGE',
  'EXPIRY',
];

export const SALE_STATUSES = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const REFUND_STATUSES = ['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const PURCHASE_STATUSES = [
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const TRANSFER_STATUSES = ['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const SYNC_STATUSES = ['PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const NOTIFICATION_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_TYPES = [
  'LOW_STOCK',
  'CRITICAL_STOCK',
  'SYNC_FAILED',
  'SYNC_CONFLICT',
  'SECURITY',
  'REFUND_PENDING',
  'TRANSFER_PENDING',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const BUSINESS_PLANS = ['STARTER', 'GROWTH', 'ENTERPRISE'] as const;
export type BusinessPlan = (typeof BUSINESS_PLANS)[number];

export const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const AUDIT_ACTIONS = {
  BUSINESS_CREATED: 'business.created',
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_PASSWORD_RESET: 'auth.password_reset',
  AUTH_SESSION_REVOKED: 'auth.session_revoked',
  AUTH_TOKEN_REFRESHED: 'auth.token_refreshed',
  AUTH_EMAIL_VERIFIED: 'auth.email_verified',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DEACTIVATED: 'user.deactivated',
  ROLE_CHANGED: 'user.role_changed',
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_ARCHIVED: 'product.archived',
  PRICE_CHANGED: 'product.price_changed',
  COST_CHANGED: 'product.cost_changed',
  CATEGORY_CREATED: 'category.created',
  CATEGORY_UPDATED: 'category.updated',
  STOCK_ADJUSTED: 'inventory.adjusted',
  STOCK_RECONCILED: 'inventory.reconciled',
  TRANSFER_CREATED: 'transfer.created',
  TRANSFER_APPROVED: 'transfer.approved',
  TRANSFER_COMPLETED: 'transfer.completed',
  PURCHASE_CREATED: 'purchase.created',
  PURCHASE_RECEIVED: 'purchase.received',
  PURCHASE_RETURNED: 'purchase.returned',
  SALE_COMPLETED: 'sale.completed',
  SALE_SYNCED: 'sale.synced_offline',
  REFUND_REQUESTED: 'refund.requested',
  REFUND_APPROVED: 'refund.approved',
  REFUND_REJECTED: 'refund.rejected',
  REFUND_COMPLETED: 'refund.completed',
  SETTINGS_UPDATED: 'settings.updated',
  DATA_EXPORTED: 'data.exported',
  UNAUTHORIZED_ATTEMPT: 'security.unauthorized_attempt',
  SYNC_CONFLICT: 'sync.conflict',
  SYNC_FAILED: 'sync.failed',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
