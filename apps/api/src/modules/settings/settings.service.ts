import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PLANS, dec, isSubscriptionActive, money, planFor } from '@kampalasmart/shared';
import { AuditService, type AuditActor } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiException } from '../../common/errors/api-exception';
import { isSupportedTimezone } from '../../common/date-range';
import { toBusinessDto, toTaxRateDto } from '../../common/serializers';
import type { AuthUser } from '../../common/auth/auth-user';
import type { CreateTaxRateDto, UpdateBusinessDto, UpdateTaxRateDto } from './settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(auth: AuthUser) {
    const [business, taxRates, counts] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({ where: { id: auth.businessId } }),
      this.prisma.taxRate.findMany({
        where: { businessId: auth.businessId },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
      this.usageCounts(auth.businessId),
    ]);
    const plan = planFor(business.plan);
    const trialDaysRemaining = business.trialEndsAt
      ? Math.max(0, Math.ceil((business.trialEndsAt.getTime() - Date.now()) / 86_400_000))
      : null;
    return {
      business: toBusinessDto(business),
      taxRates: taxRates.map(toTaxRateDto),
      usage: { ...counts, plan: { id: plan.id, name: plan.name, maxUsers: plan.maxUsers, maxLocations: plan.maxLocations, features: plan.features } },
      subscription: {
        plan: business.plan,
        status: business.subscriptionStatus,
        active: isSubscriptionActive({
          plan: business.plan,
          subscriptionStatus: business.subscriptionStatus,
          trialEndsAt: business.trialEndsAt,
        }),
        trialEndsAt: business.trialEndsAt?.toISOString() ?? null,
        trialDaysRemaining,
      },
    };
  }

  async plans(auth: AuthUser) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: { plan: true, subscriptionStatus: true, trialEndsAt: true },
    });
    return {
      current: {
        plan: business.plan,
        status: business.subscriptionStatus,
        trialEndsAt: business.trialEndsAt?.toISOString() ?? null,
      },
      plans: Object.values(PLANS).map((plan) => ({
        ...plan,
        maxUsers: Number.isFinite(plan.maxUsers) ? plan.maxUsers : null,
        maxLocations: Number.isFinite(plan.maxLocations) ? plan.maxLocations : null,
      })),
    };
  }

  async updateBusiness(auth: AuthUser, dto: UpdateBusinessDto, actor: AuditActor) {
    const existing = await this.prisma.business.findUniqueOrThrow({ where: { id: auth.businessId } });
    if (dto.timezone && !isSupportedTimezone(dto.timezone)) {
      throw ApiException.badRequest(
        'That time zone is not supported. Choose one of the fixed-offset zones used for reporting.',
        'INVALID_TIMEZONE',
      );
    }
    if (dto.currency && dto.currency !== existing.currency) {
      const sales = await this.prisma.sale.count({ where: { businessId: auth.businessId } });
      if (sales > 0) {
        throw ApiException.conflict(
          'The currency cannot change after sales have been recorded. It would misstate historical amounts.',
          'CURRENCY_LOCKED',
        );
      }
    }
    const cashierLimit = dec(dto.maxCashierDiscountPercent ?? existing.maxCashierDiscountPercent);
    const managerLimit = dec(dto.maxManagerDiscountPercent ?? existing.maxManagerDiscountPercent);
    if (dto.taxRate !== undefined && dec(dto.taxRate).greaterThan(100)) {
      throw ApiException.badRequest('Tax rate cannot exceed 100%.', 'INVALID_TAX_RATE');
    }
    if (cashierLimit.greaterThan(managerLimit)) {
      throw ApiException.badRequest(
        'The cashier discount limit cannot exceed the manager discount limit.',
        'INVALID_DISCOUNT_POLICY',
      );
    }
    if (cashierLimit.greaterThan(100) || managerLimit.greaterThan(100)) {
      throw ApiException.badRequest('Discount limits cannot exceed 100%.', 'INVALID_DISCOUNT_POLICY');
    }
    const updated = await this.prisma.business.update({
      where: { id: auth.businessId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
        ...(dto.taxEnabled !== undefined ? { taxEnabled: dto.taxEnabled } : {}),
        ...(dto.taxInclusive !== undefined ? { taxInclusive: dto.taxInclusive } : {}),
        ...(dto.taxRate !== undefined ? { taxRate: dec(dto.taxRate).toFixed(3) } : {}),
        ...(dto.allowNegativeStock !== undefined ? { allowNegativeStock: dto.allowNegativeStock } : {}),
        ...(dto.maxCashierDiscountPercent !== undefined
          ? { maxCashierDiscountPercent: money(dto.maxCashierDiscountPercent) }
          : {}),
        ...(dto.maxManagerDiscountPercent !== undefined
          ? { maxManagerDiscountPercent: money(dto.maxManagerDiscountPercent) }
          : {}),
        ...(dto.refundApprovalThreshold !== undefined
          ? { refundApprovalThreshold: money(dto.refundApprovalThreshold) }
          : {}),
        ...(dto.defaultLeadTimeDays !== undefined ? { defaultLeadTimeDays: dto.defaultLeadTimeDays } : {}),
        ...(dto.receiptFooter !== undefined ? { receiptFooter: dto.receiptFooter } : {}),
      },
    });
    await this.audit.record({
      businessId: auth.businessId,
      action: 'settings.updated',
      entityType: 'Business',
      entityId: auth.businessId,
      actor,
      before: toBusinessDto(existing),
      after: toBusinessDto(updated),
    });
    return toBusinessDto(updated);
  }

  async taxRates(auth: AuthUser) {
    const rates = await this.prisma.taxRate.findMany({
      where: { businessId: auth.businessId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return rates.map(toTaxRateDto);
  }

  async createTaxRate(auth: AuthUser, dto: CreateTaxRateDto, actor: AuditActor) {
    if (dec(dto.rate).greaterThan(100)) {
      throw ApiException.badRequest('Tax rate cannot exceed 100%.', 'INVALID_TAX_RATE');
    }
    try {
      const rate = await this.prisma.$transaction(async (tx) => {
        const existingCount = await tx.taxRate.count({ where: { businessId: auth.businessId } });
        const isDefault = dto.isDefault === true || existingCount === 0;
        if (isDefault) {
          await tx.taxRate.updateMany({
            where: { businessId: auth.businessId, isDefault: true },
            data: { isDefault: false },
          });
        }
        const created = await tx.taxRate.create({
          data: {
            businessId: auth.businessId,
            name: dto.name.trim(),
            rate: dec(dto.rate).toFixed(3),
            isInclusive: dto.isInclusive === true,
            isDefault,
          },
        });
        await this.audit.record(
          {
            businessId: auth.businessId,
            action: 'tax_rate.created',
            entityType: 'TaxRate',
            entityId: created.id,
            actor,
            after: { name: created.name, rate: created.rate.toFixed(3), isDefault: created.isDefault },
          },
          tx,
        );
        return created;
      });
      return toTaxRateDto(rate);
    } catch (error) {
      this.rethrowDuplicate(error);
      throw error;
    }
  }

  async updateTaxRate(auth: AuthUser, id: string, dto: UpdateTaxRateDto, actor: AuditActor) {
    const existing = await this.prisma.taxRate.findFirst({
      where: { id, businessId: auth.businessId },
    });
    if (!existing) throw ApiException.notFound('Tax rate not found.', 'TAX_RATE_NOT_FOUND');
    if (dto.rate !== undefined && dec(dto.rate).greaterThan(100)) {
      throw ApiException.badRequest('Tax rate cannot exceed 100%.', 'INVALID_TAX_RATE');
    }
    if (dto.isActive === false && existing.isDefault) {
      if (dto.isDefault !== false) {
        throw ApiException.badRequest(
          'Choose another default tax rate before archiving this one.',
          'DEFAULT_TAX_RATE',
        );
      }
    }
    try {
      const rate = await this.prisma.$transaction(async (tx) => {
        if (dto.isDefault === true) {
          await tx.taxRate.updateMany({
            where: { businessId: auth.businessId, isDefault: true, id: { not: id } },
            data: { isDefault: false },
          });
        }
        const updated = await tx.taxRate.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.rate !== undefined ? { rate: dec(dto.rate).toFixed(3) } : {}),
            ...(dto.isInclusive !== undefined ? { isInclusive: dto.isInclusive } : {}),
            ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
        });
        if (!updated.isActive && !updated.isDefault) {
          const fallback = await tx.taxRate.findFirst({
            where: { businessId: auth.businessId, isActive: true },
            orderBy: { name: 'asc' },
          });
          if (fallback) {
            await tx.taxRate.update({ where: { id: fallback.id }, data: { isDefault: true } });
          }
        }
        await this.audit.record(
          {
            businessId: auth.businessId,
            action: 'tax_rate.updated',
            entityType: 'TaxRate',
            entityId: id,
            actor,
            before: toTaxRateDto(existing),
            after: toTaxRateDto(updated),
          },
          tx,
        );
        return updated;
      });
      return toTaxRateDto(rate);
    } catch (error) {
      this.rethrowDuplicate(error);
      throw error;
    }
  }

  async archiveTaxRate(auth: AuthUser, id: string, actor: AuditActor) {
    const existing = await this.prisma.taxRate.findFirst({
      where: { id, businessId: auth.businessId },
    });
    if (!existing) throw ApiException.notFound('Tax rate not found.', 'TAX_RATE_NOT_FOUND');
    if (!existing.isActive) return { success: true };
    await this.prisma.$transaction(async (tx) => {
      await tx.taxRate.update({
        where: { id },
        data: { isActive: false, isDefault: false },
      });
      if (existing.isDefault) {
        const fallback = await tx.taxRate.findFirst({
          where: { businessId: auth.businessId, isActive: true, id: { not: id } },
          orderBy: { name: 'asc' },
        });
        if (fallback) {
          await tx.taxRate.update({ where: { id: fallback.id }, data: { isDefault: true } });
        }
      }
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'tax_rate.archived',
          entityType: 'TaxRate',
          entityId: id,
          actor,
          before: toTaxRateDto(existing),
          after: { isActive: false },
          reason: 'Archived; existing products keep their historical rate',
        },
        tx,
      );
    });
    return { success: true };
  }

  private usageCounts(businessId: string) {
    return Promise.all([
      this.prisma.user.count({ where: { businessId, deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { businessId, deletedAt: null } }),
      this.prisma.location.count({ where: { businessId, isActive: true } }),
      this.prisma.product.count({ where: { businessId, deletedAt: null, isActive: true } }),
      this.prisma.customer.count({ where: { businessId, deletedAt: null, isActive: true } }),
      this.prisma.supplier.count({ where: { businessId, deletedAt: null, isActive: true } }),
    ]).then(([activeUsers, totalUsers, locations, products, customers, suppliers]) => ({
      activeUsers,
      totalUsers,
      locations,
      products,
      customers,
      suppliers,
    }));
  }

  private rethrowDuplicate(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw ApiException.conflict('A tax rate with this name already exists.', 'DUPLICATE_TAX_RATE');
    }
  }
}
