import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, finalize } from 'rxjs';
import { AppLogger } from '../logging/app-logger.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: AppLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();
    const isHealth = req.originalUrl?.startsWith('/health');
    const isDocs = req.originalUrl?.startsWith('/api/docs');

    return next.handle().pipe(
      finalize(() => {
        if (isHealth || isDocs) return;
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        this.logger.info('request', 'HTTP', {
          requestId: req.requestId,
          method: req.method,
          path: req.originalUrl?.split('?')[0],
          status: res.statusCode,
          durationMs: Math.round(durationMs * 10) / 10,
          userId: req.auth?.id,
          businessId: req.auth?.businessId,
          ip: req.ip,
        });
      }),
    );
  }
}
