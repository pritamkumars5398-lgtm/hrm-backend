import type { Role } from '../users/user.entity';

export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED';

export interface Invite {
  id: string;
  organizationId: string;
  email: string;
  permissions: string[];
  status: InviteStatus;
  /** Opaque, unguessable — it is the only thing standing between a stranger and your org. */
  token: string;
  invitedBy: string;
  createdAt: Date;
  expiresAt: Date;
}

/** The token is a credential: never return it except to the person who created the invite. */
export type PublicInvite = Omit<Invite, 'token'>;

export function toPublicInvite(invite: Invite): PublicInvite {
  const { token: _token, ...safe } = invite;
  return safe;
}
