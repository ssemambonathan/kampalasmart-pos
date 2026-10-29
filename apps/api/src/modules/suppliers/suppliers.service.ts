import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { money } from '@kampalasmart/shared';
import { AuditService, type AuditActor } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiException } from '../../common/errors/api-exception';
import { toSupplierDto } from '../../common/serializers';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import type { AuthUser } from '../../common/auth/auth-user';
import type { CreateSupplierDto, SupplierQueryDto, UpdateSupplierDto } from './suppliers.dto';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthUser, query: SupplierQueryDto) {
    const { skip, take } = skipTake(query);
    const where: Prisma.SupplierWhereInput = {
      businessId: auth.businessId,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { contactName: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [suppliers, total, productCounts, purchaseStats] = await Promise.all([
      this.prisma.supplier.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
      this.prisma.supplier.count({ where }),
      this.prisma.product.groupBy({
        by: ['supplierId'],
        where: { businessId: auth.businessId, deletedAt: null },
        orderBy: { supplierId: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.purchase.groupBy({
        by: ['supplierId'],
        where: { businessId: auth.businessId },
        orderBy: { supplierId: 'asc' },
        _count: { _all: true },
        _sum: { total: true },
        _max: { createdAt: true },
      }),
    ]);
    const products = new Map(productCounts.map((row) => [row.supplierId, row._count._all]));
    const purchases = new Map(purchaseStats.map((row) => [row.supplierId, row]));
    return paginate(
      suppliers.map((supplier) => {
        const stats = purchases.get(supplier.id);
        return toSupplierDto(supplier, {
          productCount: products.get(supplier.id) ?? 0,
          purchaseCount: stats?._count._all ?? 0,
          totalPurchased: stats?._sum.total ? money(stats._sum.total) : '0.00',
          lastPurchaseAt: stats?._max.createdAt ?? null,
        });
      }),
      total,
      query,
    );
  }

  async get(auth: AuthUser, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, businessId: auth.businessId },
    });
    if (!supplier) throw ApiException.notFound('Supplier not found.', 'SUPPLIER_NOT_FOUND');
    const [productCount, purchases, stats] = await this.prisma.$transaction([
      this.prisma.product.count({
        where: { businessId: auth.businessId, supplierId: id, deletedAt: null },
      }),
      this.prisma.purchase.findMany({
        where: { businessId: auth.businessId, supplierId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          purchaseNumber: true,
          status: true,
          total: true,
          createdAt: true,
          receivedAt: true,
          location: { select: { name: true } },
        },
      }),
      this.prisma.purchase.aggregate({
        where: { businessId: auth.businessId, supplierId: id },
        _count: { _all: true },
        _sum: { total: true },
        _max: { createdAt: true },
      }),
    ]);
    return {
      ...toSupplierDto(supplier, {
        productCount,
        purchaseCount: stats._count._all,
        totalPurchased: stats._sum.total ? money(stats._sum.total) : '0.00',
        lastPurchaseAt: stats._max.createdAt,
      }),
      recentPurchases: purchases.map((purchase) => ({
        id: purchase.id,
        purchaseNumber: purchase.purchaseNumber,
        status: purchase.status,
        total: purchase.total.toFixed(2),
        locationName: purchase.location.name,
        createdAt: purchase.createdAt.toISOString(),
        receivedAt: purchase.receivedAt?.toISOString() ?? null,
      })),
    };
  }

  async create(auth: AuthUser, dto: CreateSupplierDto, actor: AuditActor) {
    const supplier = await this.prisma.supplier.create({
      data: {
        businessId: auth.businessId,
        name: dto.name.trim(),
        contactName: dto.contactName ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        address: dto.address ?? null,
        notes: dto.notes ?? null,
      },
    });
    await this.audit.record({
      businessId: auth.businessId,
      action: 'supplier.created',
      entityType: 'Supplier',
      entityId: supplier.id,
      actor,
      after: { name: supplier.name, phone: supplier.phone },
    });
    return toSupplierDto(supplier);
  }

  async update(auth: AuthUser, id: string, dto: UpdateSupplierDto, actor: AuditActor) {
    const existing = await this.prisma.supplier.findFirst({
      where: { id, businessId: auth.businessId },
    });
    if (!existing) throw ApiException.notFound('Supplier not found.', 'SUPPLIER_NOT_FOUND');
    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.contactName !== undefined ? { contactName: dto.contactName } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.record({
      businessId: auth.businessId,
      action: 'supplier.updated',
      entityType: 'Supplier',
      entityId: supplier.id,
      actor,
      before: toSupplierDto(existing),
      after: toSupplierDto(supplier),
    });
    return toSupplierDto(supplier);
  }
}
