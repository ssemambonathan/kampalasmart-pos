import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { CsrfGuard } from './csrf.guard';
import { RateLimitGuard } from './rate-limit.guard';
import { IS_PUBLIC_KEY, RATE_LIMIT_KEY } from './auth.decorators';
import type { RedisService } from '../redis/redis.service';
import { ApiException } from '../errors/api-exception';

function contextFor(
  request: Partial<Request>,
  response: Partial<Response>,
  handler: () => void,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function rateLimitedHandler(): void {
  return undefined;
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard(new Reflector());
  const token = 'a'.repeat(32);

  const request = (overrides: Partial<Request> = {}): Partial<Request> => ({
    method: 'POST',
    auth: { source: 'cookie' } as Request['auth'],
    cookies: { ks_csrf: token },
    headers: { 'x-csrf-token': token },
    ...overrides,
  });

  it('lets public and safe requests through', () => {
    const publicHandler = () => undefined;
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, publicHandler);
    expect(guard.canActivate(contextFor(request(), {}, publicHandler))).toBe(true);

    expect(guard.canActivate(contextFor(request({ method: 'GET' }), {}, () => undefined))).toBe(
      true,
    );
  });

  it('skips the check when authentication came from a bearer token', () => {
    const bearer = request({ auth: { source: 'bearer' } as Request['auth'] });
    expect(guard.canActivate(contextFor(bearer, {}, () => undefined))).toBe(true);
  });

  it('allows a matching double-submit token', () => {
    expect(guard.canActivate(contextFor(request(), {}, () => undefined))).toBe(true);
  });

  it('rejects missing, short or mismatched tokens', () => {
    const cases: Array<Partial<Request>> = [
      request({ cookies: {} }),
      request({ headers: {} }),
      request({ headers: { 'x-csrf-token': 'b'.repeat(32) } }),
      request({ cookies: { ks_csrf: 'short' }, headers: { 'x-csrf-token': 'short' } }),
      request({ headers: { 'x-csrf-token': 'b'.repeat(31) } }),
    ];
    for (const value of cases) {
      expect(() => guard.canActivate(contextFor(value, {}, () => undefined))).toThrow(
        ApiException,
      );
    }
  });
});

describe('RateLimitGuard', () => {
  const reflector = new Reflector();
  const response = () => ({ setHeader: jest.fn() }) as unknown as Response;

  function redisMock() {
    return {
      incrementWithTtl: jest.fn(),
      getTtlSeconds: jest.fn(),
    };
  }

  function configMock() {
    return {
      get: jest.fn((key: string) => {
        if (key === 'LOGIN_RATE_LIMIT') return 2;
        if (key === 'LOGIN_RATE_WINDOW_SECONDS') return 60;
        return undefined;
      }),
    };
  }

  it('ignores handlers without a rate limit decorator', async () => {
    const redis = redisMock();
    const guard = new RateLimitGuard(
      reflector,
      redis as unknown as RedisService,
      configMock() as unknown as ConfigService,
    );
    const res = response();
    expect(
      await guard.canActivate(contextFor({ ip: '10.0.0.1' }, res, () => undefined)),
    ).toBe(true);
    expect(redis.incrementWithTtl).not.toHaveBeenCalled();
  });

  it('falls back to an in-memory window and blocks past the limit', async () => {
    Reflect.defineMetadata(
      RATE_LIMIT_KEY,
      { limit: 2, windowSeconds: 60, byEmail: true },
      rateLimitedHandler,
    );
    const redis = redisMock();
    redis.incrementWithTtl.mockResolvedValue(null);
    const guard = new RateLimitGuard(
      reflector,
      redis as unknown as RedisService,
      configMock() as unknown as ConfigService,
    );
    const res = response();
    const request = {
      ip: '10.0.0.1',
      body: { email: '  CASHIER@Example.Test ' },
    };
    const ctx = contextFor(request, res, rateLimitedHandler);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    expect(redis.incrementWithTtl).toHaveBeenCalledWith(
      'rl:TestController.rateLimitedHandler:10.0.0.1:cashier@example.test',
      60,
    );
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '2');
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
  });

  it('prefers Redis counters and passes its retry window through', async () => {
    Reflect.defineMetadata(
      RATE_LIMIT_KEY,
      { limit: 0, windowSeconds: 0, byUser: true },
      rateLimitedHandler,
    );
    const redis = redisMock();
    redis.incrementWithTtl.mockResolvedValue(3);
    redis.getTtlSeconds.mockResolvedValue(42);
    const config = configMock();
    const guard = new RateLimitGuard(
      reflector,
      redis as unknown as RedisService,
      config as unknown as ConfigService,
    );
    const res = response();
    const ctx = contextFor(
      { ip: '10.0.0.2', auth: { id: 'user-1' } as Request['auth'] },
      res,
      rateLimitedHandler,
    );

    try {
      await guard.canActivate(ctx);
      throw new Error('Expected the guard to reject the request.');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      const exception = error as ApiException;
      expect(exception.code).toBe('RATE_LIMITED');
      expect(exception.getStatus()).toBe(429);
      expect(exception.headers?.['Retry-After']).toBe('42');
    }

    expect(redis.incrementWithTtl).toHaveBeenCalledWith(
      'rl:TestController.rateLimitedHandler:user:user-1',
      60,
    );
    expect(config.get).toHaveBeenCalledWith('LOGIN_RATE_LIMIT');
    expect(config.get).toHaveBeenCalledWith('LOGIN_RATE_WINDOW_SECONDS');
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
  });

  it('reports the remaining allowance while under the limit', async () => {
    Reflect.defineMetadata(RATE_LIMIT_KEY, { limit: 5, windowSeconds: 30 }, rateLimitedHandler);
    const redis = redisMock();
    redis.incrementWithTtl.mockResolvedValue(1);
    redis.getTtlSeconds.mockResolvedValue(29);
    const guard = new RateLimitGuard(
      reflector,
      redis as unknown as RedisService,
      configMock() as unknown as ConfigService,
    );
    const res = response();

    await expect(
      guard.canActivate(contextFor({ ip: '10.0.0.3' }, res, rateLimitedHandler)),
    ).resolves.toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '5');
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '4');
  });
});
