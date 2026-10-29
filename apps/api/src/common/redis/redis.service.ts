import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppLogger } from '../logging/app-logger.service';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null;
  private enabled = false;
  private connected = false;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      this.logger.info('Redis not configured; using in-memory rate limiting', 'Redis');
      return;
    }
    this.enabled = true;
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 5000)),
    });
    this.client.on('error', (error) => {
      if (this.connected) {
        this.logger.warn(`Redis connection error: ${error.message}`, 'Redis');
      }
      this.connected = false;
    });
    this.client.on('ready', () => {
      this.connected = true;
      this.logger.info('Redis connected', 'Redis');
    });
    this.client.on('end', () => {
      this.connected = false;
    });
    try {
      await this.client.connect();
      this.connected = true;
    } catch (error) {
      this.connected = false;
      this.logger.warn(
        `Redis unavailable (${error instanceof Error ? error.message : 'connection failed'}); falling back to in-memory limits`,
        'Redis',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isAvailable(): boolean {
    return this.enabled && this.connected && this.client !== null;
  }

  getClient(): Redis | null {
    return this.isAvailable() ? this.client : null;
  }

  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number | null> {
    const client = this.getClient();
    if (!client) return null;
    try {
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, ttlSeconds);
      return count;
    } catch (error) {
      this.logger.warn(`Redis increment failed: ${error instanceof Error ? error.message : 'unknown'}`, 'Redis');
      return null;
    }
  }

  async getTtlSeconds(key: string): Promise<number | null> {
    const client = this.getClient();
    if (!client) return null;
    try {
      const pttl = await client.pttl(key);
      return pttl > 0 ? Math.ceil(pttl / 1000) : null;
    } catch {
      return null;
    }
  }

  async cacheGet<T>(key: string): Promise<T | null> {
    const client = this.getClient();
    if (!client) return null;
    try {
      const raw = await client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const client = this.getClient();
    if (!client) return;
    try {
      await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // Cache is optional; never fail a request because caching failed.
    }
  }

  async ping(): Promise<'HEALTHY' | 'UNHEALTHY' | 'DISABLED'> {
    if (!this.enabled) return 'DISABLED';
    const client = this.client;
    if (!client) return 'UNHEALTHY';
    try {
      if (client.status === 'wait' || client.status === 'end') {
        await client.connect();
      }
      const result = await client.ping();
      return result === 'PONG' ? 'HEALTHY' : 'UNHEALTHY';
    } catch {
      return 'UNHEALTHY';
    }
  }
}
