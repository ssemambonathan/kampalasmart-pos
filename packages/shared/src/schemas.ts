import { z } from 'zod';
import { PAYMENT_METHODS } from './constants';
import { USER_ROLES } from './roles';

export const idSchema = z.string().min(1, 'Required').max(64);

const moneyLike = z.union([z.string(), z.number()]);

const money = (label: string) =>
  moneyLike
    .refine((v) => v !== '' && !Number.isNaN(Number(v)), `${label} must be a valid amount`)
    .refine((v) => Number(v) >= 0, `${label} cannot be negative`)
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(String(v).trim()), `${label} must have at most 2 decimals`);

const positiveQuantity = z
  .union([z.string(), z.number()])
  .refine((v) => v !== '' && Number(v) > 0, 'Quantity must be greater than zero')
  .refine((v) => /^\d+(\.\d{1,3})?$/.test(String(v).trim()), 'Quantity must have at most 3 decimals');

const discountSchema = z
  .object({
    type: z.enum(['PERCENT', 'AMOUNT']),
    value: z.union([z.string(), z.number()]),
  })
  .nullable()
  .optional();

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean().optional().default(false),
});

export const registerBusinessSchema = z.object({
  businessName: z.string().trim().min(2, 'Business name is required').max(120),
  ownerName: z.string().trim().min(2, 'Your name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[0-9]/, 'Include a number'),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  currency: z.string().trim().length(3).default('UGX'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20, 'Invalid reset token'),
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[0-9]/, 'Include a number'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(10, 'Use at least 10 characters')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[0-9]/, 'Include a number'),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().max(500).optional().or(z.literal('')),
});

export const productSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(160),
  sku: z
    .string()
    .trim()
    .min(1, 'SKU is required')
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'SKU may only contain letters, numbers, dot, dash and underscore'),
  barcode: z.string().trim().max(64).optional().or(z.literal('')),
  brand: z.string().trim().max(80).optional().or(z.literal('')),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  categoryId: idSchema.optional().or(z.literal('')),
  supplierId: idSchema.optional().or(z.literal('')),
  sellingPrice: money('Selling price'),
  costPrice: money('Cost price'),
  taxRateId: idSchema.optional().or(z.literal('')),
  taxRate: z.union([z.string(), z.number()]).optional(),
  reorderLevel: z.union([z.string(), z.number()]).default('0'),
  safetyStock: z.union([z.string(), z.number()]).default('0'),
  leadTimeDays: z.coerce.number().int().min(0, 'Lead time cannot be negative').max(365).default(3),
  unit: z.string().trim().min(1).max(24).default('piece'),
  isActive: z.boolean().default(true),
  imageUrl: z.string().trim().url('Enter a valid URL').max(500).optional().or(z.literal('')),
  openingQuantity: z.union([z.string(), z.number()]).optional(),
  openingLocationId: idSchema.optional().or(z.literal('')),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Supplier name is required').max(160),
  contactName: z.string().trim().max(120).optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
  isActive: z.boolean().optional(),
});

export const customerSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required').max(160),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
});

export const userCreateSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  role: z.enum(USER_ROLES),
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[0-9]/, 'Include a number'),
  locationIds: z.array(idSchema).min(1, 'Assign at least one location'),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  locationIds: z.array(idSchema).min(1).optional(),
});

export const locationSchema = z.object({
  name: z.string().trim().min(1, 'Location name is required').max(120),
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .max(16)
    .regex(/^[A-Za-z0-9_-]+$/, 'Code may only contain letters, numbers, dash and underscore'),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
});

export const saleSchema = z.object({
  locationId: idSchema,
  customerId: idSchema.nullish(),
  items: z
    .array(
      z.object({
        productId: idSchema,
        quantity: positiveQuantity,
        unitPrice: moneyLike.optional(),
        lineDiscount: discountSchema,
      }),
    )
    .min(1, 'Add at least one product'),
  cartDiscount: discountSchema,
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        amount: money('Payment amount'),
        reference: z.string().trim().max(120).nullish(),
      }),
    )
    .min(1, 'At least one payment is required'),
  notes: z.string().trim().max(500).nullish(),
  clientId: z.string().uuid().optional(),
});

