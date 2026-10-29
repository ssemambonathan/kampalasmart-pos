import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PricingError } from '@kampalasmart/shared';
import type { Request, Response } from 'express';
import { AppLogger } from '../logging/app-logger.service';
import { ApiException } from './api-exception';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.requestId;

    const { status, body, headers, logStack } = this.normalize(exception);
    if (headers) {
      for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
    }

    if (status >= 500) {
      this.logger.error(
        `Unhandled ${status} on ${request.method} ${request.originalUrl}: ${body.message}`,
        logStack,
        'HttpError',
        {
          requestId,
          userId: request.auth?.id,
          businessId: request.auth?.businessId,
          path: request.originalUrl,
          method: request.method,
        },
      );
    } else if (status === 401 || status === 403 || status === 429) {
      this.logger.warn(`${body.code} on ${request.method} ${request.originalUrl}`, 'HttpError', {
        requestId,
        status,
        code: body.code,
        userId: request.auth?.id,
        businessId: request.auth?.businessId,
        ip: request.ip,
      });
    }

    response.status(status).json({
      error: {
        ...body,
        requestId,
      },
    });
  }

  private normalize(exception: unknown): {
    status: number;
    body: ErrorBody;
    headers?: Record<string, string>;
    logStack?: string;
  } {
    if (exception instanceof ApiException) {
      return {
        status: exception.getStatus(),
        body: { code: exception.code, message: extractMessage(exception), details: safeDetails(exception.details) },
        headers: exception.headers,
        logStack: exception.stack,
      };
    }
    if (exception instanceof PricingError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        body: { code: exception.code, message: exception.message, details: safeDetails(exception.details) },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      if (typeof raw === 'string') {
        return { status, body: { code: this.codeForStatus(status), message: raw }, logStack: exception.stack };
      }
      const rawObj = raw as Record<string, unknown>;
      const rawMessage = rawObj.message;
      const messages = Array.isArray(rawMessage) ? rawMessage.map(String) : undefined;
      const message =
        messages && messages.length
          ? messages[0] ?? 'The request could not be processed.'
          : typeof rawMessage === 'string'
            ? rawMessage
            : this.messageForStatus(status);
      return {
        status,
        body: {
          code: typeof rawObj.code === 'string' ? rawObj.code : this.codeForStatus(status),
          message,
          details: messages && messages.length > 1 ? { issues: messages } : undefined,
        },
        logStack: exception.stack,
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.normalizePrisma(exception);
    }
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: { code: 'INVALID_QUERY', message: 'The request contained invalid data.' },
        logStack: exception.stack,
      };
    }
    if (exception instanceof Error) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        body: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
        logStack: exception.stack,
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
    };
  }

  private normalizePrisma(error: Prisma.PrismaClientKnownRequestError): {
    status: number;
    body: ErrorBody;
    logStack?: string;
  } {
    switch (error.code) {
      case 'P2002': {
        const targets = (error.meta?.target as string[] | undefined) ?? [];
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code: 'DUPLICATE_RECORD',
            message: targets.length
              ? `A record with this ${targets.join(', ')} already exists.`
              : 'A duplicate record already exists.',
            details: { fields: targets },
          },
        };
      }
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code: 'RELATED_RECORD',
            message: 'This record is still referenced by other data and cannot be removed.',
          },
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          body: { code: 'NOT_FOUND', message: 'The requested resource was not found.' },
        };
      case 'P2034':
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code: 'WRITE_CONFLICT',
            message: 'This record was updated by someone else. Please review and try again.',
          },
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: { code: 'DATABASE_ERROR', message: 'A database error occurred.' },
          logStack: error.stack,
        };
    }
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case 400:
        return 'BAD_REQUEST';
      case 401:
        return 'UNAUTHENTICATED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 422:
        return 'UNPROCESSABLE';
      case 429:
        return 'RATE_LIMITED';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
    }
  }

  private messageForStatus(status: number): string {
    switch (status) {
      case 400:
        return 'The request could not be processed.';
      case 401:
        return 'Sign in to continue.';
      case 403:
        return 'You do not have permission to perform this action.';
      case 404:
        return 'The requested resource was not found.';
      case 409:
        return 'The request conflicts with the current state of the data.';
      case 429:
        return 'Too many requests. Please wait and try again.';
      default:
        return status >= 500 ? 'Something went wrong. Please try again.' : 'The request failed.';
    }
  }
}

function extractMessage(exception: ApiException): string {
  const response = exception.getResponse();
  if (typeof response === 'object' && response && 'message' in response) {
    return String((response as { message: unknown }).message);
  }
  return exception.message;
}

/** Never leak database/internal detail objects to clients. */
function safeDetails(details: unknown): unknown {
  if (details === undefined || details === null) return undefined;
  if (typeof details === 'object') {
    try {
      const json = JSON.parse(JSON.stringify(details));
      delete json.stack;
      delete json.query;
      return json;
    } catch {
      return undefined;
    }
  }
  return details;
}
