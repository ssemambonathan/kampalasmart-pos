import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { ApiException } from '../errors/api-exception';
import { IS_PUBLIC_KEY } from './auth.decorators';
import { CSRF_COOKIE } from './auth.constants';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Double-submit CSRF protection for cookie-authenticated mutations. */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (!request.auth || request.auth.source === 'bearer') return true;

    const cookieToken = request.cookies?.[CSRF_COOKIE];
    const headerToken = request.headers['x-csrf-token'];
    if (
      typeof cookieToken !== 'string' ||
      typeof headerToken !== 'string' ||
      cookieToken.length < 20 ||
      headerToken.length !== cookieToken.length ||
      !timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken))
    ) {
      throw new ApiException(
        'CSRF_TOKEN_INVALID',
        'Your security token is missing or invalid. Refresh the page and try again.',
        403,
      );
    }
    return true;
  }
}
