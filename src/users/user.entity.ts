export type Role = 'OWNER' | 'HR' | 'MANAGER';

export interface User {
  id: string;
  email: string;
  /** bcrypt hash. Empty for Google-authenticated accounts, which have no local password. */
  passwordHash: string | null;
  requiresPasswordReset: boolean;
  name: string;
  avatarInitials: string;
  createdAt: Date;
}

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  organizationName?: string;
  jobTitle: string;
  permissions: string[];
}

/** The subset of fields safe to send to the client (e.g., inside the JWT or API response). */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarInitials: string;
  requiresPasswordReset: boolean;
  /** Active memberships if requested. Not present if this is just a profile fetch. */
  memberships?: Membership[];
}

export function toPublicUser(user: User, memberships: Membership[] = []): PublicUser {
  const { passwordHash: _passwordHash, createdAt: _createdAt, ...safe } = user;
  return { ...safe, memberships };
}
