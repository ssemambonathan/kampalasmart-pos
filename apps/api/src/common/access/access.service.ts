import { Injectable } from '@nestjs/common';
import { planFor } from '@kampalasmart/shared';
import type { Location as PrismaLocation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../errors/api-exception';
import type { AuthUser } from '../auth/auth-user';

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  isPrivileged(role: string): boolean {
    return role === 'OWNER' || role === 'MANAGER';
  }

  /** Customers see the whole business; cashiers/clerk are branch-restricted. */
  async assertLocation(auth: AuthUser, locationId: string): Promise<PrismaLocation> {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, businessId: auth.businessId, isActive: true },
    });
    if (!location) throw ApiException.notFound('Branch not found.', 'LOCATION_NOT_FOUND');
    if (!this.isPrivileged(auth.role) && !auth.locationIds.includes(location.id)) {
      throw ApiException.forbidden('You are not assigned to this branch.', 'LOCATION_FORBIDDEN');
    }
    return location;
  }

  async resolveLocation(auth: AuthUser, locationId?: string | null): Promise<PrismaLocation> {
    if (locationId) return this.assertLocation(auth, locationId);
    if (!this.isPrivileged(auth.role) && auth.locationIds.length > 0) {
      return this.assertLocation(auth, auth.locationIds[0]!);
    }
    const defaultLocation = await this.prisma.location.findFirst({
      where: { businessId: auth.businessId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    if (!defaultLocation) {
      throw ApiException.badRequest('No active branch is configured.', 'NO_LOCATION');
    }
    return defaultLocation;
  }

  async listScopedLocations(auth: AuthUser, includeInactive = false): Promise<PrismaLocation[]> {
    return this.prisma.location.findMany({
      where: {
        businessId: auth.businessId,
        ...(includeInactive && this.isPrivileged(auth.role) ? {} : { isActive: true }),
        ...(this.isPrivileged(auth.role) ? {} : { id: { in: auth.locationIds } }),
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async assertCanAddUser(businessId: string): Promise<void> {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw ApiException.notFound();
    const plan = planFor(business.plan);
    const count = await this.prisma.user.count({
      where: { businessId, deletedAt: null, status: 'ACTIVE' },
    });
    if (count >= plan.maxUsers) {
      throw ApiException.forbidden(
        `Your ${plan.name} plan allows up to ${plan.maxUsers} active users. Upgrade to add more.`,
        'PLAN_LIMIT_REACHED',
      );
    }
  }

  async assertCanAddLocation(businessId: string): Promise<void> {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw ApiException.notFound();
    const plan = planFor(business.plan);
    const count = await this.prisma.location.count({
      where: { businessId, isActive: true },
    });
    if (count >= plan.maxLocations) {
      throw ApiException.forbidden(
        `Your ${plan.name} plan allows up to ${plan.maxLocations} branches. Upgrade to add more.`,
        'PLAN_LIMIT_REACHED',
      );
    }
  }

  async validateLocationIds(businessId: string, locationIds: string[]): Promise<void> {
    const unique = [...new Set(locationIds)];
    const count = await this.prisma.location.count({
      where: { businessId, isActive: true, id: { in: unique } },
    });
    if (count !== unique.length) {
      throw ApiException.badRequest('One or more branches are invalid.', 'INVALID_LOCATION');
    }
  }
}
