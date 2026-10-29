import type { Permission, UserRole } from '@kampalasmart/shared';

export interface AuthUser {
  id: string;
  businessId: string;
  email: string;
  name: string;
  role: UserRole;
  permissions: Permission[];
  locationIds: string[];
  sessionId: string;
  source: 'cookie' | 'bearer';
}
