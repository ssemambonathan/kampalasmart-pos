import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE_ID = /^[A-Za-z0-9._:-]{8,64}$/;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
