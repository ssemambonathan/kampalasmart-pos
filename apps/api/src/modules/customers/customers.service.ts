import { Injectable } from '@nestjs/common';
import { Prisma, SaleStatus } from '@prisma/client';
import { money } from '@kampalasmart/shared';
import { AuditService, type AuditActor } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiException } from '../../common/errors/api-exception';
import { toCustomerDto } from '../../common/serializers';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import type { AuthUser } from '../../common/auth/auth-user';
import type { CreateCustomerDto, CustomerQueryDto, UpdateCustomerDto } from './customers.dto';

const COUNTED_SALE_STATUSES: SaleStatus[] = [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_REFUNDED];

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthUser, query: CustomerQueryDto) {
    const { skip, take } = skipTake(query);
    const where: Prisma.CustomerWhereInput = {
      businessId: auth.businessId,
      deletedAt: null,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [customers, total, salesStats] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      this.prisma.customer.count({ where }),
      this.prisma.sale.groupBy({
        by: ['customerId'],
        where: {
          businessId: auth.businessId,
          customerId: { not: null },
          status: { in: COUNTED_SALE_STATUSES },
        },
        orderBy: { customerId: 'asc' },
        _count: { _all: true },
        _sum: { total: true },
        _max: { createdAt: true },
      }),
    ]);
    const stats = new Map(salesStats.map((row) => [row.customerId, row]));
    return paginate(
      customers.map((customer) => {
        const row = stats.get(customer.id);
        return toCustomerDto(customer, {
          totalSpent: row?._sum.total ? money(row._sum.total) : '0.00',
          purchaseCount: row?._count._all ?? 0,
          lastPurchaseAt: row?._max.createdAt ?? null,
        });
      }),
      total,
      query,
    );
  }

  async get(auth: AuthUser, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, businessId: auth.businessId, deletedAt: null },
    });
    if (!customer) throw ApiException.notFound('Customer not found.', 'CUSTOMER_NOT_FOUND');
    const [stats, sales] = await this.prisma.$transaction([
      this.prisma.sale.aggregate({
        where: {
          businessId: auth.businessId,
          customerId: id,
          status: { in: COUNTED_SALE_STATUSES },
        },
        _count: { _all: true },
        _sum: { total: true },
        _max: { createdAt: true },
      }),
      this.prisma.sale.findMany({
        where: { businessId: auth.businessId, customerId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          saleNumber: true,
          status: true,
          total: true,
          createdAt: true,
          location: { select: { name: true } },
          cashier: { select: { name: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);
    return {
      ...toCustomerDto(customer, {
        totalSpent: stats._sum.total ? money(stats._sum.total) : '0.00',
        purchaseCount: stats._count._all,
        lastPurchaseAt: stats._max.createdAt,
      }),
      recentSales: sales.map((sale) => ({
        id: sale.id,
        saleNumber: sale.saleNumber,
        status: sale.status,
        total: sale.total.toFixed(2),
        itemCount: sale._count.items,
        locationName: sale.location.name,
        cashierName: sale.cashier.name,
        createdAt: sale.createdAt.toISOString(),
      })),
    };
  }

  async create(auth: AuthUser, dto: CreateCustomerDto, actor: AuditActor) {
    const customer = await this.prisma.customer.create({
      data: {
        businessId: auth.businessId,
        name: dto.name.trim(),
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        address: dto.address ?? null,
        notes: dto.notes ?? null,
      },
    });
    await this.audit.record({
      businessId: auth.businessId,
      action: 'customer.created',
      entityType: 'Customer',
      entityId: customer.id,
      actor,
      after: { name: customer.name, phone: customer.phone },
    });
    return toCustomerDto(customer);
  }

  async update(auth: AuthUser, id: string, dto: UpdateCustomerDto, actor: AuditActor) {
    const existing = await this.prisma.customer.findFirst({
      where: { id, businessId: auth.businessId, deletedAt: null },
    });
    if (!existing) throw ApiException.notFound('Customer not found.', 'CUSTOMER_NOT_FOUND');
    const customer = await this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.record({
      businessId: auth.businessId,
      action: 'customer.updated',
      entityType: 'Customer',
      entityId: customer.id,
      actor,
      before: toCustomerDto(existing),
      after: toCustomerDto(customer),
    });
    return toCustomerDto(customer);
  }
}
