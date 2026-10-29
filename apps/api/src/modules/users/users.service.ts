import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuditService, type AuditActor } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccessService } from '../../common/access/access.service';
import { ApiException } from '../../common/errors/api-exception';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import type { AuthUser } from '../../common/auth/auth-user';
import type { CreateUserDto, ResetUserPasswordDto, UpdateUserDto, UserQueryDto } from './users.dto';

const userInclude = {
  locations: {
    include: { location: { select: { id: true, name: true, code: true, isActive: true } } },
  },
} satisfies Prisma.UserInclude;

type UserWithLocations = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function toUserDto(user: UserWithLocations) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    failedLoginAttempts: user.failedLoginAttempts,
    lockedUntil: user.lockedUntil?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    locationIds: user.locations.map((row) => row.locationId),
    locations: user.locations
      .filter((row) => row.location.isActive)
      .map((row) => ({ id: row.location.id, name: row.location.name, code: row.location.code })),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly config: ConfigService,
  ) {}

  async list(auth: AuthUser, query: UserQueryDto) {
    const { skip, take } = skipTake(query);
    const where: Prisma.UserWhereInput = {
      businessId: auth.businessId,
      deletedAt: null,
      ...(query.includeInactive ? {} : { status: 'ACTIVE' }),
      ...(query.role ? { role: query.role as UserRole } : {}),
      ...(query.status ? { status: query.status as UserStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: userInclude,
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
        skip,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(rows.map(toUserDto), total, query);
  }

  async get(auth: AuthUser, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, businessId: auth.businessId, deletedAt: null },
      include: userInclude,
    });
    if (!user) throw ApiException.notFound('User not found.', 'USER_NOT_FOUND');
    const sessions = await this.activeSessionCount(user.id);
    return { ...toUserDto(user), activeSessions: sessions };
  }

  async create(auth: AuthUser, dto: CreateUserDto, actor: AuditActor) {
    await this.access.assertCanAddUser(auth.businessId);
    await this.access.validateLocationIds(auth.businessId, dto.locationIds);
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw ApiException.conflict('An account with this email already exists.', 'EMAIL_IN_USE');
    }
    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          businessId: auth.businessId,
          name: dto.name.trim(),
          email,
          passwordHash,
          role: dto.role as UserRole,
          locations: {
            create: [...new Set(dto.locationIds)].map((locationId) => ({
              locationId,
              businessId: auth.businessId,
            })),
          },
        },
        include: userInclude,
      });
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'user.created',
          entityType: 'User',
          entityId: created.id,
          actor,
          after: { name: created.name, email: created.email, role: created.role, locationIds: dto.locationIds },
        },
        tx,
      );
      return created;
    });
    return toUserDto(user);
  }

  async update(auth: AuthUser, id: string, dto: UpdateUserDto, actor: AuditActor) {
    const existing = await this.prisma.user.findFirst({
      where: { id, businessId: auth.businessId, deletedAt: null },
      include: userInclude,
    });
    if (!existing) throw ApiException.notFound('User not found.', 'USER_NOT_FOUND');
    if (id === auth.id && (dto.role !== undefined || dto.status === 'SUSPENDED')) {
      throw ApiException.forbidden('You cannot change your own role or suspend yourself.', 'SELF_LOCKOUT');
    }
    if (dto.locationIds) {
      await this.access.validateLocationIds(auth.businessId, dto.locationIds);
    }
    if (
      existing.role === 'OWNER' &&
      ((dto.role !== undefined && dto.role !== 'OWNER') || dto.status === 'SUSPENDED')
    ) {
      await this.assertNotLastOwner(auth.businessId, existing.id);
    }
    if (dto.status === 'ACTIVE' && existing.status !== 'ACTIVE') {
      await this.access.assertCanAddUser(auth.businessId);
    }

    const roleChanged = dto.role !== undefined && dto.role !== existing.role;
    const suspended = dto.status === 'SUSPENDED' && existing.status !== 'SUSPENDED';
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.role !== undefined ? { role: dto.role as UserRole } : {}),
          ...(dto.status !== undefined ? { status: dto.status as UserStatus } : {}),
        },
        include: userInclude,
      });
      if (dto.locationIds) {
        await tx.userLocation.deleteMany({ where: { userId: id } });
        await tx.userLocation.createMany({
          data: [...new Set(dto.locationIds)].map((locationId) => ({
            userId: id,
            locationId,
            businessId: auth.businessId,
          })),
        });
      }
      if (roleChanged || suspended) {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'user.updated',
          entityType: 'User',
          entityId: id,
          actor,
          before: {
            name: existing.name,
            role: existing.role,
            status: existing.status,
            locationIds: existing.locations.map((row) => row.locationId),
          },
          after: {
            name: user.name,
            role: user.role,
            status: user.status,
            locationIds: dto.locationIds ?? existing.locations.map((row) => row.locationId),
          },
        },
        tx,
      );
      if (roleChanged) {
        await this.audit.record(
          {
            businessId: auth.businessId,
            action: 'user.role_changed',
            entityType: 'User',
            entityId: id,
            actor,
            before: { role: existing.role },
            after: { role: user.role },
            reason: 'Role changed; existing sessions were revoked',
          },
          tx,
        );
      }
      return user;
    });
    const locations = await this.prisma.userLocation.findMany({
      where: { userId: id },
      include: { location: { select: { id: true, name: true, code: true, isActive: true } } },
    });
    return toUserDto({ ...updated, locations });
  }

  async resetPassword(auth: AuthUser, id: string, dto: ResetUserPasswordDto, actor: AuditActor) {
    const existing = await this.prisma.user.findFirst({
      where: { id, businessId: auth.businessId, deletedAt: null },
      select: { id: true, email: true, role: true },
    });
    if (!existing) throw ApiException.notFound('User not found.', 'USER_NOT_FOUND');
    if (existing.role === 'OWNER' && auth.role !== 'OWNER') {
      throw ApiException.forbidden('Only an owner can reset another owner’s password.', 'OWNER_REQUIRED');
    }
    const passwordHash = await this.hashPassword(dto.password);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'user.password_reset',
          entityType: 'User',
          entityId: id,
          actor,
          after: { email: existing.email, sessionsRevoked: true },
          reason: 'Password reset by an administrator',
        },
        tx,
      );
    });
    return { success: true };
  }

  async unlock(auth: AuthUser, id: string, actor: AuditActor) {
    const existing = await this.prisma.user.findFirst({
      where: { id, businessId: auth.businessId, deletedAt: null },
      select: { id: true, email: true, lockedUntil: true },
    });
    if (!existing) throw ApiException.notFound('User not found.', 'USER_NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'user.unlocked',
          entityType: 'User',
          entityId: id,
          actor,
          before: { lockedUntil: existing.lockedUntil?.toISOString() ?? null },
          after: { lockedUntil: null },
        },
        tx,
      );
    });
    return { success: true };
  }

  async archive(auth: AuthUser, id: string, actor: AuditActor) {
    const existing = await this.prisma.user.findFirst({
      where: { id, businessId: auth.businessId, deletedAt: null },
      include: userInclude,
    });
    if (!existing) throw ApiException.notFound('User not found.', 'USER_NOT_FOUND');
    if (id === auth.id) {
      throw ApiException.forbidden('You cannot remove your own account.', 'SELF_REMOVAL');
    }
    if (existing.role === 'OWNER') await this.assertNotLastOwner(auth.businessId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'SUSPENDED' },
      });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          businessId: auth.businessId,
          action: 'user.removed',
          entityType: 'User',
          entityId: id,
          actor,
          before: { name: existing.name, email: existing.email, role: existing.role },
          after: { removed: true },
          reason: 'Account deactivated; sales and audit history retained',
        },
        tx,
      );
    });
    return { success: true };
  }

  async sessions(auth: AuthUser, id: string) {
    await this.assertUser(auth.businessId, id);
    const rows = await this.prisma.session.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        ip: true,
        userAgent: true,
        rememberMe: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    return {
      data: rows.map((row) => ({
        ...row,
        active: !row.revokedAt && row.expiresAt > new Date(),
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        revokedAt: row.revokedAt?.toISOString() ?? null,
      })),
    };
  }

  async revokeSessions(auth: AuthUser, id: string, sessionId: string | null, actor: AuditActor) {
    await this.assertUser(auth.businessId, id);
    const result = await this.prisma.session.updateMany({
      where: {
        userId: id,
        revokedAt: null,
        ...(sessionId ? { id: sessionId } : {}),
      },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      businessId: auth.businessId,
      action: 'user.sessions_revoked',
      entityType: 'User',
      entityId: id,
      actor,
      metadata: { sessionId, revoked: result.count },
    });
    return { revoked: result.count };
  }

  private async assertUser(businessId: string, id: string) {
    const count = await this.prisma.user.count({ where: { id, businessId, deletedAt: null } });
    if (!count) throw ApiException.notFound('User not found.', 'USER_NOT_FOUND');
  }

  private async assertNotLastOwner(businessId: string, userId: string) {
    const owners = await this.prisma.user.count({
      where: { businessId, role: 'OWNER', status: 'ACTIVE', deletedAt: null, id: { not: userId } },
    });
    if (owners === 0) {
      throw ApiException.conflict(
        'A business must keep at least one active owner. Promote another owner first.',
        'LAST_OWNER',
      );
    }
  }

  private activeSessionCount(userId: string) {
    return this.prisma.session.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  private hashPassword(password: string): Promise<string> {
    const rounds = this.config.get<string>('NODE_ENV') === 'test' ? 10 : 12;
    return bcrypt.hash(password, rounds);
  }
}
