import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessService } from '../../common/access/access.service';
import { AuditService, type AuditActor } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiException } from '../../common/errors/api-exception';
import { toLocationDto } from '../../common/serializers';
import type { AuthUser } from '../../common/auth/auth-user';
import type { CreateLocationDto, UpdateLocationDto } from './locations.dto';

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthUser, includeInactive = false) {
    const locations = await this.access.listScopedLocations(auth, includeInactive);
    return locations.map(toLocationDto);
  }

  async create(auth: AuthUser, dto: CreateLocationDto, actor: AuditActor) {
    await this.access.assertCanAddLocation(auth.businessId);
    const duplicate = await this.prisma.location.findFirst({
      where: { businessId: auth.businessId, code: dto.code },
      select: { id: true },
    });
    if (duplicate) {
      throw ApiException.conflict('A branch with this code already exists.', 'DUPLICATE_LOCATION_CODE');
    }
    const location = await this.prisma.location.create({
      data: {
        businessId: auth.businessId,
        name: dto.name,
        code: dto.code,
        address: dto.address ?? null,
        phone: dto.phone ?? null,
      },
    });
    await this.audit.record({
      businessId: auth.businessId,
      action: 'location.created',
      entityType: 'Location',
      entityId: location.id,
      actor,
      after: { name: location.name, code: location.code },
    });
    return toLocationDto(location);
  }

  async update(auth: AuthUser, id: string, dto: UpdateLocationDto, actor: AuditActor) {
    const existing = await this.prisma.location.findFirst({
      where: { id, businessId: auth.businessId },
    });
    if (!existing) throw ApiException.notFound('Branch not found.', 'LOCATION_NOT_FOUND');

    if (dto.code && dto.code !== existing.code) {
      const duplicate = await this.prisma.location.findFirst({
        where: { businessId: auth.businessId, code: dto.code, id: { not: id } },
        select: { id: true },
      });
      if (duplicate) {
        throw ApiException.conflict('A branch with this code already exists.', 'DUPLICATE_LOCATION_CODE');
      }
    }

    if (dto.isActive === false) {
      if (existing.isDefault) {
        throw ApiException.badRequest(
          'The default branch cannot be deactivated. Make another branch the default first.',
          'DEFAULT_LOCATION',
        );
      }
      if (!this.access.isPrivileged(auth.role) && auth.locationIds.includes(id) === false) {
        throw ApiException.forbidden('You are not assigned to this branch.', 'LOCATION_FORBIDDEN');
      }
      const activeCount = await this.prisma.location.count({
        where: { businessId: auth.businessId, isActive: true },
      });
      if (activeCount <= 1) {
        throw ApiException.badRequest('At least one active branch is required.', 'LAST_LOCATION');
      }
    }

    try {
      const location = await this.prisma.location.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.audit.record({
        businessId: auth.businessId,
        action: 'location.updated',
        entityType: 'Location',
        entityId: location.id,
        actor,
        before: toLocationDto(existing),
        after: toLocationDto(location),
      });
      return toLocationDto(location);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw ApiException.conflict('A branch with this code already exists.', 'DUPLICATE_LOCATION_CODE');
      }
      throw error;
    }
  }
}
