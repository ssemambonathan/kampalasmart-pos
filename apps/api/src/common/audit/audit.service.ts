import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { UserRole } from '@kampalasmart/shared';
import { AppLogger } from '../logging/app-logger.service';
import { PrismaService, Tx } from '../prisma/prisma.service';

export interface AuditActor {
  id: string;
  name: string;
  role: UserRole | string;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditInput {
  businessId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  actor?: AuditActor | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: unknown;
}

const SENSITIVE_KEY = /password|token|secret|hash|authorization|cookie/i;

/** Recursively strips credential material before persisting a snapshot. */
export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[truncated]';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeAuditValue(item, depth + 1));
  if (typeof value === 'object') {
    if ('toJSON' in value && typeof (value as { toJSON: unknown }).toJSON === 'function') {
      try {
        return sanitizeAuditValue(JSON.parse(JSON.stringify(value)), depth + 1);
      } catch {
        return String(value);
      }
    }
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) continue;
      output[key] = sanitizeAuditValue(nested, depth + 1);
    }
    return output;
  }
  return String(value);
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Persist an audit event. `tx` makes the audit part of the business
   * transaction (used for sales, refunds, inventory and permission changes).
   * Without `tx` failures are logged but never break the request.
   */
  async record(input: AuditInput, tx?: Tx): Promise<void> {
    const data: Prisma.AuditLogCreateInput = {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: toJson(input.before),
      after: toJson(input.after),
      reason: input.reason ?? null,
      ip: input.actor?.ip ?? null,
      userAgent: input.actor?.userAgent ?? null,
      requestId: input.actor?.requestId ?? null,
      metadata: toJson(input.metadata),
      actorName: input.actor?.name ?? null,
      actorRole: input.actor?.role ?? null,
      business: { connect: { id: input.businessId } },
      actor: input.actor?.id ? { connect: { id: input.actor.id } } : undefined,
    };
    if (tx) {
      await tx.auditLog.create({ data });
      return;
    }
    try {
      await this.prisma.auditLog.create({ data });
    } catch (error) {
      this.logger.error(
        `Failed to write audit event ${input.action}`,
        error instanceof Error ? error.stack : undefined,
        'Audit',
        { businessId: input.businessId, action: input.action },
      );
    }
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  const sanitized = sanitizeAuditValue(value);
  if (sanitized === undefined) return undefined;
  try {
    const serialized = JSON.stringify(sanitized);
    if (serialized.length > 16_000) {
      return { truncated: true, preview: serialized.slice(0, 16_000) };
    }
    return JSON.parse(serialized) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}
