import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, Permission } from '@kampalasmart/shared';
import { AUDIT_ACTIONS } from '@kampalasmart/shared';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../errors/api-exception';
import { PERMISSIONS_KEY } from './auth.decorators';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.auth;
    if (!auth) throw ApiException.unauthenticated();

    const missing = required.filter((permission) => !hasPermission(auth.role, permission));
    if (missing.length) {
      await this.audit.record({
        businessId: auth.businessId,
        action: AUDIT_ACTIONS.UNAUTHORIZED_ATTEMPT,
        entityType: 'Permission',
        entityId: null,
        actor: {
          id: auth.id,
          name: auth.name,
          role: auth.role,
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
          requestId: request.requestId,
        },
        metadata: {
          method: request.method,
          path: request.originalUrl,
          required: missing,
        },
        reason: 'Missing permission',
      });
      throw ApiException.forbidden();
    }
    return true;
  }
}
