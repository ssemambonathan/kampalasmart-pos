import { Injectable } from '@nestjs/common';
import { Prisma, type Customer, type Device } from '@prisma/client';
import {
  dec,
  type Customer as CustomerDto,
  type SyncBootstrap,
  type SyncEventResult,
  type SyncInventoryLevel,
  type SyncOverview,
  type SyncPullResponse,
  type SyncPushResponse,
} from '@kampalasmart/shared';
import { AccessService } from '../../common/access/access.service';
import { AuditService, type AuditActor } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiException } from '../../common/errors/api-exception';
import {
  toBusinessDto,
  toCustomerDto,
  toLocationDto,
  toProductDto,
  toTaxRateDto,
} from '../../common/serializers';
import { SalesService } from '../sales/sales.service';
import type { CreateSaleDto } from '../sales/sales.dto';
import type { AuthUser } from '../../common/auth/auth-user';
import type {
  RegisterDeviceDto,
  ResolveConflictDto,
  SyncBootstrapQueryDto,
  SyncPullQueryDto,
  SyncPushDto,
  SyncPushEventDto,
} from './sync.dto';

const productInclude = {
  category: { select: { name: true } },
  supplier: { select: { name: true } },
  taxRate: { select: { rate: true, isInclusive: true } },
} satisfies Prisma.ProductInclude;

