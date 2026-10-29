import type { AuthUser } from '../common/auth/auth-user';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser;
      requestId: string;
      cookies?: Record<string, string>;
    }
  }
}

export {};
