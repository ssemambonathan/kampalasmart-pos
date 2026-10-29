import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppLogger } from '../logging/app-logger.service';

export type Tx = Prisma.TransactionClient;

const RETRYABLE_CODES = new Set(['P2034', 'P2028']);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly logger: AppLogger) {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      errorFormat: 'minimal',
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.info('Database connection established', 'Prisma');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs a critical financial workflow with Serializable isolation and retries
   * serialization failures. Guarantees no partially applied sale/refund/transfer.
   */
  async criticalTransaction<T>(fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 20_000,
          maxWait: 10_000,
        });
      } catch (error) {
        lastError = error;
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          RETRYABLE_CODES.has(error.code) &&
          attempt < attempts
        ) {
          await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.random() * 60));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
