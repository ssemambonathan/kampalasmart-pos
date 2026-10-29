import { Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma, RefundStatus } from '@prisma/client';
import {
  PERMISSIONS,
  dec,
  money,
  type Decimal,
  type Refund as RefundDto,
} from '@kampalasmart/shared';
import { AuditService, type AuditActor } from '../../common/audit/audit.service';
import { PrismaService, type Tx } from '../../common/prisma/prisma.service';
import { InventoryLedgerService } from '../../common/inventory/inventory-ledger.service';
import { AccessService } from '../../common/access/access.service';
import { DocumentNumberService } from '../../common/documents/document-number.service';
import { ApiException } from '../../common/errors/api-exception';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import type { AuthUser } from '../../common/auth/auth-user';
import type { CreateRefundDto, RefundQueryDto, RejectRefundDto } from './refunds.dto';

const refundInclude = {
  sale: { select: { saleNumber: true } },
  requester: { select: { name: true } },
  approver: { select: { name: true } },
  items: { include: { saleItem: true } },
} satisfies Prisma.RefundInclude;

type RefundWithRelations = Prisma.RefundGetPayload<{ include: typeof refundInclude }>;

function toRefundDto(refund: RefundWithRelations): RefundDto {
  return {
    id: refund.id,
    refundNumber: refund.refundNumber,
    saleId: refund.saleId,
    saleNumber: refund.sale.saleNumber,
    reason: refund.reason,
    status: refund.status,
    total: refund.total.toFixed(2),
    requestedByName: refund.requester?.name ?? null,
    approvedByName: refund.approver?.name ?? null,
    approvedAt: refund.approvedAt?.toISOString() ?? null,
    createdAt: refund.createdAt.toISOString(),
    items: refund.items.map((item) => ({
      id: item.id,
      saleItemId: item.saleItemId,
      productName: item.saleItem.productName,
      sku: item.saleItem.sku,
      quantity: item.quantity.toFixed(3),
      amount: item.amount.toFixed(2),
      restock: item.restock,
    })),
  };
}

