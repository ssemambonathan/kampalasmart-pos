import type {
  Business,
  Category,
  Customer,
  Location,
  Product,
  Supplier,
  TaxRate,
  User,
} from '@prisma/client';
import type {
  BusinessSettings,
  Category as CategoryDto,
  Customer as CustomerDto,
  Location as LocationDto,
  Product as ProductDto,
  SessionUser,
  Supplier as SupplierDto,
  TaxRate as TaxRateDto,
} from '@kampalasmart/shared';
import { permissionsForRole } from '@kampalasmart/shared';

export function d2(value: { toFixed: (digits: number) => string } | string | number): string {
  if (typeof value === 'string') return Number(value).toFixed(2);
  if (typeof value === 'number') return value.toFixed(2);
  return value.toFixed(2);
}

export function d3(value: { toFixed: (digits: number) => string } | string | number): string {
  if (typeof value === 'string') return Number(value).toFixed(3);
  if (typeof value === 'number') return value.toFixed(3);
  return value.toFixed(3);
}

export function toBusinessDto(business: Business): BusinessSettings {
  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    currency: business.currency,
    timezone: business.timezone,
    locale: business.locale,
    phone: business.phone,
    email: business.email,
    address: business.address,
    logoUrl: business.logoUrl,
    taxEnabled: business.taxEnabled,
    taxInclusive: business.taxInclusive,
    taxRate: business.taxRate.toFixed(3),
    allowNegativeStock: business.allowNegativeStock,
    maxCashierDiscountPercent: business.maxCashierDiscountPercent.toFixed(2),
    maxManagerDiscountPercent: business.maxManagerDiscountPercent.toFixed(2),
    refundApprovalThreshold: business.refundApprovalThreshold.toFixed(2),
    defaultLeadTimeDays: business.defaultLeadTimeDays,
    receiptFooter: business.receiptFooter,
    plan: business.plan,
    subscriptionStatus: business.subscriptionStatus,
    trialEndsAt: business.trialEndsAt ? business.trialEndsAt.toISOString() : null,
    createdAt: business.createdAt.toISOString(),
  };
}

export function toLocationDto(location: Location): LocationDto {
  return {
    id: location.id,
    name: location.name,
    code: location.code,
    address: location.address,
    phone: location.phone,
    isActive: location.isActive,
    isDefault: location.isDefault,
  };
}

export function toSessionUser(user: User, locationIds: string[]): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    businessId: user.businessId,
    permissions: permissionsForRole(user.role),
    locationIds,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

export function toCategoryDto(category: Category, productCount?: number): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    isActive: category.isActive,
    productCount,
  };
}

export function toTaxRateDto(rate: TaxRate): TaxRateDto {
  return {
    id: rate.id,
    name: rate.name,
    rate: rate.rate.toFixed(3),
    isInclusive: rate.isInclusive,
    isDefault: rate.isDefault,
    isActive: rate.isActive,
  };
}

type ProductWithRelations = Product & {
  category?: { name: string } | null;
  supplier?: { name: string } | null;
  taxRate?: { rate: { toFixed: (d: number) => string }; isInclusive: boolean } | null;
  inventoryLevels?: Array<{ quantity: { toFixed: (d: number) => string } }>;
};

export function toProductDto(product: ProductWithRelations, stock?: string | number): ProductDto {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    brand: product.brand,
    description: product.description,
    categoryId: product.categoryId,
    categoryName: product.category?.name ?? null,
    supplierId: product.supplierId,
    supplierName: product.supplier?.name ?? null,
    sellingPrice: product.sellingPrice.toFixed(2),
    costPrice: product.costPrice.toFixed(2),
    taxRateId: product.taxRateId,
    taxRate: product.taxRate ? product.taxRate.rate.toFixed(3) : '0.000',
    taxInclusive: product.taxRate?.isInclusive ?? false,
    reorderLevel: product.reorderLevel.toFixed(3),
    safetyStock: product.safetyStock.toFixed(3),
    leadTimeDays: product.leadTimeDays,
    unit: product.unit,
    isActive: product.isActive,
    imageUrl: product.imageUrl,
    stock:
      stock !== undefined
        ? Number(stock).toFixed(3)
        : product.inventoryLevels?.[0]?.quantity.toFixed(3) ?? undefined,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export function toSupplierDto(
  supplier: Supplier,
  stats?: { productCount?: number; purchaseCount?: number; totalPurchased?: string; lastPurchaseAt?: Date | null },
): SupplierDto {
  return {
    id: supplier.id,
    name: supplier.name,
    contactName: supplier.contactName,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    notes: supplier.notes,
    isActive: supplier.isActive,
    productCount: stats?.productCount ?? 0,
    purchaseCount: stats?.purchaseCount ?? 0,
    totalPurchased: stats?.totalPurchased ?? '0.00',
    lastPurchaseAt: stats?.lastPurchaseAt ? stats.lastPurchaseAt.toISOString() : null,
    createdAt: supplier.createdAt.toISOString(),
  };
}

export function toCustomerDto(
  customer: Customer,
  stats?: { totalSpent?: string; purchaseCount?: number; lastPurchaseAt?: Date | null },
): CustomerDto {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    notes: customer.notes,
    isActive: customer.isActive,
    totalSpent: stats?.totalSpent ?? '0.00',
    purchaseCount: stats?.purchaseCount ?? 0,
    lastPurchaseAt: stats?.lastPurchaseAt ? stats.lastPurchaseAt.toISOString() : null,
    createdAt: customer.createdAt.toISOString(),
  };
}
