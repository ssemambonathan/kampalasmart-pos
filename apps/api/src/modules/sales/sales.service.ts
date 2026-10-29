import { Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma, SaleStatus } from '@prisma/client';
import {
  PERMISSIONS,
  PricingError,
  assertDiscountAllowed,
  dec,
  money,
  priceCart,
  type DiscountInput,
  type PriceableProduct,
  type Sale as SaleDto,
} from '@kampalasmart/shared';
import { AuditService, type AuditActor } from '../../common/audit/audit.service';
import { PrismaService, type Tx } from '../../common/prisma/prisma.service';
import { InventoryLedgerService } from '../../common/inventory/inventory-ledger.service';
import { AccessService } from '../../common/access/access.service';
import { DocumentNumberService } from '../../common/documents/document-number.service';
import { ApiException } from '../../common/errors/api-exception';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { toCsv } from '../../common/csv';
import type { AuthUser } from '../../common/auth/auth-user';
import type { CreateSaleDto, SaleQueryDto } from './sales.dto';

const saleInclude = {
  location: { select: { name: true, address: true, phone: true } },
  cashier: { select: { name: true } },
  customer: { select: { name: true, phone: true } },
  items: { orderBy: { id: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  refunds: {
    include: {
      items: true,
      requester: { select: { name: true } },
      approver: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.SaleInclude;

type SaleWithRelations = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

type SaleResult = SaleDto & { change: string };

function toSaleDto(sale: SaleWithRelations): SaleDto {
  return {
    id: sale.id,
    saleNumber: sale.saleNumber,
    locationId: sale.locationId,
    locationName: sale.location.name,
    cashierId: sale.cashierId,
    cashierName: sale.cashier.name,
    customerId: sale.customerId,
    customerName: sale.customer?.name ?? null,
    status: sale.status,
    subtotal: sale.subtotal.toFixed(2),
    discountTotal: sale.discountTotal.toFixed(2),
    taxTotal: sale.taxTotal.toFixed(2),
    total: sale.total.toFixed(2),
    costTotal: sale.costTotal.toFixed(2),
    grossProfit: sale.total.minus(sale.taxTotal).minus(sale.costTotal).toFixed(2),
    notes: sale.notes,
    isOffline: sale.isOffline,
    createdAt: sale.createdAt.toISOString(),
    items: sale.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      quantity: item.quantity.toFixed(3),
      unitPrice: item.unitPrice.toFixed(2),
      discountAmount: item.discountAmount.toFixed(2),
      taxRate: item.taxRate.toFixed(3),
      taxAmount: item.taxAmount.toFixed(2),
      lineTotal: item.lineTotal.toFixed(2),
      unitCost: item.unitCost.toFixed(2),
      refundedQuantity: item.refundedQuantity.toFixed(3),
    })),
    payments: sale.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amount: payment.amount.toFixed(2),
      reference: payment.reference,
      status: payment.status,
      provider: payment.provider,
      createdAt: payment.createdAt.toISOString(),
    })),
    refunds: sale.refunds.map((refund) => ({
      id: refund.id,
      refundNumber: refund.refundNumber,
      saleId: refund.saleId,
      saleNumber: sale.saleNumber,
      reason: refund.reason,
      status: refund.status,
      total: refund.total.toFixed(2),
      requestedByName: refund.requester?.name ?? null,
      approvedByName: refund.approver?.name ?? null,
      approvedAt: refund.approvedAt?.toISOString() ?? null,
      createdAt: refund.createdAt.toISOString(),
      items: refund.items.map((item) => {
        const saleItem = sale.items.find((line) => line.id === item.saleItemId);
        return {
          id: item.id,
          saleItemId: item.saleItemId,
          productName: saleItem?.productName ?? '',
          sku: saleItem?.sku ?? '',
          quantity: item.quantity.toFixed(3),
          amount: item.amount.toFixed(2),
          restock: item.restock,
        };
      }),
    })),
  };
}

