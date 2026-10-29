import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ApiException } from '../errors/api-exception';
import { RATE_LIMIT_KEY, RateLimitOptions } from './auth.decorators';
import { RedisService } from '../redis/redis.service';

interface MemoryCounter {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window rate limiter. Uses Redis when available and falls back to a
 * bounded in-process map so sensitive endpoints are never unprotected.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly memory = new Map<string, MemoryCounter>();
  private lastPrune = Date.now();

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const limit =
      options.limit > 0
        ? options.limit
        : this.config.get<number>('LOGIN_RATE_LIMIT') ?? 8;
    const windowSeconds =
      options.windowSeconds > 0
        ? options.windowSeconds
        : this.config.get<number>('LOGIN_RATE_WINDOW_SECONDS') ?? 900;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    const scope = `${context.getClass().name}.${context.getHandler().name}`;
    let identity = ip;

    if (options.byUser && request.auth) identity = `user:${request.auth.id}`;
    if (options.byEmail) {
      const email = typeof request.body?.email === 'string' ? request.body.email.toLowerCase().trim() : '';
      if (email) identity = `${ip}:${email.slice(0, 120)}`;
    }

    const key = `rl:${scope}:${identity}`;
    const redisCount = await this.redis.incrementWithTtl(key, windowSeconds);
    let count = redisCount;
    let retryAfter = windowSeconds;

    if (redisCount === null) {
      const now = Date.now();
      this.prune(now);
      const existing = this.memory.get(key);
      if (!existing || existing.resetAt <= now) {
        this.memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
        count = 1;
      } else {
        existing.count += 1;
        count = existing.count;
        retryAfter = Math.ceil((existing.resetAt - now) / 1000);
      }
    } else {
      const ttl = await this.redis.getTtlSeconds(key);
      if (ttl) retryAfter = ttl;
    }

    const remaining = Math.max(0, limit - (count ?? 0));
    response.setHeader('X-RateLimit-Limit', String(limit));
    response.setHeader('X-RateLimit-Remaining', String(remaining));

    if ((count ?? 0) > limit) {
      throw ApiException.tooManyRequests(
        'Too many attempts. Please wait before trying again.',
        retryAfter,
      );
    }
    return true;
  }

  private prune(now: number): void {
    if (now - this.lastPrune < 60_000) return;
    this.lastPrune = now;
    for (const [key, value] of this.memory) {
      if (value.resetAt <= now) this.memory.delete(key);
    }
  }
}
