import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { promises as fs } from 'fs';
import { join } from 'path';
import type { Response } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { Public } from '../../common/auth/auth.decorators';

@Public()
@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      service: 'kampalasmart-api',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const started = Date.now();
    const databaseHealthy = await this.prisma.ping();
    const databaseLatencyMs = Date.now() - started;
    const redis = await this.redis.ping();
    const storage = await this.checkStorage();
    const checks = {
      api: 'HEALTHY' as const,
      database: databaseHealthy ? ('HEALTHY' as const) : ('UNHEALTHY' as const),
      redis,
      storage,
      syncEngine: databaseHealthy ? ('HEALTHY' as const) : ('UNHEALTHY' as const),
    };
    const status =
      checks.database === 'HEALTHY' && checks.storage === 'HEALTHY' ? 'HEALTHY' : 'UNHEALTHY';
    if (status !== 'HEALTHY') res.status(503);
    return {
      status,
      checks,
      databaseLatencyMs,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get()
  async root(@Res({ passthrough: true }) res: Response) {
    return this.ready(res);
  }

  private async checkStorage(): Promise<'HEALTHY' | 'UNHEALTHY'> {
    const dir = process.env.STORAGE_DIR || join(process.cwd(), 'storage');
    try {
      await fs.mkdir(dir, { recursive: true });
      const probe = join(dir, `.health-${process.pid}`);
      await fs.writeFile(probe, 'ok');
      await fs.unlink(probe);
      return 'HEALTHY';
    } catch {
      return 'UNHEALTHY';
    }
  }
}