@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: InventoryLedgerService,
    private readonly access: AccessService,
    private readonly documents: DocumentNumberService,
  ) {}

  async list(auth: AuthUser, query: RefundQueryDto) {
    const { skip, take } = skipTake(query);
    const where: Prisma.RefundWhereInput = {
      businessId: auth.businessId,
      ...(query.status ? { status: query.status as RefundStatus } : {}),
      ...(query.saleId ? { saleId: query.saleId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.search
        ? {
            OR: [
              { refundNumber: { contains: query.search, mode: 'insensitive' } },
              { reason: { contains: query.search, mode: 'insensitive' } },
              { sale: { saleNumber: { contains: query.search, mode: 'insensitive' } } },
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
      where.locationId = query.locationId && auth.locationIds.includes(query.locationId)
        ? query.locationId
        : { in: auth.locationIds.length ? auth.locationIds : ['__none__'] };
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.refund.findMany({
        where,
        include: refundInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.refund.count({ where }),
    ]);
    return paginate(rows.map(toRefundDto), total, query);
  }

  async get(auth: AuthUser, id: string): Promise<RefundDto> {
    const refund = await this.prisma.refund.findFirst({
      where: { id, businessId: auth.businessId },
      include: refundInclude,
    });
    if (!refund) throw ApiException.notFound('Refund not found.', 'REFUND_NOT_FOUND');
    if (!this.access.isPrivileged(auth.role) && !auth.locationIds.includes(refund.locationId)) {
      throw ApiException.forbidden('You are not assigned to this branch.', 'LOCATION_FORBIDDEN');
    }
    return toRefundDto(refund);
  }

  async request(auth: AuthUser, dto: CreateRefundDto, actor: AuditActor) {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.refund.findFirst({
        where: { businessId: auth.businessId, idempotencyKey: dto.idempotencyKey },
        select: { id: true },
      });
      if (existing) {
        const detail = await this.get(auth, existing.id);
        return { ...detail, autoCompleted: false };
      }
    }

    let summary: { id: string; autoCompleted: boolean };
    try {
      summary = await this.prisma
        .criticalTransaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: dto.saleId, businessId: auth.businessId },
        include: {
          items: true,
          payments: { orderBy: { amount: 'desc' } },
        },
      });
      if (!sale) throw ApiException.notFound('Sale not found.', 'SALE_NOT_FOUND');
      if (!this.access.isPrivileged(auth.role) && !auth.locationIds.includes(sale.locationId)) {
        throw ApiException.forbidden('You are not assigned to this branch.', 'LOCATION_FORBIDDEN');
      }
      if (sale.status === 'REFUNDED') {
        throw ApiException.conflict('This sale has already been fully refunded.', 'SALE_FULLY_REFUNDED');
      }
      const business = await tx.business.findUniqueOrThrow({ where: { id: auth.businessId } });

      const [openRefunds, completedRefunds] = await Promise.all([
        tx.refund.findMany({
          where: { saleId: sale.id, status: { in: ['PENDING', 'APPROVED'] } },
          include: { items: { select: { saleItemId: true, quantity: true } } },
        }),
        tx.refund.findMany({
          where: { saleId: sale.id, status: 'COMPLETED' },
          include: { items: { select: { saleItemId: true, amount: true } } },
        }),
      ]);
      const reserved = new Map<string, Decimal>();
      for (const refund of openRefunds) {
        for (const item of refund.items) {
          reserved.set(item.saleItemId, (reserved.get(item.saleItemId) ?? dec(0)).plus(item.quantity));
        }
      }
      const refundedAmount = new Map<string, Decimal>();
      for (const refund of completedRefunds) {
        for (const item of refund.items) {
          refundedAmount.set(item.saleItemId, (refundedAmount.get(item.saleItemId) ?? dec(0)).plus(item.amount));
        }
      }

      const seen = new Set<string>();
      const lines = dto.items.map((input) => {
        if (seen.has(input.saleItemId)) {
          throw ApiException.badRequest('A sale line appears more than once in the refund.', 'DUPLICATE_ITEM');
        }
        seen.add(input.saleItemId);
        const saleItem = sale.items.find((item) => item.id === input.saleItemId);
        if (!saleItem) {
          throw ApiException.badRequest('A refund line does not belong to this sale.', 'INVALID_SALE_ITEM');
        }
        const quantity = dec(input.quantity);
        if (quantity.isZero() || quantity.isNegative() || quantity.decimalPlaces() > 3) {
          throw ApiException.badRequest('Refund quantity must be greater than zero.', 'INVALID_QUANTITY');
        }
        const reservedQuantity = reserved.get(saleItem.id) ?? dec(0);
        const available = dec(saleItem.quantity).minus(saleItem.refundedQuantity).minus(reservedQuantity);
        if (quantity.greaterThan(available)) {
          throw ApiException.conflict(
            `Only ${available.toFixed(3)} of ${saleItem.productName} can still be refunded.`,
            'REFUND_EXCEEDS_SOLD',
            { saleItemId: saleItem.id, available: available.toFixed(3) },
          );
        }
        const isFinalChunk = quantity.equals(available) && reservedQuantity.isZero();
        const amount = isFinalChunk
          ? dec(saleItem.lineTotal).minus(refundedAmount.get(saleItem.id) ?? 0)
          : dec(saleItem.lineTotal).times(quantity).dividedBy(saleItem.quantity);
        const tax = dec(saleItem.taxAmount).times(quantity).dividedBy(saleItem.quantity);
        const cost = dec(saleItem.totalCost).times(quantity).dividedBy(saleItem.quantity);
        return {
          saleItem,
          quantity,
          amount: money(amount),
          tax: money(tax),
          cost: money(cost),
          restock: dto.restock !== false,
        };
      });

      const total = money(lines.reduce((acc, line) => acc.plus(line.amount), dec(0)));
      if (dec(total).isZero() || dec(total).isNegative()) {
        throw ApiException.badRequest('There is no refundable value on the selected lines.', 'NOTHING_TO_REFUND');
      }
      const taxTotal = money(lines.reduce((acc, line) => acc.plus(line.tax), dec(0)));
      const costTotal = money(lines.reduce((acc, line) => acc.plus(line.cost), dec(0)));
      const refundNumber = await this.documents.next(tx, auth.businessId, 'REFUND');
      const method = (dto.method ?? sale.payments[0]?.method ?? 'CASH') as PaymentMethod;

      const created = await tx.refund.create({
        data: {
          businessId: auth.businessId,
          saleId: sale.id,
          locationId: sale.locationId,
          refundNumber,
          reason: dto.reason.trim(),
          status: 'PENDING',
          total,
          taxTotal,
          costTotal,
          method,
          reference: dto.reference ?? null,
          restock: dto.restock !== false,
          requestedBy: auth.id,
          idempotencyKey: dto.idempotencyKey ?? null,
          items: {
            create: lines.map((line) => ({
              saleItemId: line.saleItem.id,
              productId: line.saleItem.productId,
              quantity: line.quantity.toFixed(3),
              amount: line.amount,
              restock: line.restock,
            })),
          },
        },
        include: refundInclude,
      });

      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'refund.requested',
          entityType: 'Refund',
          entityId: created.id,
          actor,
          after: {
            refundNumber,
            saleNumber: sale.saleNumber,
            total,
            method,
            restock: dto.restock !== false,
            reason: dto.reason.trim(),
            lines: lines.map((line) => ({
              sku: line.saleItem.sku,
              quantity: line.quantity.toFixed(3),
              amount: line.amount,
            })),
          },
        },
        tx,
      );

      const canApprove = auth.permissions.includes(PERMISSIONS.REFUNDS_APPROVE);
      const withinThreshold = dec(total).lessThanOrEqualTo(business.refundApprovalThreshold);
      if (canApprove && (auth.role === 'OWNER' || withinThreshold)) {
        await this.applyCompletion(tx, created, auth, actor, { auto: true });
        return { id: created.id, autoCompleted: true };
      }

      const approvers = await tx.user.findMany({
        where: {
          businessId: auth.businessId,
          role: { in: ['OWNER', 'MANAGER'] },
          status: 'ACTIVE',
          deletedAt: null,
          id: { not: auth.id },
        },
        select: { id: true },
      });
      if (approvers.length) {
        await tx.notification.createMany({
          data: approvers.map((approver) => ({
            businessId: auth.businessId,
            userId: approver.id,
            type: 'REFUND_PENDING',
            severity: 'WARNING',
            title: `Refund ${refundNumber} awaiting approval`,
            body: `${auth.name} requested a ${money(total)} refund for sale ${sale.saleNumber}. Reason: ${dto.reason.trim()}`,
            data: { refundId: created.id, saleId: sale.id, total },
          })),
        });
      }
        return { id: created.id, autoCompleted: false };
        });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        dto.idempotencyKey
      ) {
        const existing = await this.prisma.refund.findFirst({
          where: { businessId: auth.businessId, idempotencyKey: dto.idempotencyKey },
          select: { id: true },
        });
        if (existing) {
          const detail = await this.get(auth, existing.id);
          return { ...detail, autoCompleted: false };
        }
      }
      throw error;
    }

    const detail = await this.get(auth, summary.id);
    return { ...detail, autoCompleted: summary.autoCompleted };
  }

  async approve(auth: AuthUser, id: string, actor: AuditActor) {
    await this.prisma.criticalTransaction(async (tx) => {
      const refund = await tx.refund.findFirst({
        where: { id, businessId: auth.businessId },
        include: refundInclude,
      });
      if (!refund) throw ApiException.notFound('Refund not found.', 'REFUND_NOT_FOUND');
      this.assertBranch(auth, refund.locationId);
      if (refund.status !== 'PENDING') {
        throw ApiException.conflict('Only a pending refund can be approved.', 'REFUND_NOT_PENDING');
      }
      if (refund.requestedBy === auth.id && auth.role !== 'OWNER') {
        throw ApiException.forbidden(
          'A refund must be approved by someone other than the person who requested it.',
          'REFUND_SEGREGATION',
        );
      }
      const business = await tx.business.findUniqueOrThrow({ where: { id: auth.businessId } });
      if (dec(refund.total).greaterThan(business.refundApprovalThreshold) && auth.role !== 'OWNER') {
        throw ApiException.forbidden(
          `Refunds above ${business.refundApprovalThreshold.toFixed(2)} require owner approval.`,
          'REFUND_THRESHOLD',
        );
      }
      await tx.refund.update({
        where: { id: refund.id },
        data: { status: 'APPROVED', approvedBy: auth.id, approvedAt: new Date() },
      });
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'refund.approved',
          entityType: 'Refund',
          entityId: refund.id,
          actor,
          before: { status: 'PENDING' },
          after: { status: 'APPROVED', total: refund.total.toFixed(2) },
        },
        tx,
      );
      await tx.notification.create({
        data: {
          businessId: auth.businessId,
          userId: refund.requestedBy,
          type: 'SYSTEM',
          severity: 'INFO',
          title: `Refund ${refund.refundNumber} approved`,
          body: `${auth.name} approved your refund of ${refund.total.toFixed(2)}. An authorised user can now complete it.`,
          data: { refundId: refund.id },
        },
      });
    });
    return this.get(auth, id);
  }

  async complete(auth: AuthUser, id: string, actor: AuditActor) {
    await this.prisma.criticalTransaction(async (tx) => {
      const refund = await tx.refund.findFirst({
        where: { id, businessId: auth.businessId },
        include: refundInclude,
      });
      if (!refund) throw ApiException.notFound('Refund not found.', 'REFUND_NOT_FOUND');
      this.assertBranch(auth, refund.locationId);
      await this.applyCompletion(tx, refund, auth, actor, { auto: false });
    });
    return this.get(auth, id);
  }

  async reject(auth: AuthUser, id: string, dto: RejectRefundDto, actor: AuditActor) {
    await this.prisma.criticalTransaction(async (tx) => {
      const refund = await tx.refund.findFirst({
        where: { id, businessId: auth.businessId },
        include: refundInclude,
      });
      if (!refund) throw ApiException.notFound('Refund not found.', 'REFUND_NOT_FOUND');
      this.assertBranch(auth, refund.locationId);
      if (refund.status !== 'PENDING') {
        throw ApiException.conflict('Only a pending refund can be rejected.', 'REFUND_NOT_PENDING');
      }
      await tx.refund.update({
        where: { id: refund.id },
        data: { status: 'REJECTED', rejectionReason: dto.reason.trim() },
      });
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'refund.rejected',
          entityType: 'Refund',
          entityId: refund.id,
          actor,
          before: { status: refund.status },
          after: { status: 'REJECTED' },
          reason: dto.reason.trim(),
        },
        tx,
      );
      await tx.notification.create({
        data: {
          businessId: auth.businessId,
          userId: refund.requestedBy,
          type: 'REFUND_PENDING',
          severity: 'WARNING',
          title: `Refund ${refund.refundNumber} rejected`,
          body: `${auth.name} rejected the refund: ${dto.reason.trim()}`,
          data: { refundId: refund.id },
        },
      });
    });
    return this.get(auth, id);
  }

  async cancel(auth: AuthUser, id: string, actor: AuditActor) {
    await this.prisma.criticalTransaction(async (tx) => {
      const refund = await tx.refund.findFirst({
        where: { id, businessId: auth.businessId },
        include: refundInclude,
      });
      if (!refund) throw ApiException.notFound('Refund not found.', 'REFUND_NOT_FOUND');
      if (refund.requestedBy !== auth.id && auth.role !== 'OWNER') {
        throw ApiException.forbidden('Only the requester can cancel this refund.', 'REFUND_CANCEL_FORBIDDEN');
      }
      if (refund.status !== 'PENDING') {
        throw ApiException.conflict('Only a pending refund can be cancelled.', 'REFUND_NOT_PENDING');
      }
      await tx.refund.update({ where: { id: refund.id }, data: { status: 'CANCELLED' } });
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'refund.cancelled',
          entityType: 'Refund',
          entityId: refund.id,
          actor,
          before: { status: refund.status },
          after: { status: 'CANCELLED' },
        },
        tx,
      );
    });
    return this.get(auth, id);
  }

  private async applyCompletion(
    tx: Tx,
    refund: RefundWithRelations,
    auth: AuthUser,
    actor: AuditActor,
    options: { auto: boolean },
  ) {
    if (refund.status !== 'APPROVED' && !(options.auto && refund.status === 'PENDING')) {
      throw ApiException.conflict('Only an approved refund can be completed.', 'REFUND_NOT_APPROVED');
    }
    for (const item of refund.items) {
      const saleItem = item.saleItem;
      const afterRefund = dec(saleItem.refundedQuantity).plus(item.quantity);
      if (afterRefund.greaterThan(saleItem.quantity)) {
        throw ApiException.conflict(
          `Refund quantity for ${saleItem.productName} exceeds the quantity sold.`,
          'REFUND_EXCEEDS_SOLD',
        );
      }
      if (item.restock) {
        await this.ledger.apply(tx, {
          businessId: auth.businessId,
          locationId: refund.locationId,
          productId: item.productId,
          movementType: 'SALE_RETURN',
          quantity: item.quantity.toFixed(3),
          unitCost: saleItem.unitCost,
          referenceType: 'REFUND',
          referenceId: refund.id,
          performedBy: auth.id,
          reason: `Refund ${refund.refundNumber}: ${refund.reason}`,
        });
      }
      await tx.saleItem.update({
        where: { id: saleItem.id },
        data: { refundedQuantity: afterRefund.toFixed(3) },
      });
    }

    const saleItems = await tx.saleItem.findMany({ where: { saleId: refund.saleId } });
    const fullyRefunded = saleItems.every((item) =>
      dec(item.refundedQuantity).greaterThanOrEqualTo(item.quantity),
    );
    const anyRefunded = saleItems.some((item) => dec(item.refundedQuantity).greaterThan(0));
    const status = fullyRefunded ? 'REFUNDED' : anyRefunded ? 'PARTIALLY_REFUNDED' : 'COMPLETED';
    await tx.sale.update({ where: { id: refund.saleId }, data: { status } });

    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: 'COMPLETED',
        approvedBy: refund.approvedBy ?? auth.id,
        approvedAt: refund.approvedAt ?? new Date(),
        completedAt: new Date(),
      },
    });

    await this.audit.record(
      {
        businessId: auth.businessId,
        action: 'refund.completed',
        entityType: 'Refund',
        entityId: refund.id,
        actor,
        before: { status: refund.status },
        after: {
          status: 'COMPLETED',
          total: refund.total.toFixed(2),
          restocked: refund.items.filter((item) => item.restock).length > 0,
          saleStatus: status,
          autoApproved: options.auto,
        },
        reason: refund.reason,
      },
      tx,
    );

    await tx.notification.create({
      data: {
        businessId: auth.businessId,
        userId: refund.requestedBy,
        type: 'SYSTEM',
        severity: 'INFO',
        title: `Refund ${refund.refundNumber} completed`,
        body: `${money(refund.total)} was refunded for sale ${refund.sale.saleNumber}.`,
        data: { refundId: refund.id, saleId: refund.saleId },
      },
    });
  }

  private assertBranch(auth: AuthUser, locationId: string) {
    if (!this.access.isPrivileged(auth.role) && !auth.locationIds.includes(locationId)) {
      throw ApiException.forbidden('You are not assigned to this branch.', 'LOCATION_FORBIDDEN');
    }
  }
}
