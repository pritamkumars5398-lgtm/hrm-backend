import type { Role } from '../users/user.entity';

/**
 * Minimal JWT — only carries `sub` (userId). Company context is resolved
 * at request time via `X-Workspace-Id` header + PermissionsGuard.
 */
export interface JwtPayload {
  sub: string;
}

/** The cookie the JWT lives in. httpOnly, so scripts cannot read it. */
export const AUTH_COOKIE = 'keystone_token';
