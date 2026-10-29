import { Injectable, Logger, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Structured JSON logger — safe for shipping to log collectors. */
@Injectable()
export class AppLogger implements LoggerService {
  private readonly threshold: number;
  private readonly fallback = new Logger('AppLogger');

  constructor(private readonly config: ConfigService) {
    const level = (config.get<string>('LOG_LEVEL') ?? 'info') as Level;
    this.threshold = ORDER[level] ?? ORDER.info;
  }

  private write(level: Level, message: unknown, context?: string, meta?: Record<string, unknown>): void {
    if (ORDER[level] < this.threshold) return;
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      context: context ?? 'app',
      message: typeof message === 'string' ? message : safeStringify(message),
      ...(meta ?? {}),
    };
    const line = JSON.stringify(payload);
    if (level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }
  info(message: unknown, context?: string, meta?: Record<string, unknown>): void {
    this.write('info', message, context, meta);
  }
  warn(message: unknown, context?: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, context, meta);
  }
  error(message: unknown, stack?: string, context?: string, meta?: Record<string, unknown>): void {
    this.write('error', message, context, { stack, ...(meta ?? {}) });
  }
  debug(message: unknown, context?: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, context, meta);
  }
  verbose(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }
  fatal(message: unknown, context?: string): void {
    this.write('error', message, context);
    this.fallback.error(message);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
