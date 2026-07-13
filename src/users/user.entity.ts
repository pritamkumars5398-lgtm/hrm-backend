export type Role = 'OWNER' | 'HR' | 'MANAGER';

export interface User {
  id: string;
  /** null until the Company Details step creates the organisation (§11.2). */
  organizationId: string | null;
  email: string;
  /** bcrypt hash. Empty for Google-authenticated accounts, which have no local password. */
  passwordHash: string;
  name: string;
  jobTitle: string;
  role: Role;
  avatarInitials: string;
  createdAt: Date;
}

/** What is safe to send to the client — never the hash. */
export type PublicUser = Omit<User, 'passwordHash'>;

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}
