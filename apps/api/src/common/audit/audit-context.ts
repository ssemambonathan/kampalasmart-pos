import type { Request } from 'express';
import type { AuditActor } from './audit.service';
import type { AuthUser } from '../auth/auth-user';

/** Builds audit context from the authenticated request. */
export function auditActor(auth: AuthUser, request: Request): AuditActor {
  return {
    id: auth.id,
    name: auth.name,
    role: auth.role,
    ip: request.ip ?? request.socket?.remoteAddress ?? null,
    userAgent: request.headers['user-agent'] ?? null,
    requestId: request.requestId ?? null,
  };
}
