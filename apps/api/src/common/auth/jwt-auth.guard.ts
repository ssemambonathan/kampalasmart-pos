import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { permissionsForRole } from '@kampalasmart/shared';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../errors/api-exception';
import { IS_PUBLIC_KEY } from './auth.decorators';
import type { AuthUser } from './auth-user';
import { ACCESS_COOKIE } from './auth.constants';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  businessId: string;
  role: string;
  type: 'access';
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const bearer = extractBearer(request.headers.authorization);
    const cookieToken = request.cookies?.[ACCESS_COOKIE];
    const token = bearer ?? cookieToken;
    if (!token) throw ApiException.unauthenticated();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw ApiException.unauthenticated('Your session has expired. Please sign in again.');
    }
    if (payload.type !== 'access' || !payload.sid || !payload.sub) {
      throw ApiException.unauthenticated();
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: {
        user: {
          include: {
            business: true,
            locations: { select: { locationId: true } },
          },
        },
      },
    });
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.user.deletedAt ||
      session.user.business.deletedAt
    ) {
      throw ApiException.unauthenticated('Your session has expired. Please sign in again.');
    }
    if (session.user.businessId !== payload.businessId) {
      throw ApiException.unauthenticated();
    }
    if (session.user.status !== 'ACTIVE') {
      throw ApiException.forbidden('This account has been suspended.', 'ACCOUNT_SUSPENDED');
    }

    const auth: AuthUser = {
      id: session.user.id,
      businessId: session.user.businessId,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      permissions: permissionsForRole(session.user.role),
      locationIds: session.user.locations.map((l) => l.locationId),
      sessionId: session.id,
      source: bearer ? 'bearer' : 'cookie',
    };
    request.auth = auth;

    // Throttle session bookkeeping: only update when meaningfully stale.
    if (session.lastUsedAt.getTime() < Date.now() - 5 * 60_000) {
      await this.prisma.session
        .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }
    return true;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
