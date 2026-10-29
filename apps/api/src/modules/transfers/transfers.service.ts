import { Injectable } from '@nestjs/common';
import { Prisma, TransferStatus } from '@prisma/client';
import { dec, money, type StockTransfer as TransferDto } from '@kampalasmart/shared';
import { AuditService, type AuditActor } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryLedgerService } from '../../common/inventory/inventory-ledger.service';
import { AccessService } from '../../common/access/access.service';
import { DocumentNumberService } from '../../common/documents/document-number.service';
import { ApiException } from '../../common/errors/api-exception';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import type { AuthUser } from '../../common/auth/auth-user';
import type { CreateTransferDto, RejectTransferDto, TransferQueryDto } from './transfers.dto';

const transferInclude = {
  fromLocation: { select: { name: true } },
  toLocation: { select: { name: true } },
  requester: { select: { name: true } },
  approver: { select: { name: true } },
  items: { include: { product: { select: { name: true, sku: true } } } },
} satisfies Prisma.StockTransferInclude;

type TransferWithRelations = Prisma.StockTransferGetPayload<{ include: typeof transferInclude }>;

function toTransferDto(transfer: TransferWithRelations): TransferDto {
  return {
    id: transfer.id,
    transferNumber: transfer.transferNumber,
    fromLocationId: transfer.fromLocationId,
    fromLocationName: transfer.fromLocation.name,
    toLocationId: transfer.toLocationId,
    toLocationName: transfer.toLocation.name,
    status: transfer.status,
    notes: transfer.notes,
    requestedByName: transfer.requester?.name ?? null,
    approvedByName: transfer.approver?.name ?? null,
    items: transfer.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      sku: item.product.sku,
      quantity: item.quantity.toFixed(3),
      unitCost: item.unitCost.toFixed(2),
    })),
    createdAt: transfer.createdAt.toISOString(),
    completedAt: transfer.completedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: InventoryLedgerService,
    private readonly access: AccessService,
    private readonly documents: DocumentNumberService,
  ) {}

  async list(auth: AuthUser, query: TransferQueryDto) {
    const { skip, take } = skipTake(query);
    const where: Prisma.StockTransferWhereInput = {
      businessId: auth.businessId,
      ...(query.status ? { status: query.status as TransferStatus } : {}),
      ...(query.fromLocationId ? { fromLocationId: query.fromLocationId } : {}),
      ...(query.toLocationId ? { toLocationId: query.toLocationId } : {}),
      ...(query.search
        ? {
            OR: [
              { transferNumber: { contains: query.search, mode: 'insensitive' } },
              { notes: { contains: query.search, mode: 'insensitive' } },
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
      const locationIds = auth.locationIds.length ? auth.locationIds : ['__none__'];
      where.AND = [{ OR: [{ fromLocationId: { in: locationIds } }, { toLocationId: { in: locationIds } }] }];
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockTransfer.findMany({
        where,
        include: transferInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);
    return paginate(rows.map(toTransferDto), total, query);
  }

  async get(auth: AuthUser, id: string): Promise<TransferDto> {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, businessId: auth.businessId },
      include: transferInclude,
    });
    if (!transfer) throw ApiException.notFound('Transfer not found.', 'TRANSFER_NOT_FOUND');
    if (
      !this.access.isPrivileged(auth.role) &&
      !auth.locationIds.includes(transfer.fromLocationId) &&
      !auth.locationIds.includes(transfer.toLocationId)
    ) {
      throw ApiException.forbidden('You are not assigned to either branch.', 'LOCATION_FORBIDDEN');
    }
    return toTransferDto(transfer);
  }

  async create(auth: AuthUser, dto: CreateTransferDto, actor: AuditActor) {
    if (dto.fromLocationId === dto.toLocationId) {
      throw ApiException.badRequest('Choose two different branches.', 'SAME_LOCATION');
    }
    const from = await this.access.assertLocation(auth, dto.fromLocationId);
    const to = await this.prisma.location.findFirst({
      where: { id: dto.toLocationId, businessId: auth.businessId, isActive: true },
    });
    if (!to) throw ApiException.badRequest('Destination branch not found.', 'INVALID_LOCATION');

    const seen = new Set<string>();
    for (const item of dto.items) {
      if (seen.has(item.productId)) {
        throw ApiException.badRequest('A product appears more than once in the transfer.', 'DUPLICATE_PRODUCT');
      }
      seen.add(item.productId);
      const quantity = dec(item.quantity);
      if (quantity.isZero() || quantity.isNegative() || quantity.decimalPlaces() > 3) {
        throw ApiException.badRequest('Transfer quantity must be greater than zero.', 'INVALID_QUANTITY');
      }
    }
    const products = await this.prisma.product.findMany({
      where: { businessId: auth.businessId, id: { in: dto.items.map((item) => item.productId) }, deletedAt: null },
      select: { id: true, name: true, sku: true, costPrice: true, isActive: true },
    });
    if (products.length !== dto.items.length) {
      throw ApiException.badRequest('One or more products are unavailable.', 'INVALID_PRODUCT');
    }
    const byId = new Map(products.map((product) => [product.id, product]));

    const created = await this.prisma.$transaction(async (tx) => {
      const transferNumber = await this.documents.next(tx, auth.businessId, 'TRANSFER');
      const transfer = await tx.stockTransfer.create({
        data: {
          businessId: auth.businessId,
          transferNumber,
          fromLocationId: from.id,
          toLocationId: to.id,
          status: 'PENDING',
          notes: dto.notes ?? null,
          requestedBy: auth.id,
          items: {
            create: dto.items.map((item) => {
              const product = byId.get(item.productId)!;
              return {
                productId: item.productId,
                quantity: dec(item.quantity).toFixed(3),
                unitCost: money(product.costPrice),
              };
            }),
          },
        },
        include: transferInclude,
      });
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'transfer.requested',
          entityType: 'StockTransfer',
          entityId: transfer.id,
          actor,
          after: {
            transferNumber,
            from: from.name,
            to: to.name,
            items: dto.items.map((item) => ({
              sku: byId.get(item.productId)?.sku,
              quantity: dec(item.quantity).toFixed(3),
            })),
          },
        },
        tx,
      );
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
            type: 'TRANSFER_PENDING',
            severity: 'INFO',
            title: `Transfer ${transferNumber} awaiting approval`,
            body: `${auth.name} requested a transfer from ${from.name} to ${to.name}.`,
            data: { transferId: transfer.id },
          })),
        });
      }
      return transfer;
    });
    return toTransferDto(created);
  }

  async approve(auth: AuthUser, id: string, actor: AuditActor) {
    await this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id, businessId: auth.businessId },
        include: transferInclude,
      });
      if (!transfer) throw ApiException.notFound('Transfer not found.', 'TRANSFER_NOT_FOUND');
      if (transfer.status !== 'PENDING') {
        throw ApiException.conflict('Only a pending transfer can be approved.', 'TRANSFER_NOT_PENDING');
      }
      if (transfer.requestedBy === auth.id && auth.role !== 'OWNER') {
        throw ApiException.forbidden(
          'A transfer must be approved by someone other than the person who requested it.',
          'TRANSFER_SEGREGATION',
        );
      }
      await tx.stockTransfer.update({
        where: { id },
        data: { status: 'APPROVED', approvedBy: auth.id, approvedAt: new Date() },
      });
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'transfer.approved',
          entityType: 'StockTransfer',
          entityId: id,
          actor,
          before: { status: 'PENDING' },
          after: { status: 'APPROVED' },
        },
        tx,
      );
      await tx.notification.create({
        data: {
          businessId: auth.businessId,
          userId: transfer.requestedBy,
          type: 'SYSTEM',
          severity: 'INFO',
          title: `Transfer ${transfer.transferNumber} approved`,
          body: `${auth.name} approved the transfer from ${transfer.fromLocation.name} to ${transfer.toLocation.name}.`,
          data: { transferId: id },
        },
      });
    });
    return this.get(auth, id);
  }

  async complete(auth: AuthUser, id: string, actor: AuditActor) {
    await this.prisma.criticalTransaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id, businessId: auth.businessId },
        include: transferInclude,
      });
      if (!transfer) throw ApiException.notFound('Transfer not found.', 'TRANSFER_NOT_FOUND');
      if (transfer.status !== 'APPROVED') {
        throw ApiException.conflict('Only an approved transfer can be completed.', 'TRANSFER_NOT_APPROVED');
      }
      if (
        !this.access.isPrivileged(auth.role) &&
        !auth.locationIds.includes(transfer.fromLocationId) &&
        !auth.locationIds.includes(transfer.toLocationId)
      ) {
        throw ApiException.forbidden('You are not assigned to either branch.', 'LOCATION_FORBIDDEN');
      }
      const business = await tx.business.findUniqueOrThrow({ where: { id: auth.businessId } });
      for (const item of transfer.items) {
        await this.ledger.apply(
          tx,
          {
            businessId: auth.businessId,
            locationId: transfer.fromLocationId,
            productId: item.productId,
            movementType: 'TRANSFER_OUT',
            quantity: dec(item.quantity).negated().toFixed(3),
            unitCost: item.unitCost,
            referenceType: 'TRANSFER',
            referenceId: transfer.id,
            performedBy: auth.id,
            reason: `Transfer ${transfer.transferNumber} to ${transfer.toLocation.name}`,
          },
          { allowNegative: business.allowNegativeStock },
        );
        await this.ledger.apply(tx, {
          businessId: auth.businessId,
          locationId: transfer.toLocationId,
          productId: item.productId,
          movementType: 'TRANSFER_IN',
          quantity: item.quantity.toFixed(3),
          unitCost: item.unitCost,
          referenceType: 'TRANSFER',
          referenceId: transfer.id,
          performedBy: auth.id,
          reason: `Transfer ${transfer.transferNumber} from ${transfer.fromLocation.name}`,
        });
      }
      await tx.stockTransfer.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'transfer.completed',
          entityType: 'StockTransfer',
          entityId: id,
          actor,
          before: { status: 'APPROVED' },
          after: {
            status: 'COMPLETED',
            from: transfer.fromLocation.name,
            to: transfer.toLocation.name,
            items: transfer.items.length,
          },
        },
        tx,
      );
      await tx.notification.create({
        data: {
          businessId: auth.businessId,
          userId: transfer.requestedBy,
          type: 'SYSTEM',
          severity: 'INFO',
          title: `Transfer ${transfer.transferNumber} completed`,
          body: `Stock has moved from ${transfer.fromLocation.name} to ${transfer.toLocation.name}.`,
          data: { transferId: id },
        },
      });
    });
    return this.get(auth, id);
  }

  async reject(auth: AuthUser, id: string, dto: RejectTransferDto, actor: AuditActor) {
    await this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id, businessId: auth.businessId },
        include: transferInclude,
      });
      if (!transfer) throw ApiException.notFound('Transfer not found.', 'TRANSFER_NOT_FOUND');
      if (transfer.status !== 'PENDING') {
        throw ApiException.conflict('Only a pending transfer can be rejected.', 'TRANSFER_NOT_PENDING');
      }
      await tx.stockTransfer.update({ where: { id }, data: { status: 'REJECTED' } });
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'transfer.rejected',
          entityType: 'StockTransfer',
          entityId: id,
          actor,
          before: { status: 'PENDING' },
          after: { status: 'REJECTED' },
          reason: dto.reason ?? null,
        },
        tx,
      );
      await tx.notification.create({
        data: {
          businessId: auth.businessId,
          userId: transfer.requestedBy,
          type: 'TRANSFER_PENDING',
          severity: 'WARNING',
          title: `Transfer ${transfer.transferNumber} rejected`,
          body: dto.reason ? `${auth.name} rejected the transfer: ${dto.reason}` : `${auth.name} rejected the transfer.`,
          data: { transferId: id },
        },
      });
    });
    return this.get(auth, id);
  }

  async cancel(auth: AuthUser, id: string, actor: AuditActor) {
    await this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id, businessId: auth.businessId },
        include: transferInclude,
      });
      if (!transfer) throw ApiException.notFound('Transfer not found.', 'TRANSFER_NOT_FOUND');
      if (transfer.requestedBy !== auth.id && auth.role !== 'OWNER') {
        throw ApiException.forbidden('Only the requester can cancel this transfer.', 'TRANSFER_CANCEL_FORBIDDEN');
      }
      if (transfer.status !== 'PENDING') {
        throw ApiException.conflict('Only a pending transfer can be cancelled.', 'TRANSFER_NOT_PENDING');
      }
      await tx.stockTransfer.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'transfer.cancelled',
          entityType: 'StockTransfer',
          entityId: id,
          actor,
          before: { status: 'PENDING' },
          after: { status: 'CANCELLED' },
        },
        tx,
      );
    });
    return this.get(auth, id);
  }
}
