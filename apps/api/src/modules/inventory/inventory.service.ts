import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  dec,
  MOVEMENT_TYPES,
  money,
  quantity as qty,
  type LowStockItem,
  type MovementType,
} from '@kampalasmart/shared';
import { AccessService } from '../../common/access/access.service';
import { AuditService, type AuditActor } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryLedgerService } from '../../common/inventory/inventory-ledger.service';
import { ApiException } from '../../common/errors/api-exception';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { parseDateRange } from '../../common/date-range';
import { toCsv } from '../../common/csv';
import type { AuthUser } from '../../common/auth/auth-user';
import type {
  AdjustmentDto,
  InventoryQueryDto,
  LowStockQueryDto,
  MovementQueryDto,
  ReconciliationDto,
} from './inventory.dto';

type StockStatus = 'OUT_OF_STOCK' | 'CRITICAL' | 'LOW' | 'OK';

function statusOf(quantity: number, reorderLevel: number, safetyStock: number): StockStatus {
  if (quantity <= 0) return 'OUT_OF_STOCK';
  if (quantity <= safetyStock) return 'CRITICAL';
  if (quantity <= reorderLevel) return 'LOW';
  return 'OK';
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly ledger: InventoryLedgerService,
    private readonly audit: AuditService,
  ) {}

  private async scopedLocationIds(auth: AuthUser, locationId?: string): Promise<string[]> {
    if (locationId) {
      const location = await this.access.assertLocation(auth, locationId);
      return [location.id];
    }
    const locations = await this.access.listScopedLocations(auth);
    return locations.map((location) => location.id);
  }

  async levels(auth: AuthUser, query: InventoryQueryDto) {
    const locationIds = await this.scopedLocationIds(auth, query.locationId);
    const levels = await this.prisma.inventoryLevel.findMany({
      where: {
        businessId: auth.businessId,
        locationId: { in: locationIds },
        product: {
          deletedAt: null,
          ...(query.includeInactive ? {} : { isActive: true }),
          ...(query.categoryId ? { categoryId: query.categoryId } : {}),
          ...(query.search
            ? {
                OR: [
                  { name: { contains: query.search, mode: 'insensitive' } },
                  { sku: { contains: query.search, mode: 'insensitive' } },
                  { barcode: { contains: query.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
      include: {
        product: {
          include: { category: { select: { name: true } } },
        },
        location: { select: { name: true } },
      },
      orderBy: { product: { name: 'asc' } },
    });

    const rows = levels.map((level) => {
      const quantity = level.quantity.toNumber();
      const reorderLevel = level.product.reorderLevel.toNumber();
      const safetyStock = level.product.safetyStock.toNumber();
      const status = statusOf(quantity, reorderLevel, safetyStock);
      return {
        productId: level.productId,
        productName: level.product.name,
        sku: level.product.sku,
        barcode: level.product.barcode,
        categoryName: level.product.category?.name ?? null,
        unit: level.product.unit,
        locationId: level.locationId,
        locationName: level.location.name,
        quantity: level.quantity.toFixed(3),
        reorderLevel: level.product.reorderLevel.toFixed(3),
        safetyStock: level.product.safetyStock.toFixed(3),
        value: money(level.quantity.times(level.product.costPrice)),
        status,
        updatedAt: level.updatedAt.toISOString(),
      };
    });

    let filtered = rows;
    if (query.status && query.status !== 'all') {
      const wanted: StockStatus =
        query.status === 'out'
          ? 'OUT_OF_STOCK'
          : query.status === 'critical'
            ? 'CRITICAL'
            : query.status === 'low'
              ? 'LOW'
              : 'OK';
      filtered = rows.filter((row) => row.status === wanted);
    }

    const sortKey = (query.sort ?? '').toLowerCase();
    if (sortKey === 'quantity') {
      filtered.sort((a, b) => Number(a.quantity) - Number(b.quantity));
    } else if (sortKey === 'value') {
      filtered.sort((a, b) => Number(a.value) - Number(b.value));
    } else if (sortKey === 'status') {
      const order: Record<StockStatus, number> = { OUT_OF_STOCK: 0, CRITICAL: 1, LOW: 2, OK: 3 };
      filtered.sort((a, b) => order[a.status] - order[b.status]);
    } else {
      filtered.sort((a, b) => a.productName.localeCompare(b.productName));
    }
    if (query.direction === 'desc' && query.sort) filtered.reverse();

    const { skip, take } = skipTake(query);
    return paginate(filtered.slice(skip, skip + take), filtered.length, query);
  }

  async movements(auth: AuthUser, query: MovementQueryDto) {
    const locationIds = await this.scopedLocationIds(auth, query.locationId);
    if (query.movementType && !(MOVEMENT_TYPES as readonly string[]).includes(query.movementType)) {
      throw ApiException.badRequest('Unknown movement type.', 'INVALID_MOVEMENT_TYPE');
    }
    let from: Date | undefined;
    let to: Date | undefined;
    if (query.from || query.to) {
      const range = parseDateRange(query.from, query.to, { defaultDays: 30 });
      from = range.from;
      to = range.to;
    }
    const where: Prisma.InventoryMovementWhereInput = {
      businessId: auth.businessId,
      locationId: { in: locationIds },
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.movementType ? { movementType: query.movementType as MovementType } : {}),
      ...(from ? { createdAt: { gte: from, ...(to ? { lte: to } : {}) } } : {}),
      ...(query.search
        ? {
            product: {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { sku: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const { skip, take } = skipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.findMany({
        where,
        include: {
          product: { select: { name: true, sku: true } },
          location: { select: { name: true } },
          user: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    return paginate(
      rows.map((row) => ({
        id: row.id,
        productId: row.productId,
        productName: row.product.name,
        sku: row.product.sku,
        locationId: row.locationId,
        locationName: row.location.name,
        movementType: row.movementType,
        quantity: row.quantity.toFixed(3),
        unitCost: row.unitCost.toFixed(2),
        balanceAfter: row.balanceAfter.toFixed(3),
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        reason: row.reason,
        performedBy: row.performedBy,
        performedByName: row.user?.name ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }

  async productLedger(auth: AuthUser, productId: string, locationId?: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, businessId: auth.businessId },
      select: { id: true, name: true, sku: true, unit: true, costPrice: true },
    });
    if (!product) throw ApiException.notFound('Product not found.', 'PRODUCT_NOT_FOUND');
    const location = await this.access.resolveLocation(auth, locationId ?? null);
    const movements = await this.prisma.inventoryMovement.findMany({
      where: { businessId: auth.businessId, locationId: location.id, productId },
      include: { user: { select: { name: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const level = await this.prisma.inventoryLevel.findUnique({
      where: { locationId_productId: { locationId: location.id, productId } },
      select: { quantity: true, updatedAt: true },
    });
    return {
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        costPrice: product.costPrice.toFixed(2),
      },
      location: { id: location.id, name: location.name },
      currentQuantity: level?.quantity.toFixed(3) ?? '0.000',
      updatedAt: level?.updatedAt.toISOString() ?? null,
      movements: movements.map((movement) => ({
        id: movement.id,
        movementType: movement.movementType,
        quantity: movement.quantity.toFixed(3),
        unitCost: movement.unitCost.toFixed(2),
        totalCost: movement.totalCost.toFixed(2),
        balanceAfter: movement.balanceAfter.toFixed(3),
        referenceType: movement.referenceType,
        referenceId: movement.referenceId,
        reason: movement.reason,
        note: movement.note,
        performedByName: movement.user?.name ?? null,
        createdAt: movement.createdAt.toISOString(),
      })),
    };
  }

  async valuation(auth: AuthUser, locationId?: string) {
    const locationIds = await this.scopedLocationIds(auth, locationId);
    const levels = await this.prisma.inventoryLevel.findMany({
      where: {
        businessId: auth.businessId,
        locationId: { in: locationIds },
        product: { deletedAt: null, isActive: true, trackStock: true },
      },
      include: {
        product: { select: { costPrice: true, categoryId: true, category: { select: { name: true } } } },
        location: { select: { id: true, name: true } },
      },
    });
    let value = dec(0);
    let units = dec(0);
    const byLocation = new Map<string, { locationId: string; name: string; value: string; quantity: string; skus: number }>();
    const byCategory = new Map<string, { categoryId: string | null; name: string; value: string; quantity: string; skus: number }>();

    for (const level of levels) {
      const lineValue = level.quantity.times(level.product.costPrice);
      value = value.plus(lineValue);
      units = units.plus(level.quantity);

      const locationEntry = byLocation.get(level.locationId) ?? {
        locationId: level.locationId,
        name: level.location.name,
        value: '0.00',
        quantity: '0.000',
        skus: 0,
      };
      locationEntry.value = money(dec(locationEntry.value).plus(lineValue));
      locationEntry.quantity = qty(dec(locationEntry.quantity).plus(level.quantity));
      locationEntry.skus += 1;
      byLocation.set(level.locationId, locationEntry);

      const key = level.product.categoryId ?? 'uncategorised';
      const categoryEntry = byCategory.get(key) ?? {
        categoryId: level.product.categoryId,
        name: level.product.category?.name ?? 'Uncategorised',
        value: '0.00',
        quantity: '0.000',
        skus: 0,
      };
      categoryEntry.value = money(dec(categoryEntry.value).plus(lineValue));
      categoryEntry.quantity = qty(dec(categoryEntry.quantity).plus(level.quantity));
      categoryEntry.skus += 1;
      byCategory.set(key, categoryEntry);
    }

    return {
      totalValue: money(value),
      totalQuantity: qty(units),
      skuCount: new Set(levels.map((level) => level.productId)).size,
      locationCount: new Set(levels.map((level) => level.locationId)).size,
      byLocation: [...byLocation.values()].sort((a, b) => Number(b.value) - Number(a.value)),
      byCategory: [...byCategory.values()].sort((a, b) => Number(b.value) - Number(a.value)),
    };
  }

  async lowStock(auth: AuthUser, query: LowStockQueryDto) {
    const locationIds = await this.scopedLocationIds(auth, query.locationId);
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: { defaultLeadTimeDays: true },
    });
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [levels, soldRows, pendingRows] = await Promise.all([
      this.prisma.inventoryLevel.findMany({
        where: {
          businessId: auth.businessId,
          locationId: { in: locationIds },
          product: { deletedAt: null, isActive: true, trackStock: true },
        },
        include: {
          product: {
            select: {
              name: true,
              sku: true,
              reorderLevel: true,
              safetyStock: true,
              leadTimeDays: true,
              supplier: { select: { name: true } },
            },
          },
          location: { select: { name: true } },
        },
      }),
      this.prisma.$queryRaw<Array<{ productId: string; locationId: string; sold: string }>>`
        SELECT si."productId" AS "productId",
               s."locationId" AS "locationId",
               SUM(si.quantity - si."refundedQuantity")::text AS sold
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        WHERE s."businessId" = ${auth.businessId}
          AND s."locationId" = ANY(${locationIds}::text[])
          AND s."createdAt" >= ${since}
        GROUP BY si."productId", s."locationId"
      `,
      this.prisma.$queryRaw<Array<{ productId: string; locationId: string; pending: string }>>`
        SELECT pi."productId" AS "productId",
               p."locationId" AS "locationId",
               SUM(pi.quantity - pi."receivedQuantity")::text AS pending
        FROM "PurchaseItem" pi
        JOIN "Purchase" p ON p.id = pi."purchaseId"
        WHERE p."businessId" = ${auth.businessId}
          AND p."locationId" = ANY(${locationIds}::text[])
          AND p.status IN ('ORDERED', 'PARTIALLY_RECEIVED')
        GROUP BY pi."productId", p."locationId"
      `,
    ]);

    const soldMap = new Map(
      soldRows.map((row) => [`${row.locationId}:${row.productId}`, dec(row.sold)]),
    );
    const pendingMap = new Map(
      pendingRows.map((row) => [`${row.locationId}:${row.productId}`, dec(row.pending)]),
    );

    const items: Array<LowStockItem & { explanation: string }> = [];
    for (const level of levels) {
      const current = level.quantity.toNumber();
      const reorderLevel = level.product.reorderLevel.toNumber();
      const safetyStock = level.product.safetyStock.toNumber();
      const status = statusOf(current, reorderLevel, safetyStock);
      if (status === 'OK') continue;
      const key = `${level.locationId}:${level.productId}`;
      const avgDaily = (soldMap.get(key) ?? dec(0)).dividedBy(30);
      const pending = pendingMap.get(key) ?? dec(0);
      const leadTime = level.product.leadTimeDays || business.defaultLeadTimeDays;
      const rawRecommendation = avgDaily
        .times(leadTime)
        .plus(safetyStock)
        .minus(current)
        .minus(pending);
      const recommended = rawRecommendation.greaterThan(0) ? rawRecommendation : dec(0);
      const daysRemaining = avgDaily.greaterThan(0)
        ? Math.round((current / avgDaily.toNumber()) * 10) / 10
        : null;
      const explanation =
        avgDaily.greaterThan(0)
          ? `Sells ${avgDaily.toFixed(1)}/day. ${leadTime}-day lead time + ${safetyStock.toFixed(0)} safety stock - ${current.toFixed(0)} on hand - ${pending.toFixed(0)} on order = ${qty(recommended)} to order.`
          : `No sales in the last 30 days. Current stock ${current.toFixed(0)} is at or below the reorder level of ${reorderLevel.toFixed(0)}.`;
      items.push({
        productId: level.productId,
        productName: level.product.name,
        sku: level.product.sku,
        locationId: level.locationId,
        locationName: level.location.name,
        quantity: level.quantity.toFixed(3),
        reorderLevel: level.product.reorderLevel.toFixed(3),
        safetyStock: level.product.safetyStock.toFixed(3),
        averageDailySales: avgDaily.toFixed(3),
        daysRemaining,
        status,
        recommendedOrderQuantity: qty(recommended),
        leadTimeDays: leadTime,
        pendingPurchaseQuantity: qty(pending),
        supplierName: level.product.supplier?.name ?? null,
        explanation,
      });
    }

    const severity: Record<string, number> = { OUT_OF_STOCK: 0, CRITICAL: 1, LOW: 2 };
    items.sort((a, b) => {
      const difference = (severity[a.status] ?? 9) - (severity[b.status] ?? 9);
      if (difference !== 0) return difference;
      return (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999);
    });
    return items.slice(0, query.limit ?? 50);
  }

  async insights(auth: AuthUser, query: LowStockQueryDto) {
    const lowStock = await this.lowStock(auth, { ...query, limit: query.limit ?? 50 });
    const locationIds = await this.scopedLocationIds(auth, query.locationId);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [levels, soldRows] = await Promise.all([
      this.prisma.inventoryLevel.findMany({
        where: {
          businessId: auth.businessId,
          locationId: { in: locationIds },
          product: { deletedAt: null, isActive: true, trackStock: true },
        },
        include: {
          product: { select: { name: true, sku: true, reorderLevel: true, safetyStock: true } },
          location: { select: { name: true } },
        },
      }),
      this.prisma.$queryRaw<Array<{ productId: string; locationId: string; sold: string }>>`
        SELECT si."productId" AS "productId",
               s."locationId" AS "locationId",
               SUM(si.quantity - si."refundedQuantity")::text AS sold
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        WHERE s."businessId" = ${auth.businessId}
          AND s."locationId" = ANY(${locationIds}::text[])
          AND s."createdAt" >= ${since}
        GROUP BY si."productId", s."locationId"
      `,
    ]);
    const soldMap = new Map(soldRows.map((row) => [`${row.locationId}:${row.productId}`, dec(row.sold)]));
    const overstock: Array<Record<string, unknown>> = [];
    const slowMoving: Array<Record<string, unknown>> = [];
    for (const level of levels) {
      const sold = soldMap.get(`${level.locationId}:${level.productId}`) ?? dec(0);
      const avgDaily = sold.dividedBy(30);
      const current = level.quantity.toNumber();
      const base = {
        productId: level.productId,
        productName: level.product.name,
        sku: level.product.sku,
        locationId: level.locationId,
        locationName: level.location.name,
        quantity: level.quantity.toFixed(3),
        soldLast30Days: sold.toFixed(3),
        averageDailySales: avgDaily.toFixed(3),
        reorderLevel: level.product.reorderLevel.toFixed(3),
      };
      if (sold.isZero() && current > 0) {
        slowMoving.push({ ...base, status: 'SLOW_MOVING' });
      } else if (avgDaily.greaterThan(0) && current > avgDaily.times(60).plus(level.product.safetyStock).toNumber()) {
        overstock.push({ ...base, status: 'OVERSTOCK', daysOfCover: Math.round((current / avgDaily.toNumber()) * 10) / 10 });
      }
    }
    return { lowStock, overstock: overstock.slice(0, 50), slowMoving: slowMoving.slice(0, 50) };
  }

  async adjust(auth: AuthUser, dto: AdjustmentDto, actor: AuditActor) {
    const location = await this.access.assertLocation(auth, dto.locationId);
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, businessId: auth.businessId, deletedAt: null },
      select: { id: true, name: true, sku: true, costPrice: true },
    });
    if (!product) throw ApiException.notFound('Product not found.', 'PRODUCT_NOT_FOUND');
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: { allowNegativeStock: true },
    });
    const inbound = ['ADJUSTMENT_IN', 'OPENING_BALANCE'].includes(dto.movementType);
    const magnitude = dec(dto.quantity).abs();
    if (magnitude.isZero()) throw ApiException.badRequest('Adjustment cannot be zero.', 'INVALID_QUANTITY');

    const result = await this.prisma.criticalTransaction(async (tx) => {
      const movement = await this.ledger.apply(
        tx,
        {
          businessId: auth.businessId,
          locationId: location.id,
          productId: product.id,
          movementType: dto.movementType,
          quantity: (inbound ? magnitude : magnitude.negated()).toFixed(3),
          unitCost: product.costPrice,
          performedBy: auth.id,
          reason: dto.reason,
          referenceType: 'ADJUSTMENT',
        },
        { allowNegative: business.allowNegativeStock },
      );
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: AUDIT_ACTIONS.STOCK_ADJUSTED,
          entityType: 'Product',
          entityId: product.id,
          actor,
          before: { quantity: movement.previousQuantity },
          after: { quantity: movement.balanceAfter },
          reason: `${dto.movementType}: ${dto.reason}`,
          metadata: { locationId: location.id, movementId: movement.movementId },
        },
        tx,
      );
      return movement;
    });
    return {
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      locationId: location.id,
      movementType: dto.movementType,
      previousQuantity: result.previousQuantity,
      balanceAfter: result.balanceAfter,
    };
  }

  async reconcile(auth: AuthUser, dto: ReconciliationDto, actor: AuditActor) {
    const location = await this.access.assertLocation(auth, dto.locationId);
    const ids = dto.counts.map((count) => count.productId);
    if (new Set(ids).size !== ids.length) {
      throw ApiException.badRequest('Each product may only appear once in a stock count.', 'DUPLICATE_COUNT');
    }
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, businessId: auth.businessId, deletedAt: null },
      select: { id: true, name: true, sku: true, costPrice: true },
    });
    if (products.length !== ids.length) {
      throw ApiException.badRequest('One or more products were not found.', 'PRODUCT_NOT_FOUND');
    }
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: { allowNegativeStock: true },
    });

    const adjusted = await this.prisma.criticalTransaction(async (tx) => {
      const results: Array<Record<string, string>> = [];
      for (const count of dto.counts) {
        const product = products.find((entry) => entry.id === count.productId)!;
        const level = await tx.inventoryLevel.upsert({
          where: { locationId_productId: { locationId: location.id, productId: product.id } },
          create: {
            businessId: auth.businessId,
            locationId: location.id,
            productId: product.id,
            quantity: '0.000',
          },
          update: {},
        });
        const counted = dec(count.countedQuantity);
        const variance = counted.minus(level.quantity);
        if (variance.isZero()) {
          results.push({
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            previousQuantity: level.quantity.toFixed(3),
            countedQuantity: counted.toFixed(3),
            variance: '0.000',
          });
          continue;
        }
        const movementType = variance.greaterThan(0) ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
        const applied = await this.ledger.apply(
          tx,
          {
            businessId: auth.businessId,
            locationId: location.id,
            productId: product.id,
            movementType,
            quantity: variance.toFixed(3),
            unitCost: product.costPrice,
            performedBy: auth.id,
            reason: dto.reason,
            referenceType: 'RECONCILIATION',
          },
          { allowNegative: business.allowNegativeStock },
        );
        await this.audit.record(
          {
            businessId: auth.businessId,
            action: AUDIT_ACTIONS.STOCK_RECONCILED,
            entityType: 'Product',
            entityId: product.id,
            actor,
            before: { quantity: applied.previousQuantity },
            after: { quantity: applied.balanceAfter, countedQuantity: counted.toFixed(3) },
            reason: dto.reason,
            metadata: { locationId: location.id, variance: variance.toFixed(3) },
          },
          tx,
        );
        results.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          previousQuantity: applied.previousQuantity,
          countedQuantity: counted.toFixed(3),
          variance: variance.toFixed(3),
        });
      }
      return results;
    });
    return {
      locationId: location.id,
      locationName: location.name,
      adjustedCount: adjusted.filter((row) => row.variance !== '0.000').length,
      items: adjusted,
    };
  }

  async exportCsv(auth: AuthUser, type: 'levels' | 'movements', query: MovementQueryDto) {
    if (type === 'levels') {
      const locationIds = await this.scopedLocationIds(auth, query.locationId);
      const levels = await this.prisma.inventoryLevel.findMany({
        where: {
          businessId: auth.businessId,
          locationId: { in: locationIds },
          product: { deletedAt: null, ...(query.search ? { OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { sku: { contains: query.search, mode: 'insensitive' } },
          ] } : {}) },
        },
        include: { product: { include: { category: { select: { name: true } } } }, location: { select: { name: true } } },
        orderBy: { product: { name: 'asc' } },
        take: 5000,
      });
      const csv = toCsv(
        ['product', 'sku', 'category', 'location', 'quantity', 'reorder_level', 'safety_stock', 'unit_cost', 'value', 'status'],
        levels.map((level) => [
          level.product.name,
          level.product.sku,
          level.product.category?.name ?? '',
          level.location.name,
          level.quantity.toFixed(3),
          level.product.reorderLevel.toFixed(3),
          level.product.safetyStock.toFixed(3),
          level.product.costPrice.toFixed(2),
          money(level.quantity.times(level.product.costPrice)),
          statusOf(
            level.quantity.toNumber(),
            level.product.reorderLevel.toNumber(),
            level.product.safetyStock.toNumber(),
          ),
        ]),
      );
      return { filename: `inventory-${new Date().toISOString().slice(0, 10)}.csv`, contentType: 'text/csv; charset=utf-8', content: csv };
    }

    const locationIds = await this.scopedLocationIds(auth, query.locationId);
    const rows = await this.prisma.inventoryMovement.findMany({
      where: { businessId: auth.businessId, locationId: { in: locationIds } },
      include: { product: { select: { name: true, sku: true } }, location: { select: { name: true } }, user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const csv = toCsv(
      ['date', 'product', 'sku', 'location', 'type', 'quantity', 'unit_cost', 'balance_after', 'reference', 'performed_by', 'reason'],
      rows.map((movement) => [
        movement.createdAt.toISOString(),
        movement.product.name,
        movement.product.sku,
        movement.location.name,
        movement.movementType,
        movement.quantity.toFixed(3),
        movement.unitCost.toFixed(2),
        movement.balanceAfter.toFixed(3),
        movement.referenceType ?? '',
        movement.user?.name ?? '',
        movement.reason ?? '',
      ]),
    );
    return { filename: `stock-movements-${new Date().toISOString().slice(0, 10)}.csv`, contentType: 'text/csv; charset=utf-8', content: csv };
  }
}
