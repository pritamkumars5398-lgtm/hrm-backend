import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { UsersService } from '../users/users.service';
import type { Invite, InvitableRole } from './invite.entity';

const EXPIRY_DAYS = 7;

@Injectable()
export class InvitesService {
  private readonly invites = new Map<string, Invite>();

  constructor(private readonly usersService: UsersService) {}

  private newToken(): string {
    // 32 bytes of entropy — this token is the credential that grants access to
    // an organisation, so it must not be guessable.
    return randomBytes(32).toString('base64url');
  }

  private expiryFrom(date: Date): string {
    return new Date(date.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  }

  create(params: {
    organizationId: string;
    email: string;
    role: InvitableRole;
    invitedBy: string;
  }): Invite {
    const email = params.email.trim().toLowerCase();

    if (this.usersService.findByEmail(email)) {
      throw new ConflictException('That person already has an account.');
    }

    const outstanding = this.listByOrganization(params.organizationId).find(
      (i) => i.email === email && i.status === 'PENDING',
    );
    if (outstanding) {
      throw new ConflictException('There is already a pending invite for that email.');
    }

    const now = new Date();
    const invite: Invite = {
      id: `inv-${randomUUID().slice(0, 8)}`,
      organizationId: params.organizationId,
      email,
      role: params.role,
      status: 'PENDING',
      token: this.newToken(),
      invitedBy: params.invitedBy,
      createdAt: now.toISOString(),
      expiresAt: this.expiryFrom(now),
    };

    this.invites.set(invite.id, invite);
    return invite;
  }

  listByOrganization(organizationId: string): Invite[] {
    return [...this.invites.values()]
      .filter((i) => i.organizationId === organizationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Scoped by org: one company must never be able to touch another's invite. */
  private findOwned(id: string, organizationId: string): Invite {
    const invite = this.invites.get(id);
    if (!invite || invite.organizationId !== organizationId) {
      throw new NotFoundException('Invite not found.');
    }
    return invite;
  }

  revoke(id: string, organizationId: string): Invite {
    const invite = this.findOwned(id, organizationId);

    if (invite.status === 'ACCEPTED') {
      throw new BadRequestException('That invite has already been accepted.');
    }

    const revoked: Invite = { ...invite, status: 'REVOKED' };
    this.invites.set(id, revoked);
    return revoked;
  }

  /** Issues a fresh token and expiry — the old link stops working. */
  resend(id: string, organizationId: string): Invite {
    const invite = this.findOwned(id, organizationId);

    if (invite.status === 'ACCEPTED') {
      throw new BadRequestException('That invite has already been accepted.');
    }

    const now = new Date();
    const refreshed: Invite = {
      ...invite,
      status: 'PENDING',
      token: this.newToken(),
      createdAt: now.toISOString(),
      expiresAt: this.expiryFrom(now),
    };

    this.invites.set(id, refreshed);
    return refreshed;
  }

  /** Used by the accept-invite screen to show who is inviting you, and to what. */
  findByToken(token: string): Invite {
    const invite = [...this.invites.values()].find((i) => i.token === token);

    if (!invite) {
      throw new NotFoundException('This invite link is not valid.');
    }
    if (invite.status === 'REVOKED') {
      throw new BadRequestException('This invite has been revoked.');
    }
    if (invite.status === 'ACCEPTED') {
      throw new BadRequestException('This invite has already been used.');
    }
    if (new Date(invite.expiresAt) < new Date()) {
      throw new BadRequestException('This invite link has expired. Ask for a new one.');
    }

    return invite;
  }

  /**
   * Marks the invite used. The token is kept rather than rotated: `findByToken`
   * already refuses anything not PENDING, so replay is blocked either way — and
   * keeping it lets a reused link say "already used" instead of "not valid".
   */
  markAccepted(id: string): void {
    const invite = this.invites.get(id);
    if (invite) {
      this.invites.set(id, { ...invite, status: 'ACCEPTED' });
    }
  }
}