const CONFLICT_CODES = new Set([
  'INSUFFICIENT_STOCK',
  'PRODUCT_UNAVAILABLE',
  'INVALID_CUSTOMER',
  'CUSTOMER_INACTIVE',
]);

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly sales: SalesService,
    private readonly audit: AuditService,
  ) {}

  async registerDevice(auth: AuthUser, dto: RegisterDeviceDto): Promise<Device> {
    const now = new Date();
    const existing = await this.prisma.device.findUnique({
      where: { businessId_deviceKey: { businessId: auth.businessId, deviceKey: dto.deviceKey } },
    });
    if (existing) {
      return this.prisma.device.update({
        where: { id: existing.id },
        data: {
          name: dto.name?.trim() || existing.name,
          platform: dto.platform ?? existing.platform,
          userId: existing.userId ?? auth.id,
          lastSeenAt: now,
        },
      });
    }
    try {
      return await this.prisma.device.create({
        data: {
          businessId: auth.businessId,
          deviceKey: dto.deviceKey,
          name: dto.name?.trim() || `Device ${dto.deviceKey.slice(0, 8)}`,
          platform: dto.platform ?? null,
          userId: auth.id,
          lastSeenAt: now,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.device.findUnique({
          where: {
            businessId_deviceKey: { businessId: auth.businessId, deviceKey: dto.deviceKey },
          },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  async bootstrap(auth: AuthUser, query: SyncBootstrapQueryDto): Promise<SyncBootstrap> {
    const location = await this.access.resolveLocation(auth, query.locationId ?? null);
    const [business, taxRates, locations, products, levels, customers] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({ where: { id: auth.businessId } }),
      this.prisma.taxRate.findMany({
        where: { businessId: auth.businessId },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
      this.access.listScopedLocations(auth),
      this.prisma.product.findMany({
        where: { businessId: auth.businessId, deletedAt: null, isActive: true },
        include: productInclude,
        orderBy: { name: 'asc' },
        take: 5000,
      }),
      this.prisma.inventoryLevel.findMany({
        where: {
          businessId: auth.businessId,
          locationId: location.id,
          product: { deletedAt: null, isActive: true },
        },
        select: { productId: true, quantity: true },
      }),
      this.prisma.customer.findMany({
        where: { businessId: auth.businessId, deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
        take: 2000,
      }),
    ]);
    const stock = new Map(levels.map((level) => [level.productId, level.quantity]));
    const stats = await this.customerStats(
      auth.businessId,
      customers.map((customer) => customer.id),
    );
    return {
      business: toBusinessDto(business),
      locations: locations.map(toLocationDto),
      taxRates: taxRates.map(toTaxRateDto),
      products: products.map((product) =>
        toProductDto(product, stock.get(product.id)?.toFixed(3) ?? '0.000'),
      ),
      inventory: levels.map((level) => ({
        productId: level.productId,
        quantity: level.quantity.toFixed(3),
      })),
      customers: customers.map((customer) => this.toCustomer(customer, stats)),
      serverTime: new Date().toISOString(),
    };
  }

  async pull(auth: AuthUser, query: SyncPullQueryDto): Promise<SyncPullResponse> {
    const location = await this.access.resolveLocation(auth, query.locationId ?? null);
    const since = query.since ? new Date(query.since) : null;
    if (since && Number.isNaN(since.getTime())) {
      throw ApiException.badRequest('since is not a valid timestamp.', 'INVALID_SINCE');
    }
    const [products, levels, customers] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          businessId: auth.businessId,
          deletedAt: null,
          ...(since ? { updatedAt: { gte: since } } : {}),
        },
        include: productInclude,
        orderBy: { updatedAt: 'asc' },
        take: 5000,
      }),
      this.prisma.inventoryLevel.findMany({
        where: {
          businessId: auth.businessId,
          locationId: location.id,
          ...(since ? { updatedAt: { gte: since } } : {}),
        },
        select: { productId: true, quantity: true },
        orderBy: { updatedAt: 'asc' },
        take: 10_000,
      }),
      this.prisma.customer.findMany({
        where: {
          businessId: auth.businessId,
          deletedAt: null,
          ...(since ? { updatedAt: { gte: since } } : {}),
        },
        orderBy: { updatedAt: 'asc' },
        take: 5000,
      }),
    ]);
    const stock = new Map(levels.map((level) => [level.productId, level.quantity]));
    const stats = await this.customerStats(
      auth.businessId,
      customers.map((customer) => customer.id),
    );
    return {
      products: products.map((product) => {
        const quantity = stock.get(product.id);
        return toProductDto(product, quantity?.toFixed(3));
      }),
      inventory: levels.map((level) => ({
        productId: level.productId,
        quantity: level.quantity.toFixed(3),
      })),
      customers: customers.map((customer) => this.toCustomer(customer, stats)),
      serverTime: new Date().toISOString(),
    };
  }

  async push(auth: AuthUser, dto: SyncPushDto, actor: AuditActor): Promise<SyncPushResponse> {
    const device = await this.registerDevice(auth, { deviceKey: dto.deviceKey });
    const results: SyncEventResult[] = [];
    const affected = new Set<string>();
    let primaryLocationId: string | null = null;

    for (const event of dto.events) {
      primaryLocationId ??= event.payload.locationId;
      for (const item of event.payload.items) affected.add(item.productId);
      try {
        const sale = await this.sales.create(auth, this.toCreateSale(event), actor, {
          deviceId: device.id,
          allowNegativeStock: false,
        });
        await this.prisma.syncConflict.updateMany({
          where: {
            businessId: auth.businessId,
            clientId: event.clientId,
            type: 'SALE',
            status: 'OPEN',
          },
          data: {
            status: 'RESOLVED',
            resolution: 'The sale was accepted on a later sync.',
            resolvedAt: new Date(),
          },
        });
        results.push({
          clientId: event.clientId,
          status: 'SYNCED',
          saleId: sale.id,
          saleNumber: sale.saleNumber,
          sale,
        });
      } catch (error) {
        if (!(error instanceof ApiException)) throw error;
        if (CONFLICT_CODES.has(error.code)) {
          await this.recordConflict(auth, device, event.clientId, error);
          results.push({
            clientId: event.clientId,
            status: 'CONFLICT',
            error: { code: error.code, message: error.message, details: error.details },
            conflicts: await this.conflictDetails(error),
          });
        } else {
          results.push({
            clientId: event.clientId,
            status: 'FAILED',
            error: { code: error.code, message: error.message, details: error.details },
          });
        }
      }
    }

    const locationId =
      primaryLocationId ?? (await this.access.resolveLocation(auth, null)).id;
    const inventory: SyncInventoryLevel[] = affected.size
      ? (
          await this.prisma.inventoryLevel.findMany({
            where: {
              businessId: auth.businessId,
              locationId,
              productId: { in: [...affected] },
            },
            select: { productId: true, quantity: true },
          })
        ).map((level) => ({
          productId: level.productId,
          quantity: level.quantity.toFixed(3),
        }))
      : [];
    await this.prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date(), lastSyncAt: new Date() },
    });
    return {
      results,
      inventory,
      serverTime: new Date().toISOString(),
      deviceId: device.id,
    };
  }

  async overview(auth: AuthUser): Promise<SyncOverview> {
    const [pendingConflicts, devices, conflicts] = await Promise.all([
      this.prisma.syncConflict.count({
        where: { businessId: auth.businessId, status: 'OPEN' },
      }),
      this.prisma.device.findMany({
        where: { businessId: auth.businessId },
        orderBy: [{ lastSeenAt: 'desc' }, { createdAt: 'desc' }],
        take: 50,
      }),
      this.prisma.syncConflict.findMany({
        where: { businessId: auth.businessId },
        include: { device: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    const lastSyncAt = devices.reduce<Date | null>((latest, device) => {
      if (!device.lastSyncAt) return latest;
      if (!latest) return device.lastSyncAt;
      return device.lastSyncAt.getTime() > latest.getTime() ? device.lastSyncAt : latest;
    }, null);
    return {
      pendingConflicts,
      lastSyncAt: lastSyncAt?.toISOString() ?? null,
      devices: devices.map((device) => ({
        id: device.id,
        name: device.name,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        lastSyncAt: device.lastSyncAt?.toISOString() ?? null,
        pendingEvents: 0,
      })),
      conflicts: conflicts.map((conflict) => ({
        id: conflict.id,
        deviceName: conflict.device?.name ?? 'Unregistered device',
        clientId: conflict.clientId,
        reason: conflict.reason,
        createdAt: conflict.createdAt.toISOString(),
        resolvedAt: conflict.resolvedAt?.toISOString() ?? null,
        status: conflict.status,
        resolution: conflict.resolution,
        details: conflict.details,
      })),
    };
  }

  async resolve(auth: AuthUser, id: string, dto: ResolveConflictDto, actor: AuditActor) {
    const conflict = await this.prisma.syncConflict.findFirst({
      where: { id, businessId: auth.businessId },
    });
    if (!conflict) throw ApiException.notFound('Sync conflict not found.', 'CONFLICT_NOT_FOUND');
    if (conflict.status === 'RESOLVED') {
      return { id, status: conflict.status, resolution: conflict.resolution };
    }
    const resolution = dto.resolution.trim();
    const updated = await this.prisma.syncConflict.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolution,
        resolvedBy: auth.id,
        resolvedAt: new Date(),
      },
    });
    await this.audit.record({
      businessId: auth.businessId,
      action: 'sync.conflict_resolved',
      entityType: 'SyncConflict',
      entityId: id,
      actor,
      before: { status: conflict.status, reason: conflict.reason, clientId: conflict.clientId },
      after: { status: updated.status, resolution },
      reason: resolution,
    });
    return {
      id,
      status: updated.status,
      resolution: updated.resolution,
      resolvedAt: updated.resolvedAt?.toISOString() ?? null,
    };
  }

  private toCreateSale(event: SyncPushEventDto): CreateSaleDto {
    const payload = event.payload;
    return {
      locationId: payload.locationId,
      customerId: payload.customerId ?? null,
      items: payload.items.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        ...(line.unitPrice !== undefined ? { unitPrice: line.unitPrice } : {}),
        ...(line.lineDiscount ? { lineDiscount: line.lineDiscount } : {}),
      })),
      cartDiscount: payload.cartDiscount ?? null,
      payments: payload.payments.map((payment) => ({
        method: payment.method,
        amount: payment.amount,
        reference: payment.reference ?? null,
      })),
      notes: payload.notes ?? null,
      idempotencyKey: event.clientId,
      clientId: event.clientId,
      occurredAt: payload.occurredAt,
      isOffline: true,
    };
  }

  private async recordConflict(
    auth: AuthUser,
    device: Device,
    clientId: string,
    error: ApiException,
  ) {
    const existing = await this.prisma.syncConflict.findUnique({
      where: {
        businessId_clientId_type: {
          businessId: auth.businessId,
          clientId,
          type: 'SALE',
        },
      },
    });
    const conflict = await this.prisma.syncConflict.upsert({
      where: {
        businessId_clientId_type: {
          businessId: auth.businessId,
          clientId,
          type: 'SALE',
        },
      },
      create: {
        businessId: auth.businessId,
        deviceId: device.id,
        clientId,
        type: 'SALE',
        reason: error.code,
        details: (error.details ?? {}) as Prisma.InputJsonValue,
        status: 'OPEN',
      },
      update: {
        deviceId: device.id,
        reason: error.code,
        details: (error.details ?? {}) as Prisma.InputJsonValue,
        status: 'OPEN',
        resolution: null,
        resolvedBy: null,
        resolvedAt: null,
      },
    });
    if (!existing || existing.status === 'RESOLVED') {
      await this.prisma.notification.create({
        data: {
          businessId: auth.businessId,
          type: 'SYNC_CONFLICT',
          severity: 'WARNING',
          title: 'Offline sale needs attention',
          body: `${device.name} sent an offline sale that could not be applied: ${error.message}`,
          data: { syncConflictId: conflict.id, clientId, reason: error.code },
        },
      });
    }
    return conflict;
  }

  private async conflictDetails(error: ApiException) {
    if (error.code !== 'INSUFFICIENT_STOCK') return [];
    const details = error.details as
      | { productId?: string; requested?: string; available?: string }
      | undefined;
    if (!details?.productId) return [];
    const product = await this.prisma.product.findUnique({
      where: { id: details.productId },
      select: { name: true },
    });
    return [
      {
        productId: details.productId,
        productName: product?.name ?? 'This product',
        requested: details.requested ?? '0.000',
        available: details.available ?? '0.000',
      },
    ];
  }

  private async customerStats(businessId: string, customerIds: string[]) {
    if (customerIds.length === 0) {
      return new Map<
        string,
        { totalSpent: string; purchaseCount: number; lastPurchaseAt: Date | null }
      >();
    }
    const rows = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: { businessId, customerId: { in: customerIds } },
      _sum: { total: true },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    return new Map(
      rows
        .filter((row): row is typeof row & { customerId: string } => row.customerId !== null)
        .map((row) => [
          row.customerId,
          {
            totalSpent: dec(row._sum.total ?? 0).toFixed(2),
            purchaseCount: row._count._all,
            lastPurchaseAt: row._max.createdAt,
          },
        ]),
    );
  }

  private toCustomer(
    customer: Customer,
    stats: Map<string, { totalSpent: string; purchaseCount: number; lastPurchaseAt: Date | null }>,
  ): CustomerDto {
    return toCustomerDto(customer, stats.get(customer.id));
  }
}