export const purchaseSchema = z.object({
  supplierId: idSchema,
  locationId: idSchema,
  reference: z.string().trim().max(120).optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
  items: z
    .array(
      z.object({
        productId: idSchema,
        quantity: positiveQuantity,
        unitCost: money('Unit cost'),
      }),
    )
    .min(1, 'Add at least one product'),
});

export const receivePurchaseSchema = z.object({
  items: z
    .array(
      z.object({
        purchaseItemId: idSchema,
        quantity: z.union([z.string(), z.number()]),
      }),
    )
    .min(1),
});

export const refundSchema = z.object({
  saleId: idSchema,
  reason: z.string().trim().min(3, 'Give a reason for the refund').max(500),
  restock: z.boolean().default(true),
  items: z
    .array(
      z.object({
        saleItemId: idSchema,
        quantity: positiveQuantity,
      }),
    )
    .min(1, 'Select at least one item'),
});

export const transferSchema = z.object({
  fromLocationId: idSchema,
  toLocationId: idSchema,
  notes: z.string().trim().max(500).optional().or(z.literal('')),
  items: z
    .array(
      z.object({
        productId: idSchema,
        quantity: positiveQuantity,
      }),
    )
    .min(1, 'Add at least one product'),
});

export const adjustmentSchema = z.object({
  locationId: idSchema,
  productId: idSchema,
  quantity: z
    .union([z.string(), z.number()])
    .refine((v) => Number(v) !== 0, 'Adjustment cannot be zero'),
  reason: z.string().trim().min(3, 'Give a reason for the adjustment').max(500),
  movementType: z.enum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE', 'EXPIRY', 'OPENING_BALANCE']),
});

export const reconciliationSchema = z.object({
  locationId: idSchema,
  reason: z.string().trim().min(3, 'Give a reason for the count').max(500),
  counts: z
    .array(
      z.object({
        productId: idSchema,
        countedQuantity: z.union([z.string(), z.number()]).refine((v) => Number(v) >= 0, 'Count cannot be negative'),
      }),
    )
    .min(1, 'Enter at least one count'),
});

export const settingsSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  logoUrl: z.string().trim().url().optional().or(z.literal('')),
  currency: z.string().trim().length(3).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  taxEnabled: z.boolean().optional(),
  taxInclusive: z.boolean().optional(),
  taxRate: z.union([z.string(), z.number()]).optional(),
  allowNegativeStock: z.boolean().optional(),
  maxCashierDiscountPercent: z.union([z.string(), z.number()]).optional(),
  maxManagerDiscountPercent: z.union([z.string(), z.number()]).optional(),
  refundApprovalThreshold: z.union([z.string(), z.number()]).optional(),
  defaultLeadTimeDays: z.coerce.number().int().min(0).max(365).optional(),
  receiptFooter: z.string().trim().max(500).optional().or(z.literal('')),
});

export const taxRateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  rate: z.union([z.string(), z.number()]).refine((v) => Number(v) >= 0 && Number(v) <= 100, 'Rate must be 0-100'),
  isInclusive: z.boolean().default(false),
  isDefault: z.boolean().default(false),
});

export const productImportRowSchema = productSchema.extend({
  category: z.string().trim().optional(),
  supplier: z.string().trim().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterBusinessInput = z.infer<typeof registerBusinessSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type SupplierInput = z.infer<typeof supplierSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type LocationInput = z.infer<typeof locationSchema>;
export type SaleInput = z.infer<typeof saleSchema>;
export type PurchaseInput = z.infer<typeof purchaseSchema>;
export type RefundInput = z.infer<typeof refundSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type ReconciliationInput = z.infer<typeof reconciliationSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type TaxRateInput = z.infer<typeof taxRateSchema>;
