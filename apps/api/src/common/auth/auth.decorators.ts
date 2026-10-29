import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@kampalasmart/shared';
import type { Request } from 'express';
import type { AuthUser } from './auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSIONS_KEY = 'requiredPermissions';
export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  /** Include the submitted email in the key (login / password reset). */
  byEmail?: boolean;
  /** Include the authenticated user id instead of just IP. */
  byUser?: boolean;
}

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest<Request>();
  if (!request.auth) throw new Error('CurrentAuth used on an unauthenticated route');
  return request.auth;
});
