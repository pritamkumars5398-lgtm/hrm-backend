import type { Role } from '../users/user.entity';

/**
 * §11.2 — a protected route needs to know which company and which role, not just
 * "is logged in". organizationId is null between signup and creating the company.
 */
export interface JwtPayload {
  sub: string;
  organizationId: string | null;
  role: Role;
}

/** The cookie the JWT lives in. httpOnly, so scripts cannot read it. */
export const AUTH_COOKIE = 'keystone_token';
