import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { Invite, InvitableRole } from './invite.entity';

const EXPIRY_DAYS = 7;

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  private newToken(): string {
    // 32 bytes of entropy — this token is the credential that grants access to
    // an organisation, so it must not be guessable.
    return randomBytes(32).toString('base64url');
  }

  private expiryFrom(date: Date): Date {
    return new Date(date.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  }

  async create(params: {
    organizationId: string;
    email: string;
    role: InvitableRole;
    invitedBy: string;
  }): Promise<Invite> {
    const email = params.email.trim().toLowerCase();

    if (await this.usersService.findByEmail(email)) {
      throw new ConflictException('That person already has an account.');
    }

    const outstanding = await this.prisma.invite.findFirst({
      where: { organizationId: params.organizationId, email, status: 'PENDING' },
    });
    if (outstanding) {
      throw new ConflictException('There is already a pending invite for that email.');
    }

    const now = new Date();

    return (await this.prisma.invite.create({
      data: {
        id: `inv-${randomUUID().slice(0, 8)}`,
        organizationId: params.organizationId,
        email,
        role: params.role,
        status: 'PENDING',
        token: this.newToken(),
        invitedBy: params.invitedBy,
        expiresAt: this.expiryFrom(now),
      },
    })) as Invite;
  }

  listByOrganization(organizationId: string): Promise<Invite[]> {
    return this.prisma.invite.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    }) as Promise<Invite[]>;
  }

  /** Scoped by org: one company must never be able to touch another's invite. */
  private async findOwned(id: string, organizationId: string): Promise<Invite> {
    const invite = (await this.prisma.invite.findUnique({ where: { id } })) as Invite | null;

    if (!invite || invite.organizationId !== organizationId) {
      throw new NotFoundException('Invite not found.');
    }
    return invite;
  }

  async revoke(id: string, organizationId: string): Promise<Invite> {
    const invite = await this.findOwned(id, organizationId);

    if (invite.status === 'ACCEPTED') {
      throw new BadRequestException('That invite has already been accepted.');
    }

    return (await this.prisma.invite.update({
      where: { id },
      data: { status: 'REVOKED' },
    })) as Invite;
  }

  /** Issues a fresh token and expiry — the old link stops working. */
  async resend(id: string, organizationId: string): Promise<Invite> {
    const invite = await this.findOwned(id, organizationId);

    if (invite.status === 'ACCEPTED') {
      throw new BadRequestException('That invite has already been accepted.');
    }

    const now = new Date();

    return (await this.prisma.invite.update({
      where: { id },
      data: {
        status: 'PENDING',
        token: this.newToken(),
        createdAt: now,
        expiresAt: this.expiryFrom(now),
      },
    })) as Invite;
  }

  /** Used by the accept-invite screen to show who is inviting you, and to what. */
  async findByToken(token: string): Promise<Invite> {
    const invite = (await this.prisma.invite.findUnique({ where: { token } })) as Invite | null;

    if (!invite) {
      throw new NotFoundException('This invite link is not valid.');
    }
    if (invite.status === 'REVOKED') {
      throw new BadRequestException('This invite has been revoked.');
    }
    if (invite.status === 'ACCEPTED') {
      throw new BadRequestException('This invite has already been used.');
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('This invite link has expired. Ask for a new one.');
    }

    return invite;
  }

  /**
   * Marks the invite used. The token is kept rather than rotated: `findByToken`
   * already refuses anything not PENDING, so replay is blocked either way — and
   * keeping it lets a reused link say "already used" instead of "not valid".
   */
  async markAccepted(id: string): Promise<void> {
    await this.prisma.invite.update({ where: { id }, data: { status: 'ACCEPTED' } });
  }
}