const MAX_OFFLINE_AGE_DAYS = 90;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: InventoryLedgerService,
    private readonly access: AccessService,
    private readonly documents: DocumentNumberService,
  ) {}

  async list(auth: AuthUser, query: SaleQueryDto) {
    const { skip, take } = skipTake(query);
    const where = this.listWhere(auth, query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({
        where,
        include: {
          location: { select: { name: true } },
          cashier: { select: { name: true } },
          customer: { select: { name: true } },
          payments: { select: { method: true }, orderBy: { amount: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.sale.count({ where }),
    ]);
    return paginate(
      rows.map((sale) => ({
        id: sale.id,
        saleNumber: sale.saleNumber,
        locationName: sale.location.name,
        cashierName: sale.cashier.name,
        customerName: sale.customer?.name ?? null,
        status: sale.status,
        total: sale.total.toFixed(2),
        paymentMethod: sale.payments[0]?.method ?? null,
        createdAt: sale.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }

  async get(auth: AuthUser, id: string): Promise<SaleDto> {
    const sale = await this.prisma.sale.findFirst({
      where: { id, businessId: auth.businessId },
      include: saleInclude,
    });
    if (!sale) throw ApiException.notFound('Sale not found.', 'SALE_NOT_FOUND');
    this.assertCanRead(auth, sale);
    return toSaleDto(sale);
  }

  async receipt(auth: AuthUser, id: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id, businessId: auth.businessId },
      include: saleInclude,
    });
    if (!sale) throw ApiException.notFound('Sale not found.', 'SALE_NOT_FOUND');
    this.assertCanRead(auth, sale);
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: {
        name: true,
        address: true,
        phone: true,
        email: true,
        logoUrl: true,
        currency: true,
        receiptFooter: true,
        taxEnabled: true,
        taxInclusive: true,
      },
    });
    return {
      business,
      location: {
        id: sale.locationId,
        name: sale.location.name,
        address: sale.location.address,
        phone: sale.location.phone,
      },
      sale: toSaleDto(sale),
      customerPhone: sale.customer?.phone ?? null,
      issuedAt: new Date().toISOString(),
    };
  }

  async exportCsv(auth: AuthUser, query: SaleQueryDto) {
    if (!auth.permissions.includes(PERMISSIONS.EXPORTS_DATA)) {
      throw ApiException.forbidden('You do not have permission to export data.', 'EXPORT_FORBIDDEN');
    }
    const where = this.listWhere(auth, query);
    const rows = await this.prisma.sale.findMany({
      where,
      include: {
        location: { select: { name: true } },
        cashier: { select: { name: true } },
        customer: { select: { name: true } },
        items: true,
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const csv = toCsv(
      [
        'sale_number',
        'created_at',
        'location',
        'cashier',
        'customer',
        'status',
        'sku',
        'product',
        'quantity',
        'unit_price',
        'line_discount',
        'cart_discount',
        'tax',
        'line_total',
        'unit_cost',
        'sale_subtotal',
        'sale_discount',
        'sale_tax',
        'sale_total',
        'payment_methods',
        'offline',
      ],
      rows.flatMap((sale) =>
        sale.items.map((item) => [
          sale.saleNumber,
          sale.createdAt.toISOString(),
          sale.location.name,
          sale.cashier.name,
          sale.customer?.name ?? '',
          sale.status,
          item.sku,
          item.productName,
          item.quantity.toFixed(3),
          item.unitPrice.toFixed(2),
          item.lineDiscount.toFixed(2),
          item.cartDiscount.toFixed(2),
          item.taxAmount.toFixed(2),
          item.lineTotal.toFixed(2),
          item.unitCost.toFixed(2),
          sale.subtotal.toFixed(2),
          sale.discountTotal.toFixed(2),
          sale.taxTotal.toFixed(2),
          sale.total.toFixed(2),
          sale.payments.map((payment) => `${payment.method}:${payment.amount.toFixed(2)}`).join('|'),
          sale.isOffline ? 'true' : 'false',
        ]),
      ),
    );
    return {
      filename: `sales-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: 'text/csv; charset=utf-8',
      content: csv,
    };
  }

  /**
   * Authoritative sale creation. The client may preview pricing, but this
   * method reprices from database products, enforces discount policy and stock
   * atomically, and is safe to retry with the same idempotency key or clientId.
   */
  async create(
    auth: AuthUser,
    dto: CreateSaleDto,
    actor: AuditActor,
    options: { deviceId?: string | null; allowNegativeStock?: boolean } = {},
  ): Promise<SaleResult> {
    const existing = await this.findExisting(auth.businessId, dto.idempotencyKey, dto.clientId);
    if (existing) {
      const sale = await this.get(auth, existing.id);
      return { ...sale, change: '0.00' };
    }

    try {
      const result = await this.prisma.criticalTransaction(async (tx) => {
        const replay = await this.findExisting(auth.businessId, dto.idempotencyKey, dto.clientId, tx);
        if (replay) return { saleId: replay.id, change: '0.00', reused: true };

        const location = await this.access.resolveLocation(auth, dto.locationId ?? null);
        const business = await tx.business.findUniqueOrThrow({ where: { id: auth.businessId } });
        if (dto.customerId) {
          const customer = await tx.customer.findFirst({
            where: { id: dto.customerId, businessId: auth.businessId, deletedAt: null },
            select: { isActive: true },
          });
          if (!customer) throw ApiException.badRequest('Customer not found.', 'INVALID_CUSTOMER');
          if (!customer.isActive) throw ApiException.badRequest('This customer is inactive.', 'CUSTOMER_INACTIVE');
        }

        const productIds = dto.items.map((line) => line.productId);
        if (new Set(productIds).size !== productIds.length) {
          throw ApiException.badRequest('A product appears more than once in the cart.', 'DUPLICATE_PRODUCT');
        }
        const productRows = await tx.product.findMany({
          where: { businessId: auth.businessId, id: { in: productIds }, deletedAt: null, isActive: true },
          include: { taxRate: { select: { rate: true, isInclusive: true } } },
        });
        if (productRows.length !== productIds.length) {
          throw ApiException.badRequest('One or more products are unavailable.', 'PRODUCT_UNAVAILABLE');
        }
        const levels = await tx.inventoryLevel.findMany({
          where: { businessId: auth.businessId, locationId: location.id, productId: { in: productIds } },
          select: { productId: true, quantity: true },
        });
        const stockByProduct = new Map(levels.map((level) => [level.productId, dec(level.quantity)]));

        const priceable: PriceableProduct[] = productRows.map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          sellingPrice: product.sellingPrice.toFixed(2),
          costPrice: product.costPrice.toFixed(2),
          taxRate: product.taxRate
            ? product.taxRate.rate.toFixed(3)
            : business.taxEnabled
              ? business.taxRate.toFixed(3)
              : '0.000',
          taxInclusive: product.taxRate?.isInclusive ?? business.taxInclusive,
          trackStock: product.trackStock,
          stock: (stockByProduct.get(product.id) ?? dec(0)).toFixed(3),
        }));
        const byId = new Map(priceable.map((product) => [product.id, product]));

        if (!auth.permissions.includes(PERMISSIONS.SALES_PRICE_OVERRIDE)) {
          const overridden = dto.items.find((line) => {
            if (line.unitPrice === undefined) return false;
            const original = byId.get(line.productId);
            return original ? !dec(line.unitPrice).equals(original.sellingPrice) : false;
          });
          if (overridden) {
            throw ApiException.forbidden(
              'Changing the selling price requires manager authorisation.',
              'PRICE_OVERRIDE_FORBIDDEN',
            );
          }
        }

        let priced: ReturnType<typeof priceCart>;
        try {
          priced = priceCart(
            dto.items.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineDiscount: (line.lineDiscount ?? null) as DiscountInput | null,
            })),
            byId,
            {
              cartDiscount: (dto.cartDiscount ?? null) as DiscountInput | null,
              taxEnabled: business.taxEnabled,
              allowNegativeStock:
                options.allowNegativeStock === true || business.allowNegativeStock === true,
            },
          );
          assertDiscountAllowed(auth.role, priced.subtotal, priced.discountTotal, {
            maxCashierDiscountPercent: business.maxCashierDiscountPercent.toFixed(2),
            maxManagerDiscountPercent: business.maxManagerDiscountPercent.toFixed(2),
          });
        } catch (error) {
          if (error instanceof PricingError) {
            if (error.code === 'INSUFFICIENT_STOCK' || error.code === 'INVALID_DISCOUNT') {
              throw ApiException.conflict(error.message, error.code, error.details);
            }
            throw ApiException.badRequest(error.message, error.code, error.details);
          }
          throw error;
        }

        const payments = this.applyPayments(dto.payments, priced.total);
        const createdAt = this.resolveOccurredAt(dto);

        const saleNumber = await this.documents.next(tx, auth.businessId, 'SALE');
        const sale = await tx.sale.create({
          data: {
            businessId: auth.businessId,
            locationId: location.id,
            saleNumber,
            customerId: dto.customerId ?? null,
            cashierId: auth.id,
            status: 'COMPLETED',
            subtotal: priced.subtotal,
            discountTotal: priced.discountTotal,
            taxTotal: priced.taxTotal,
            total: priced.total,
            costTotal: priced.costTotal,
            notes: dto.notes ?? null,
            idempotencyKey: dto.idempotencyKey ?? null,
            clientId: dto.clientId ?? null,
            isOffline: dto.isOffline === true,
            deviceId: options.deviceId ?? null,
            createdAt,
            syncedAt: dto.isOffline === true ? new Date() : null,
            items: {
              create: priced.lines.map((line) => ({
                productId: line.productId,
                productName: line.name,
                sku: line.sku,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                lineDiscount: line.lineDiscount,
                cartDiscount: line.cartDiscount,
                discountAmount: line.discountAmount,
                taxRate: line.taxRate,
                taxAmount: line.taxAmount,
                lineTotal: line.lineTotal,
                unitCost: line.unitCost,
                totalCost: line.totalCost,
              })),
            },
            payments: {
              create: payments.entries.map((payment) => ({
                businessId: auth.businessId,
                method: payment.method,
                amount: payment.amount,
                reference: payment.reference,
                status: 'COMPLETED',
                provider: 'MANUAL',
                createdBy: auth.id,
              })),
            },
          },
          include: saleInclude,
        });

        const reorderByProduct = new Map(productRows.map((product) => [product.id, product.reorderLevel]));
        for (const line of priced.lines) {
          const applied = await this.ledger.apply(tx, {
            businessId: auth.businessId,
            locationId: location.id,
            productId: line.productId,
            movementType: 'SALE',
            quantity: dec(line.quantity).negated().toFixed(3),
            unitCost: line.unitCost,
            referenceType: 'SALE',
            referenceId: sale.id,
            performedBy: auth.id,
          });
          const product = byId.get(line.productId);
          if (!product) continue;
          const reorderLevel = dec(reorderByProduct.get(line.productId) ?? 0);
          if (
            dec(applied.balanceAfter).lessThanOrEqualTo(reorderLevel) &&
            dec(applied.previousQuantity).greaterThan(reorderLevel)
          ) {
            const critical = dec(applied.balanceAfter).lessThanOrEqualTo(0);
            await tx.notification.create({
              data: {
                businessId: auth.businessId,
                type: critical ? 'CRITICAL_STOCK' : 'LOW_STOCK',
                severity: critical ? 'CRITICAL' : 'WARNING',
                title: critical
                  ? `${product.name} is out of stock at ${location.name}`
                  : `${product.name} is running low at ${location.name}`,
                body: `${applied.balanceAfter} ${product.sku} remaining (reorder level ${reorderLevel.toFixed(3)}). Triggered by sale ${saleNumber}.`,
                data: {
                  productId: product.id,
                  locationId: location.id,
                  quantity: applied.balanceAfter,
                  reorderLevel: reorderLevel.toFixed(3),
                  saleId: sale.id,
                },
              },
            });
          }
        }

        await this.audit.record(
          {
            businessId: auth.businessId,
            action: 'sale.created',
            entityType: 'Sale',
            entityId: sale.id,
            actor,
            after: {
              saleNumber,
              locationName: location.name,
              total: priced.total,
              taxTotal: priced.taxTotal,
              discountTotal: priced.discountTotal,
              itemCount: priced.itemCount,
              quantityTotal: priced.quantityTotal,
              payments: payments.entries.map((entry) => ({ method: entry.method, amount: entry.amount })),
              change: payments.change,
              offline: dto.isOffline === true,
              clientId: dto.clientId ?? null,
            },
          },
          tx,
        );

        return { saleId: sale.id, change: payments.change, reused: false };
      });

      const sale = await this.get(auth, result.saleId);
      return { ...sale, change: result.change };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.findExisting(auth.businessId, dto.idempotencyKey, dto.clientId);
        if (replay) {
          const sale = await this.get(auth, replay.id);
          return { ...sale, change: '0.00' };
        }
      }
      throw error;
    }
  }

  private applyPayments(
    inputs: Array<{ method: string; amount: string; reference?: string | null }>,
    total: string,
  ): {
    entries: Array<{ method: PaymentMethod; amount: string; reference: string | null }>;
    change: string;
  } {
    const totalAmount = dec(total);
    if (totalAmount.isZero()) {
      if (inputs.some((payment) => !dec(payment.amount).isZero())) {
        throw ApiException.badRequest('A zero-value sale cannot take payment.', 'PAYMENT_NOT_REQUIRED');
      }
      return { entries: [], change: '0.00' };
    }
    if (!inputs.length) {
      throw ApiException.badRequest('Record at least one payment to complete the sale.', 'PAYMENT_REQUIRED');
    }
    let nonCash = dec(0);
    let cash = dec(0);
    for (const payment of inputs) {
      const amount = dec(payment.amount);
      if (amount.isZero() || amount.isNegative() || amount.decimalPlaces() > 2) {
        throw ApiException.badRequest('Each payment must be a positive amount with at most 2 decimals.', 'INVALID_PAYMENT');
      }
      if (payment.method === 'CASH') cash = cash.plus(amount);
      else nonCash = nonCash.plus(amount);
    }
    if (nonCash.greaterThan(totalAmount)) {
      throw ApiException.badRequest(
        'Non-cash payments exceed the sale total. Adjust the amounts or record the difference as change on a cash payment.',
        'PAYMENT_EXCEEDS_TOTAL',
      );
    }
    const requiredCash = totalAmount.minus(nonCash);
    if (cash.lessThan(requiredCash)) {
      throw ApiException.badRequest(
        `Payments total ${cash.plus(nonCash).toFixed(2)} but the sale total is ${totalAmount.toFixed(2)}.`,
        'PAYMENT_MISMATCH',
        { due: requiredCash.toFixed(2), shortfall: requiredCash.minus(cash).toFixed(2) },
      );
    }
    const change = cash.minus(requiredCash);
    const entries: Array<{ method: PaymentMethod; amount: string; reference: string | null }> = [];
    let cashRemaining = requiredCash;
    for (const payment of inputs) {
      const method = payment.method as PaymentMethod;
      const amount = dec(payment.amount);
      if (payment.method === 'CASH') {
        const applied = amount.lessThan(cashRemaining) ? amount : cashRemaining;
        if (applied.greaterThan(0)) {
          entries.push({ method, amount: applied.toFixed(2), reference: payment.reference ?? null });
          cashRemaining = cashRemaining.minus(applied);
        }
      } else {
        entries.push({ method, amount: amount.toFixed(2), reference: payment.reference ?? null });
      }
    }
    return { entries, change: money(change) };
  }

  private resolveOccurredAt(dto: CreateSaleDto): Date {
    const now = Date.now();
    if (dto.isOffline !== true) return new Date(now);
    if (!dto.occurredAt) return new Date(now);
    const occurred = new Date(dto.occurredAt);
    if (Number.isNaN(occurred.getTime())) {
      throw ApiException.badRequest('occurredAt is not a valid timestamp.', 'INVALID_TIMESTAMP');
    }
    if (occurred.getTime() > now + MAX_CLOCK_SKEW_MS) {
      throw ApiException.badRequest('An offline sale cannot be dated in the future.', 'INVALID_TIMESTAMP');
    }
    if (occurred.getTime() < now - MAX_OFFLINE_AGE_DAYS * 86_400_000) {
      throw ApiException.badRequest(
        `Offline sales older than ${MAX_OFFLINE_AGE_DAYS} days must be entered as a stock adjustment.`,
        'OFFLINE_SALE_TOO_OLD',
      );
    }
    return occurred;
  }

  private async findExisting(
    businessId: string,
    idempotencyKey: string | undefined,
    clientId: string | null | undefined,
    tx?: Tx,
  ) {
    const conditions: Prisma.SaleWhereInput[] = [];
    if (idempotencyKey) conditions.push({ idempotencyKey });
    if (clientId) conditions.push({ clientId });
    if (!conditions.length) return null;
    const client = tx ?? this.prisma;
    return client.sale.findFirst({
      where: { businessId, OR: conditions },
      select: { id: true },
    });
  }

  private listWhere(auth: AuthUser, query: SaleQueryDto): Prisma.SaleWhereInput {
    const where: Prisma.SaleWhereInput = {
      businessId: auth.businessId,
      ...(query.status ? { status: query.status as SaleStatus } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.cashierId ? { cashierId: query.cashierId } : {}),
      ...(query.paymentMethod
        ? { payments: { some: { method: query.paymentMethod as PaymentMethod } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { saleNumber: { contains: query.search, mode: 'insensitive' } },
              { customer: { name: { contains: query.search, mode: 'insensitive' } } },
              { cashier: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    if (!auth.permissions.includes(PERMISSIONS.SALES_READ_ALL)) {
      where.cashierId = auth.id;
      if (!auth.permissions.includes(PERMISSIONS.SALES_READ_OWN)) {
        throw ApiException.forbidden('You do not have permission to view sales.', 'SALES_READ_FORBIDDEN');
      }
    }
    if (!this.access.isPrivileged(auth.role)) {
      where.locationId = query.locationId && auth.locationIds.includes(query.locationId)
        ? query.locationId
        : { in: auth.locationIds.length ? auth.locationIds : ['__none__'] };
    }
    return where;
  }

  private assertCanRead(auth: AuthUser, sale: { cashierId: string; locationId: string }) {
    if (!auth.permissions.includes(PERMISSIONS.SALES_READ_ALL) && sale.cashierId !== auth.id) {
      throw ApiException.forbidden('You can only view your own sales.', 'SALE_READ_FORBIDDEN');
    }
    if (!this.access.isPrivileged(auth.role) && !auth.locationIds.includes(sale.locationId)) {
      throw ApiException.forbidden('You are not assigned to this branch.', 'LOCATION_FORBIDDEN');
    }
  }
}
