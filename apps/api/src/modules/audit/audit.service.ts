import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { planFor, type AuditLogEntry } from '@kampalasmart/shared';
import { ApiException } from '../../common/errors/api-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { toCsv } from '../../common/csv';
import type { AuthUser } from '../../common/auth/auth-user';
import type { AuditQueryDto } from './audit.dto';

function toEntry(row: {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}): AuditLogEntry {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actorId: row.actorId,
    actorName: row.actorName,
    actorRole: row.actorRole as AuditLogEntry['actorRole'],
    before: row.before,
    after: row.after,
    reason: row.reason,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(auth: AuthUser, query: AuditQueryDto) {
    const { skip, take } = skipTake(query);
    const where = this.where(auth, query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginate(rows.map(toEntry), total, query);
  }

  async get(auth: AuthUser, id: string) {
    const row = await this.prisma.auditLog.findFirst({
      where: { id, businessId: auth.businessId },
    });
    if (!row) throw ApiException.notFound('Audit event not found.', 'AUDIT_NOT_FOUND');
    return toEntry(row);
  }

  async actions(auth: AuthUser) {
    const rows = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where: { businessId: auth.businessId },
      orderBy: { action: 'asc' },
      _count: { _all: true },
    });
    return rows
      .map((row) => ({ action: row.action, count: row._count._all }))
      .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action));
  }

  async exportCsv(auth: AuthUser, query: AuditQueryDto) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: { plan: true, currency: true },
    });
    if (!planFor(business.plan).features.auditExport) {
      throw ApiException.forbidden(
        'Audit export is available on Growth and Enterprise plans.',
        'PLAN_FEATURE_UNAVAILABLE',
      );
    }
    const rows = await this.prisma.auditLog.findMany({
      where: this.where(auth, query),
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });
    const csv = toCsv(
      [
        'created_at',
        'action',
        'entity_type',
        'entity_id',
        'actor_name',
        'actor_role',
        'reason',
        'ip',
        'before',
        'after',
        'metadata',
      ],
      rows.map((row) => [
        row.createdAt.toISOString(),
        row.action,
        row.entityType,
        row.entityId ?? '',
        row.actorName ?? 'System',
        row.actorRole ?? '',
        row.reason ?? '',
        row.ip ?? '',
        row.before === null ? '' : JSON.stringify(row.before),
        row.after === null ? '' : JSON.stringify(row.after),
        row.metadata === null ? '' : JSON.stringify(row.metadata),
      ]),
    );
    return {
      filename: `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: 'text/csv; charset=utf-8',
      content: csv,
    };
  }

  private where(auth: AuthUser, query: AuditQueryDto): Prisma.AuditLogWhereInput {
    return {
      businessId: auth.businessId,
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.search
        ? {
            OR: [
              { action: { contains: query.search, mode: 'insensitive' } },
              { entityType: { contains: query.search, mode: 'insensitive' } },
              { actorName: { contains: query.search, mode: 'insensitive' } },
              { entityId: { contains: query.search, mode: 'insensitive' } },
              { reason: { contains: query.search, mode: 'insensitive' } },
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
  }
}
