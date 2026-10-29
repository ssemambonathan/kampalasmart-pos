import { HttpException, HttpStatus } from '@nestjs/common';

/** Application-level error carrying a stable, client-safe machine code. */
export class ApiException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
    public readonly details?: unknown,
    public readonly headers?: Record<string, string>,
  ) {
    super({ code, message, details }, status);
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: unknown): ApiException {
    return new ApiException(code, message, HttpStatus.BAD_REQUEST, details);
  }
  static unauthenticated(message = 'Sign in to continue.'): ApiException {
    return new ApiException('UNAUTHENTICATED', message, HttpStatus.UNAUTHORIZED);
  }
  static forbidden(message = 'You do not have permission to perform this action.', code = 'FORBIDDEN'): ApiException {
    return new ApiException(code, message, HttpStatus.FORBIDDEN);
  }
  static notFound(message = 'The requested resource was not found.', code = 'NOT_FOUND'): ApiException {
    return new ApiException(code, message, HttpStatus.NOT_FOUND);
  }
  static conflict(message: string, code = 'CONFLICT', details?: unknown): ApiException {
    return new ApiException(code, message, HttpStatus.CONFLICT, details);
  }
  static unprocessable(message: string, code = 'UNPROCESSABLE', details?: unknown): ApiException {
    return new ApiException(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
  static tooManyRequests(message: string, retryAfterSeconds: number): ApiException {
    return new ApiException('RATE_LIMITED', message, HttpStatus.TOO_MANY_REQUESTS, undefined, {
      'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
    });
  }
  static internal(message = 'Something went wrong. Please try again.'): ApiException {
    return new ApiException('INTERNAL_ERROR', message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
