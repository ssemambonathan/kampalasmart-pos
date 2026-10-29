import { Injectable } from '@nestjs/common';
import { Prisma, PurchaseStatus } from '@prisma/client';
import { dec, money, type Decimal } from '@kampalasmart/shared';
import type { Purchase as PurchaseDto } from '@kampalasmart/shared';
import { AuditService, type AuditActor } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryLedgerService } from '../../common/inventory/inventory-ledger.service';
import { AccessService } from '../../common/access/access.service';
import { DocumentNumberService } from '../../common/documents/document-number.service';
import { ApiException } from '../../common/errors/api-exception';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { toCsv } from '../../common/csv';
import type { AuthUser } from '../../common/auth/auth-user';
import type {
  CreatePurchaseDto,
  CreatePurchaseReturnDto,
  PurchaseQueryDto,
  ReceivePurchaseDto,
  UpdatePurchaseDto,
} from './purchases.dto';

const purchaseInclude = {
  supplier: { select: { name: true } },
  location: { select: { name: true } },
  creator: { select: { name: true } },
  items: {
    include: { product: { select: { name: true, sku: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.PurchaseInclude;

type PurchaseWithRelations = Prisma.PurchaseGetPayload<{ include: typeof purchaseInclude }>;

function toPurchaseDto(purchase: PurchaseWithRelations): PurchaseDto {
  return {
    id: purchase.id,
    purchaseNumber: purchase.purchaseNumber,
    supplierId: purchase.supplierId,
    supplierName: purchase.supplier.name,
    locationId: purchase.locationId,
    locationName: purchase.location.name,
    status: purchase.status,
    reference: purchase.reference,
    subtotal: purchase.subtotal.toFixed(2),
    taxTotal: purchase.taxTotal.toFixed(2),
    total: purchase.total.toFixed(2),
    notes: purchase.notes,
    items: purchase.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      sku: item.product.sku,
      quantity: item.quantity.toFixed(3),
      receivedQuantity: item.receivedQuantity.toFixed(3),
      unitCost: item.unitCost.toFixed(2),
      lineTotal: item.lineTotal.toFixed(2),
    })),
    createdByName: purchase.creator?.name ?? null,
    createdAt: purchase.createdAt.toISOString(),
    receivedAt: purchase.receivedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: InventoryLedgerService,
    private readonly access: AccessService,
    private readonly documents: DocumentNumberService,
  ) {}

  async list(auth: AuthUser, query: PurchaseQueryDto) {
    const { skip, take } = skipTake(query);
    const where: Prisma.PurchaseWhereInput = {
      businessId: auth.businessId,
      ...(query.status ? { status: query.status as PurchaseStatus } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.search
        ? {
            OR: [
              { purchaseNumber: { contains: query.search, mode: 'insensitive' } },
              { reference: { contains: query.search, mode: 'insensitive' } },
              { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
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
    if (!this.access.isPrivileged(auth.role)) {
      where.locationId = query.locationId
        ? query.locationId
        : { in: auth.locationIds.length ? auth.locationIds : ['__none__'] };
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchase.findMany({
        where,
        include: purchaseInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.purchase.count({ where }),
    ]);
    return paginate(rows.map(toPurchaseDto), total, query);
  }

  async get(auth: AuthUser, id: string) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, businessId: auth.businessId },
      include: purchaseInclude,
    });
    if (!purchase) throw ApiException.notFound('Purchase not found.', 'PURCHASE_NOT_FOUND');
    if (!this.access.isPrivileged(auth.role) && !auth.locationIds.includes(purchase.locationId)) {
      throw ApiException.forbidden('You are not assigned to this branch.', 'LOCATION_FORBIDDEN');
    }
    const returns = await this.prisma.purchaseReturn.findMany({
      where: { businessId: auth.businessId, purchaseId: id },
      include: {
        items: { include: { product: { select: { name: true, sku: true } } } },
        creator: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      ...toPurchaseDto(purchase),
      returns: returns.map((row) => ({
        id: row.id,
        returnNumber: row.returnNumber,
        reason: row.reason,
        total: row.total.toFixed(2),
        createdByName: row.creator?.name ?? null,
        createdAt: row.createdAt.toISOString(),
        items: row.items.map((item) => ({
          id: item.id,
          productName: item.product.name,
          sku: item.product.sku,
          quantity: item.quantity.toFixed(3),
          unitCost: item.unitCost.toFixed(2),
          lineTotal: item.lineTotal.toFixed(2),
        })),
      })),
    };
  }

  async create(auth: AuthUser, dto: CreatePurchaseDto, actor: AuditActor) {
    const location = await this.access.resolveLocation(auth, dto.locationId ?? null);
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, businessId: auth.businessId, deletedAt: null },
      select: { id: true, name: true, isActive: true },
    });
    if (!supplier) throw ApiException.badRequest('Supplier not found.', 'INVALID_SUPPLIER');
    if (!supplier.isActive) {
      throw ApiException.badRequest('This supplier is archived.', 'SUPPLIER_INACTIVE');
    }
    const lines = await this.buildLines(auth.businessId, dto.items);
    const taxRate = dec(dto.taxRatePercent ?? 0);
    if (taxRate.isNegative() || taxRate.greaterThan(100)) {
      throw ApiException.badRequest('Tax rate must be between 0 and 100.', 'INVALID_TAX_RATE');
    }
    const subtotal = lines.reduce((acc, line) => acc.plus(line.lineTotal), dec(0));
    const taxTotal = money(subtotal.times(taxRate).dividedBy(100));
    const total = money(subtotal.plus(taxTotal));

    const created = await this.prisma.criticalTransaction(async (tx) => {
      const purchaseNumber = await this.documents.next(tx, auth.businessId, 'PURCHASE');
      const purchase = await tx.purchase.create({
        data: {
          businessId: auth.businessId,
          locationId: location.id,
          supplierId: supplier.id,
          purchaseNumber,
          status: 'ORDERED',
          reference: dto.reference ?? null,
          subtotal: money(subtotal),
          taxTotal,
          total,
          notes: dto.notes ?? null,
          createdBy: auth.id,
          items: {
            create: lines.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              unitCost: line.unitCost,
              lineTotal: line.lineTotal,
            })),
          },
        },
        include: purchaseInclude,
      });
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'purchase.created',
          entityType: 'Purchase',
          entityId: purchase.id,
          actor,
          after: {
            purchaseNumber,
            supplierName: supplier.name,
            locationName: location.name,
            total,
            taxRatePercent: taxRate.toFixed(3),
            items: lines.length,
          },
        },
        tx,
      );
      return purchase;
    });
    return toPurchaseDto(created);
  }

  async update(auth: AuthUser, id: string, dto: UpdatePurchaseDto, actor: AuditActor) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, businessId: auth.businessId },
      include: { items: true },
    });
    if (!purchase) throw ApiException.notFound('Purchase not found.', 'PURCHASE_NOT_FOUND');
    if (!this.access.isPrivileged(auth.role) && !auth.locationIds.includes(purchase.locationId)) {
      throw ApiException.forbidden('You are not assigned to this branch.', 'LOCATION_FORBIDDEN');
    }
    if (purchase.status !== 'ORDERED' || purchase.items.some((item) => !dec(item.receivedQuantity).isZero())) {
      throw ApiException.conflict(
        'Only orders that have not been received can be edited. Record a return or adjustment instead.',
        'PURCHASE_LOCKED',
      );
    }
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.count({
        where: { id: dto.supplierId, businessId: auth.businessId, deletedAt: null },
      });
      if (!supplier) throw ApiException.badRequest('Supplier not found.', 'INVALID_SUPPLIER');
    }
    const updated = await this.prisma.purchase.update({
      where: { id },
      data: {
        ...(dto.supplierId ? { supplierId: dto.supplierId } : {}),
        ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
      include: purchaseInclude,
    });
    await this.audit.record({
      businessId: auth.businessId,
      action: 'purchase.updated',
      entityType: 'Purchase',
      entityId: id,
      actor,
      before: { supplierId: purchase.supplierId, reference: purchase.reference, notes: purchase.notes },
      after: { supplierId: updated.supplierId, reference: updated.reference, notes: updated.notes },
    });
    return toPurchaseDto(updated);
  }

  async receive(auth: AuthUser, id: string, dto: ReceivePurchaseDto, actor: AuditActor) {
    const created = await this.prisma.criticalTransaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({
        where: { id, businessId: auth.businessId },
        include: {
          items: { include: { product: { select: { id: true, name: true, sku: true, costPrice: true } } } },
          supplier: { select: { name: true } },
        },
      });
      if (!purchase) throw ApiException.notFound('Purchase not found.', 'PURCHASE_NOT_FOUND');
      if (!this.access.isPrivileged(auth.role) && !auth.locationIds.includes(purchase.locationId)) {
        throw ApiException.forbidden('You are not assigned to this branch.', 'LOCATION_FORBIDDEN');
      }
      if (purchase.status === 'CANCELLED') {
        throw ApiException.conflict('A cancelled order cannot receive stock.', 'PURCHASE_CANCELLED');
      }
      if (purchase.status === 'RECEIVED') {
        throw ApiException.conflict('This order has already been fully received.', 'PURCHASE_ALREADY_RECEIVED');
      }
      const seen = new Set<string>();
      const receipts = dto.items.map((entry) => {
        if (seen.has(entry.purchaseItemId)) {
          throw ApiException.badRequest('An item appears more than once in the receipt.', 'DUPLICATE_ITEM');
        }
        seen.add(entry.purchaseItemId);
        const item = purchase.items.find((row) => row.id === entry.purchaseItemId);
        if (!item) throw ApiException.badRequest('A receipt line does not belong to this order.', 'INVALID_ITEM');
        const quantity = dec(entry.quantity);
        if (quantity.isZero() || quantity.isNegative() || quantity.decimalPlaces() > 3) {
          throw ApiException.badRequest('Received quantity must be greater than zero.', 'INVALID_QUANTITY');
        }
        const remaining = dec(item.quantity).minus(item.receivedQuantity);
        if (quantity.greaterThan(remaining)) {
          throw ApiException.conflict(
            `Cannot receive ${quantity.toFixed(3)} of ${item.product.name}; only ${remaining.toFixed(3)} remains.`,
            'OVER_RECEIPT',
            { purchaseItemId: item.id, remaining: remaining.toFixed(3) },
          );
        }
        return { item, quantity };
      });

      const receivedLines: Array<{ productId: string; name: string; quantity: string; balance: string }> = [];
      for (const receipt of receipts) {
        const applied = await this.ledger.apply(tx, {
          businessId: auth.businessId,
          locationId: purchase.locationId,
          productId: receipt.item.productId,
          movementType: 'PURCHASE',
          quantity: receipt.quantity.toFixed(3),
          unitCost: receipt.item.unitCost,
          referenceType: 'PURCHASE',
          referenceId: purchase.id,
          performedBy: auth.id,
          reason: `Received on ${purchase.purchaseNumber}`,
        });
        await tx.purchaseItem.update({
          where: { id: receipt.item.id },
          data: {
            receivedQuantity: dec(receipt.item.receivedQuantity).plus(receipt.quantity).toFixed(3),
          },
        });
        receivedLines.push({
          productId: receipt.item.productId,
          name: receipt.item.product.name,
          quantity: receipt.quantity.toFixed(3),
          balance: applied.balanceAfter,
        });

        // Keep the product's replacement cost current; historical sale costs
        // are snapshotted on each sale line, so past profit is unaffected.
        if (!dec(receipt.item.product.costPrice).equals(receipt.item.unitCost)) {
          await tx.product.update({
            where: { id: receipt.item.productId },
            data: { costPrice: money(receipt.item.unitCost) },
          });
          await this.audit.record(
            {
              businessId: auth.businessId,
              action: 'product.cost_changed',
              entityType: 'Product',
              entityId: receipt.item.productId,
              actor,
              before: { costPrice: receipt.item.product.costPrice.toFixed(2) },
              after: { costPrice: money(receipt.item.unitCost) },
              reason: `Cost updated from receipt on ${purchase.purchaseNumber}`,
            },
            tx,
          );
        }
      }

      const refreshed = await tx.purchaseItem.findMany({ where: { purchaseId: purchase.id } });
      const fullyReceived = refreshed.every((item) =>
        dec(item.receivedQuantity).greaterThanOrEqualTo(item.quantity),
      );
      const anyReceived = refreshed.some((item) => dec(item.receivedQuantity).greaterThan(0));
      const status: PurchaseStatus = fullyReceived
        ? 'RECEIVED'
        : anyReceived
          ? 'PARTIALLY_RECEIVED'
          : 'ORDERED';
      const updated = await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          status,
          receivedAt: fullyReceived ? new Date() : null,
          ...(dto.note ? { notes: purchase.notes ? `${purchase.notes}\n${dto.note}` : dto.note } : {}),
        },
        include: purchaseInclude,
      });
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'purchase.received',
          entityType: 'Purchase',
          entityId: purchase.id,
          actor,
          before: { status: purchase.status },
          after: { status, receivedLines, note: dto.note ?? null },
        },
        tx,
      );
      return updated;
    });
    return toPurchaseDto(created);
  }

  async cancel(auth: AuthUser, id: string, actor: AuditActor) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, businessId: auth.businessId },
      include: { items: true },
    });
    if (!purchase) throw ApiException.notFound('Purchase not found.', 'PURCHASE_NOT_FOUND');
    if (!this.access.isPrivileged(auth.role) && !auth.locationIds.includes(purchase.locationId)) {
      throw ApiException.forbidden('You are not assigned to this branch.', 'LOCATION_FORBIDDEN');
    }
    if (purchase.status === 'CANCELLED') return toPurchaseDto(
      await this.prisma.purchase.findUniqueOrThrow({ where: { id }, include: purchaseInclude }),
    );
    if (purchase.status !== 'ORDERED' || purchase.items.some((item) => !dec(item.receivedQuantity).isZero())) {
      throw ApiException.conflict(
        'Stock has already been received. Record a purchase return instead of cancelling.',
        'PURCHASE_HAS_RECEIPTS',
      );
    }
    const updated = await this.prisma.purchase.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: purchaseInclude,
    });
    await this.audit.record({
      businessId: auth.businessId,
      action: 'purchase.cancelled',
      entityType: 'Purchase',
      entityId: id,
      actor,
      before: { status: purchase.status },
      after: { status: 'CANCELLED' },
      reason: 'Order cancelled before any stock was received',
    });
    return toPurchaseDto(updated);
  }

  async createReturn(auth: AuthUser, id: string, dto: CreatePurchaseReturnDto, actor: AuditActor) {
    const created = await this.prisma.criticalTransaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({
        where: { id, businessId: auth.businessId },
        include: {
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
          supplier: { select: { id: true, name: true } },
        },
      });
      if (!purchase) throw ApiException.notFound('Purchase not found.', 'PURCHASE_NOT_FOUND');
      if (!this.access.isPrivileged(auth.role) && !auth.locationIds.includes(purchase.locationId)) {
        throw ApiException.forbidden('You are not assigned to this branch.', 'LOCATION_FORBIDDEN');
      }
      if (purchase.status !== 'RECEIVED' && purchase.status !== 'PARTIALLY_RECEIVED') {
        throw ApiException.conflict('Only received stock can be returned to a supplier.', 'PURCHASE_NOT_RECEIVED');
      }
      const priorReturns = await tx.purchaseReturn.findMany({
        where: { purchaseId: purchase.id, businessId: auth.businessId },
        include: { items: { select: { productId: true, quantity: true } } },
      });
      const alreadyReturned = new Map<string, Decimal>();
      for (const row of priorReturns) {
        for (const item of row.items) {
          alreadyReturned.set(
            item.productId,
            (alreadyReturned.get(item.productId) ?? dec(0)).plus(item.quantity),
          );
        }
      }
      const seen = new Set<string>();
      const lines = dto.items.map((entry) => {
        if (seen.has(entry.purchaseItemId)) {
          throw ApiException.badRequest('An item appears more than once in the return.', 'DUPLICATE_ITEM');
        }
        seen.add(entry.purchaseItemId);
        const item = purchase.items.find((row) => row.id === entry.purchaseItemId);
        if (!item) throw ApiException.badRequest('A return line does not belong to this order.', 'INVALID_ITEM');
        const quantity = dec(entry.quantity);
        if (quantity.isZero() || quantity.isNegative() || quantity.decimalPlaces() > 3) {
          throw ApiException.badRequest('Return quantity must be greater than zero.', 'INVALID_QUANTITY');
        }
        const available = dec(item.receivedQuantity).minus(alreadyReturned.get(item.productId) ?? 0);
        if (quantity.greaterThan(available)) {
          throw ApiException.conflict(
            `Cannot return ${quantity.toFixed(3)} of ${item.product.name}; only ${available.toFixed(3)} remains from this order.`,
            'RETURN_EXCEEDS_RECEIVED',
            { purchaseItemId: item.id, available: available.toFixed(3) },
          );
        }
        return { item, quantity, lineTotal: money(quantity.times(item.unitCost)) };
      });
      const total = money(lines.reduce((acc, line) => acc.plus(line.lineTotal), dec(0)));
      const returnNumber = await this.documents.next(tx, auth.businessId, 'PURCHASE_RETURN');
      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          businessId: auth.businessId,
          purchaseId: purchase.id,
          locationId: purchase.locationId,
          supplierId: purchase.supplierId,
          returnNumber,
          reason: dto.reason.trim(),
          total,
          createdBy: auth.id,
          items: {
            create: lines.map((line) => ({
              productId: line.item.productId,
              quantity: line.quantity.toFixed(3),
              unitCost: line.item.unitCost,
              lineTotal: line.lineTotal,
            })),
          },
        },
      });
      for (const line of lines) {
        await this.ledger.apply(tx, {
          businessId: auth.businessId,
          locationId: purchase.locationId,
          productId: line.item.productId,
          movementType: 'PURCHASE_RETURN',
          quantity: line.quantity.negated().toFixed(3),
          unitCost: line.item.unitCost,
          referenceType: 'PURCHASE_RETURN',
          referenceId: purchaseReturn.id,
          performedBy: auth.id,
          reason: `Returned to supplier: ${dto.reason.trim()}`,
        });
      }
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'purchase.returned',
          entityType: 'Purchase',
          entityId: purchase.id,
          actor,
          after: {
            returnNumber,
            supplierName: purchase.supplier.name,
            total,
            reason: dto.reason.trim(),
            items: lines.map((line) => ({
              sku: line.item.product.sku,
              quantity: line.quantity.toFixed(3),
              unitCost: line.item.unitCost.toFixed(2),
            })),
          },
        },
        tx,
      );
      return { returnNumber, total, lines: lines.length };
    });
    return created;
  }

  async listReturns(auth: AuthUser, query: PurchaseQueryDto) {
    const { skip, take } = skipTake(query);
    const where: Prisma.PurchaseReturnWhereInput = {
      businessId: auth.businessId,
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.search
        ? {
            OR: [
              { returnNumber: { contains: query.search, mode: 'insensitive' } },
              { reason: { contains: query.search, mode: 'insensitive' } },
              { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
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
    if (!this.access.isPrivileged(auth.role)) {
      where.locationId = { in: auth.locationIds.length ? auth.locationIds : ['__none__'] };
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchaseReturn.findMany({
        where,
        include: {
          supplier: { select: { name: true } },
          location: { select: { name: true } },
          creator: { select: { name: true } },
          items: { include: { product: { select: { name: true, sku: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.purchaseReturn.count({ where }),
    ]);
    return paginate(
      rows.map((row) => ({
        id: row.id,
        returnNumber: row.returnNumber,
        purchaseId: row.purchaseId,
        supplierName: row.supplier.name,
        locationName: row.location.name,
        reason: row.reason,
        total: row.total.toFixed(2),
        createdByName: row.creator?.name ?? null,
        createdAt: row.createdAt.toISOString(),
        items: row.items.map((item) => ({
          id: item.id,
          productName: item.product.name,
          sku: item.product.sku,
          quantity: item.quantity.toFixed(3),
          unitCost: item.unitCost.toFixed(2),
          lineTotal: item.lineTotal.toFixed(2),
        })),
      })),
      total,
      query,
    );
  }

  async exportCsv(auth: AuthUser, query: PurchaseQueryDto) {
    const where: Prisma.PurchaseWhereInput = {
      businessId: auth.businessId,
      ...(query.status ? { status: query.status as PurchaseStatus } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
    };
    if (!this.access.isPrivileged(auth.role)) {
      where.locationId = { in: auth.locationIds.length ? auth.locationIds : ['__none__'] };
    }
    const rows = await this.prisma.purchase.findMany({
      where,
      include: {
        supplier: { select: { name: true } },
        location: { select: { name: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const csv = toCsv(
      [
        'purchase_number',
        'status',
        'supplier',
        'location',
        'reference',
        'sku',
        'product',
        'quantity',
        'received_quantity',
        'unit_cost',
        'line_total',
        'subtotal',
        'tax_total',
        'total',
        'created_at',
        'received_at',
      ],
      rows.flatMap((purchase) =>
        purchase.items.map((item) => [
          purchase.purchaseNumber,
          purchase.status,
          purchase.supplier.name,
          purchase.location.name,
          purchase.reference ?? '',
          item.product.sku,
          item.product.name,
          item.quantity.toFixed(3),
          item.receivedQuantity.toFixed(3),
          item.unitCost.toFixed(2),
          item.lineTotal.toFixed(2),
          purchase.subtotal.toFixed(2),
          purchase.taxTotal.toFixed(2),
          purchase.total.toFixed(2),
          purchase.createdAt.toISOString(),
          purchase.receivedAt?.toISOString() ?? '',
        ]),
      ),
    );
    return {
      filename: `purchases-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: 'text/csv; charset=utf-8',
      content: csv,
    };
  }

  private async buildLines(businessId: string, inputs: CreatePurchaseDto['items']) {
    const seen = new Set<string>();
    const ids = inputs.map((input) => {
      if (seen.has(input.productId)) {
        throw ApiException.badRequest('A product appears more than once on this order.', 'DUPLICATE_PRODUCT');
      }
      seen.add(input.productId);
      return input.productId;
    });
    const products = await this.prisma.product.findMany({
      where: { businessId, id: { in: ids }, deletedAt: null },
      select: { id: true, name: true },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    return inputs.map((input) => {
      const product = byId.get(input.productId);
      if (!product) {
        throw ApiException.badRequest(`Product ${input.productId} was not found.`, 'INVALID_PRODUCT');
      }
      const quantity = dec(input.quantity);
      if (quantity.isZero() || quantity.isNegative() || quantity.decimalPlaces() > 3) {
        throw ApiException.badRequest(`Quantity for ${product.name} must be greater than zero.`, 'INVALID_QUANTITY');
      }
      const unitCost = dec(input.unitCost);
      if (unitCost.isNegative() || unitCost.decimalPlaces() > 2) {
        throw ApiException.badRequest(`Unit cost for ${product.name} is invalid.`, 'INVALID_COST');
      }
      return {
        productId: product.id,
        name: product.name,
        quantity: quantity.toFixed(3),
        unitCost: money(unitCost),
        lineTotal: money(quantity.times(unitCost)),
      };
    });
  }
}
