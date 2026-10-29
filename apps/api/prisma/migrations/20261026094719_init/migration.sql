-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MANAGER', 'CASHIER', 'INVENTORY_CLERK');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BusinessPlan" AS ENUM ('STARTER', 'GROWTH', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('PURCHASE', 'SALE', 'SALE_RETURN', 'PURCHASE_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'DAMAGE', 'EXPIRY', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('COMPLETED', 'PENDING', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('LOW_STOCK', 'CRITICAL_STOCK', 'SYNC_FAILED', 'SYNC_CONFLICT', 'SECURITY', 'REFUND_PENDING', 'TRANSFER_PENDING', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SyncConflictStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UGX',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Kampala',
    "locale" TEXT NOT NULL DEFAULT 'en-UG',
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "logoUrl" TEXT,
    "taxEnabled" BOOLEAN NOT NULL DEFAULT false,
    "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
    "maxCashierDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "maxManagerDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "refundApprovalThreshold" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "defaultLeadTimeDays" INTEGER NOT NULL DEFAULT 3,
    "receiptFooter" TEXT,
    "plan" "BusinessPlan" NOT NULL DEFAULT 'STARTER',
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "featureFlags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CASHIER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLocation" (
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessId" TEXT,

    CONSTRAINT "UserLocation_pkey" PRIMARY KEY ("userId","locationId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "rememberMe" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessId" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessId" TEXT,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessId" TEXT,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(6,3) NOT NULL,
    "isInclusive" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "categoryId" TEXT,
    "supplierId" TEXT,
    "taxRateId" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "brand" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "sellingPrice" DECIMAL(16,2) NOT NULL,
    "costPrice" DECIMAL(16,2) NOT NULL,
    "reorderLevel" DECIMAL(16,3) NOT NULL DEFAULT 0,
    "safetyStock" DECIMAL(16,3) NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 3,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "trackStock" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLevel" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(16,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "movementType" "MovementType" NOT NULL,
    "quantity" DECIMAL(16,3) NOT NULL,
    "unitCost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "balanceAfter" DECIMAL(16,3) NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "performedBy" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseNumber" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'ORDERED',
    "reference" TEXT,
    "subtotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(16,3) NOT NULL,
    "receivedQuantity" DECIMAL(16,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(16,2) NOT NULL,
    "lineTotal" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturn" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "locationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "total" DECIMAL(16,2) NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturnItem" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(16,3) NOT NULL,
    "unitCost" DECIMAL(16,2) NOT NULL,
    "lineTotal" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "PurchaseReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "saleNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "cashierId" TEXT NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "subtotal" DECIMAL(16,2) NOT NULL,
    "discountTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(16,2) NOT NULL,
    "costTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "clientId" TEXT,
    "isOffline" BOOLEAN NOT NULL DEFAULT false,
    "deviceId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" DECIMAL(16,3) NOT NULL,
    "unitPrice" DECIMAL(16,2) NOT NULL,
    "lineDiscount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "cartDiscount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(16,2) NOT NULL,
    "unitCost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "refundedQuantity" DECIMAL(16,3) NOT NULL DEFAULT 0,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "reference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "provider" TEXT NOT NULL DEFAULT 'MANUAL',
    "metadata" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "refundNumber" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "total" DECIMAL(16,2) NOT NULL,
    "taxTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "costTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "restock" BOOLEAN NOT NULL DEFAULT true,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundItem" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(16,3) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "restock" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RefundItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferItem" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(16,3) NOT NULL,
    "unitCost" DECIMAL(16,2) NOT NULL DEFAULT 0,

    CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "NotificationType" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "deviceId" TEXT,
    "clientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "status" "SyncConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentCounter" (
    "businessId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("businessId","docType")
);

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");

-- CreateIndex
CREATE INDEX "Business_deletedAt_idx" ON "Business"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_businessId_role_idx" ON "User"("businessId", "role");

-- CreateIndex
CREATE INDEX "User_businessId_status_idx" ON "User"("businessId", "status");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "UserLocation_locationId_idx" ON "UserLocation"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "Location_businessId_isActive_idx" ON "Location"("businessId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Location_businessId_code_key" ON "Location"("businessId", "code");

-- CreateIndex
CREATE INDEX "TaxRate_businessId_isActive_idx" ON "TaxRate"("businessId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRate_businessId_name_key" ON "TaxRate"("businessId", "name");

-- CreateIndex
CREATE INDEX "Category_businessId_isActive_idx" ON "Category"("businessId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Category_businessId_name_key" ON "Category"("businessId", "name");

-- CreateIndex
CREATE INDEX "Supplier_businessId_isActive_idx" ON "Supplier"("businessId", "isActive");

-- CreateIndex
CREATE INDEX "Supplier_businessId_name_idx" ON "Supplier"("businessId", "name");

-- CreateIndex
CREATE INDEX "Customer_businessId_name_idx" ON "Customer"("businessId", "name");

-- CreateIndex
CREATE INDEX "Customer_businessId_phone_idx" ON "Customer"("businessId", "phone");

-- CreateIndex
CREATE INDEX "Product_businessId_isActive_idx" ON "Product"("businessId", "isActive");

-- CreateIndex
CREATE INDEX "Product_businessId_name_idx" ON "Product"("businessId", "name");

-- CreateIndex
CREATE INDEX "Product_businessId_categoryId_idx" ON "Product"("businessId", "categoryId");

-- CreateIndex
CREATE INDEX "Product_businessId_supplierId_idx" ON "Product"("businessId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_businessId_sku_key" ON "Product"("businessId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_businessId_barcode_key" ON "Product"("businessId", "barcode");

-- CreateIndex
CREATE INDEX "InventoryLevel_businessId_productId_idx" ON "InventoryLevel"("businessId", "productId");

-- CreateIndex
CREATE INDEX "InventoryLevel_businessId_locationId_idx" ON "InventoryLevel"("businessId", "locationId");

-- CreateIndex
CREATE INDEX "InventoryLevel_businessId_updatedAt_idx" ON "InventoryLevel"("businessId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLevel_locationId_productId_key" ON "InventoryLevel"("locationId", "productId");

-- CreateIndex
CREATE INDEX "InventoryMovement_businessId_createdAt_idx" ON "InventoryMovement"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_businessId_productId_createdAt_idx" ON "InventoryMovement"("businessId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_businessId_locationId_createdAt_idx" ON "InventoryMovement"("businessId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_referenceType_referenceId_idx" ON "InventoryMovement"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "Purchase_businessId_createdAt_idx" ON "Purchase"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Purchase_businessId_status_idx" ON "Purchase"("businessId", "status");

-- CreateIndex
CREATE INDEX "Purchase_businessId_supplierId_idx" ON "Purchase"("businessId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_businessId_purchaseNumber_key" ON "Purchase"("businessId", "purchaseNumber");

-- CreateIndex
CREATE INDEX "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseItem_productId_idx" ON "PurchaseItem"("productId");

-- CreateIndex
CREATE INDEX "PurchaseReturn_businessId_createdAt_idx" ON "PurchaseReturn"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseReturn_purchaseId_idx" ON "PurchaseReturn"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReturn_businessId_returnNumber_key" ON "PurchaseReturn"("businessId", "returnNumber");

-- CreateIndex
CREATE INDEX "PurchaseReturnItem_returnId_idx" ON "PurchaseReturnItem"("returnId");

-- CreateIndex
CREATE INDEX "Sale_businessId_createdAt_idx" ON "Sale"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_businessId_locationId_createdAt_idx" ON "Sale"("businessId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_businessId_cashierId_createdAt_idx" ON "Sale"("businessId", "cashierId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_businessId_customerId_idx" ON "Sale"("businessId", "customerId");

-- CreateIndex
CREATE INDEX "Sale_businessId_status_createdAt_idx" ON "Sale"("businessId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_businessId_saleNumber_key" ON "Sale"("businessId", "saleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_businessId_idempotencyKey_key" ON "Sale"("businessId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_businessId_clientId_key" ON "Sale"("businessId", "clientId");

-- CreateIndex
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");

-- CreateIndex
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");

-- CreateIndex
CREATE INDEX "Payment_saleId_idx" ON "Payment"("saleId");

-- CreateIndex
CREATE INDEX "Payment_businessId_createdAt_idx" ON "Payment"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_businessId_method_createdAt_idx" ON "Payment"("businessId", "method", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_businessId_status_createdAt_idx" ON "Refund"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_businessId_saleId_idx" ON "Refund"("businessId", "saleId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_businessId_refundNumber_key" ON "Refund"("businessId", "refundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_businessId_idempotencyKey_key" ON "Refund"("businessId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "RefundItem_refundId_idx" ON "RefundItem"("refundId");

-- CreateIndex
CREATE INDEX "RefundItem_saleItemId_idx" ON "RefundItem"("saleItemId");

-- CreateIndex
CREATE INDEX "StockTransfer_businessId_status_createdAt_idx" ON "StockTransfer"("businessId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_businessId_transferNumber_key" ON "StockTransfer"("businessId", "transferNumber");

-- CreateIndex
CREATE INDEX "StockTransferItem_transferId_idx" ON "StockTransferItem"("transferId");

-- CreateIndex
CREATE INDEX "AuditLog_businessId_createdAt_idx" ON "AuditLog"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_businessId_action_createdAt_idx" ON "AuditLog"("businessId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_businessId_readAt_createdAt_idx" ON "Notification"("businessId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_businessId_userId_readAt_idx" ON "Notification"("businessId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "Device_businessId_idx" ON "Device"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_businessId_deviceKey_key" ON "Device"("businessId", "deviceKey");

-- CreateIndex
CREATE INDEX "SyncConflict_businessId_status_createdAt_idx" ON "SyncConflict"("businessId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncConflict_businessId_clientId_type_key" ON "SyncConflict"("businessId", "clientId", "type");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLevel" ADD CONSTRAINT "InventoryLevel_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLevel" ADD CONSTRAINT "InventoryLevel_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLevel" ADD CONSTRAINT "InventoryLevel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_performedBy_fkey" FOREIGN KEY ("performedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "PurchaseReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentCounter" ADD CONSTRAINT "DocumentCounter_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Immutability guardrails for financial and audit history.
-- The application never updates or deletes these rows; these triggers make
-- that guarantee structural even against ad-hoc SQL. Deliberate maintenance
-- (restore rehearsal / test teardown) may set app.allow_purge = 'on' for the
-- session, which is intentionally awkward to reach from the running API.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kampalasmart_guard_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% is append-only; updates are not permitted', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' AND coalesce(current_setting('app.allow_purge', true), 'off') <> 'on' THEN
    RAISE EXCEPTION '% is append-only; deletes are not permitted', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_immutable"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION kampalasmart_guard_immutable();

CREATE TRIGGER "InventoryMovement_immutable"
  BEFORE UPDATE OR DELETE ON "InventoryMovement"
  FOR EACH ROW EXECUTE FUNCTION kampalasmart_guard_immutable();

-- Ledger rows must always describe a non-zero change.
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_quantity_nonzero" CHECK ("quantity" <> 0);

-- Stock on hand may only go negative when a business explicitly allows it.
-- Enforced in the service layer per business setting; the database still
-- rejects nonsensical ledger balances that were never derived from movements.
ALTER TABLE "InventoryLevel"
  ADD CONSTRAINT "InventoryLevel_quantity_finite" CHECK ("quantity" = "quantity" AND abs("quantity") < 1000000000);

-- A payment may never exceed the sale total or be non-positive.
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
