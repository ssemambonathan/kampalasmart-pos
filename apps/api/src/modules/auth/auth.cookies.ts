import { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from '../../common/auth/auth.constants';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  refreshExpiresAt: Date;
}

export interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

function baseOptions(config: ConfigService): CookieOptions {
  const options: CookieOptions = {
    secure: config.get<boolean>('COOKIE_SECURE') === true,
    sameSite: 'lax',
  };
  const domain = config.get<string>('COOKIE_DOMAIN');
  if (domain) options.domain = domain;
  return options;
}

function ttlToMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) return 15 * 60_000;
  const value = Number(match[1]);
  const unit = match[2];
  const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return value * factor;
}

export function buildAuthCookies(tokens: IssuedTokens, config: ConfigService): CookieToSet[] {
  const base = baseOptions(config);
  const accessTtl = ttlToMs(config.get<string>('JWT_ACCESS_TTL') ?? '15m');
  const refreshMs = Math.max(0, tokens.refreshExpiresAt.getTime() - Date.now());
  return [
    {
      name: ACCESS_COOKIE,
      value: tokens.accessToken,
      options: { ...base, httpOnly: true, path: '/', maxAge: accessTtl },
    },
    {
      name: REFRESH_COOKIE,
      value: tokens.refreshToken,
      options: { ...base, httpOnly: true, path: REFRESH_COOKIE_PATH, maxAge: refreshMs },
    },
    {
      name: CSRF_COOKIE,
      value: tokens.csrfToken,
      options: { ...base, httpOnly: false, path: '/', maxAge: refreshMs },
    },
  ];
}

export function clearAuthCookies(config: ConfigService): CookieToSet[] {
  const base = baseOptions(config);
  return [
    { name: ACCESS_COOKIE, value: '', options: { ...base, httpOnly: true, path: '/', maxAge: 0 } },
    {
      name: REFRESH_COOKIE,
      value: '',
      options: { ...base, httpOnly: true, path: REFRESH_COOKIE_PATH, maxAge: 0 },
    },
    { name: CSRF_COOKIE, value: '', options: { ...base, httpOnly: false, path: '/', maxAge: 0 } },
  ];
}
