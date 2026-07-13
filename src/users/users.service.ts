import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { Role, User } from './user.entity';

const BCRYPT_ROUNDS = 10;

/** Matches the frontend's seeded demo accounts so both halves demo identically (§9). */
const DEMO_PASSWORD = 'demo1234';
const SEED_USERS = [
  {
    id: 'usr-1',
    organizationId: 'org-alderway',
    email: 'owner@demo.com',
    name: 'Priya Nair',
    jobTitle: 'Founder & CEO',
    role: 'OWNER',
    avatarInitials: 'PN',
  },
  {
    id: 'usr-2',
    organizationId: 'org-alderway',
    email: 'hr@demo.com',
    name: 'Marta Lindqvist',
    jobTitle: 'HR Manager',
    role: 'HR',
    avatarInitials: 'ML',
  },
  {
    id: 'usr-3',
    organizationId: 'org-alderway',
    email: 'manager@demo.com',
    name: 'Samuel Okafor',
    jobTitle: 'Engineering Manager',
    role: 'MANAGER',
    avatarInitials: 'SO',
  },
] as const;

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent: `upsert` on a fixed id means restarting the server re-asserts the
   * demo accounts without duplicating them, and without clobbering real data.
   */
  async onModuleInit(): Promise<void> {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);

    for (const seed of SEED_USERS) {
      await this.prisma.user.upsert({
        where: { id: seed.id },
        // Leave an existing demo account exactly as it is — someone may have
        // changed their job title while clicking around the demo.
        update: {},
        create: { ...seed, passwordHash },
      });
    }

    this.logger.log(`Seeded ${SEED_USERS.length} demo accounts`);
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } }) as Promise<User | null>;
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: this.normaliseEmail(email) },
    }) as Promise<User | null>;
  }

  /** Everyone belonging to one company. Never returns users from another org. */
  findAllByOrganization(organizationId: string): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    }) as Promise<User[]>;
  }

  async create(params: {
    email: string;
    password: string | null;
    name: string;
    role?: Role;
  }): Promise<User> {
    return (await this.prisma.user.create({
      data: {
        id: `usr-${randomUUID().slice(0, 8)}`,
        // The person who signs up owns the company they are about to create
        // (§11.2), but that company does not exist yet.
        organizationId: null,
        email: this.normaliseEmail(params.email),
        passwordHash: params.password ? await bcrypt.hash(params.password, BCRYPT_ROUNDS) : '',
        name: params.name.trim(),
        jobTitle: '',
        role: params.role ?? 'OWNER',
        avatarInitials: this.initialsOf(params.name),
      },
    })) as User;
  }

  /**
   * Creates someone who accepted an invite. Their role and organisation come from
   * the invite, never from anything they typed — otherwise an invitee could
   * promote themselves to Owner on the way in.
   */
  async createFromInvite(params: {
    email: string;
    password: string;
    name: string;
    jobTitle: string;
    role: Role;
    organizationId: string;
  }): Promise<User> {
    return (await this.prisma.user.create({
      data: {
        id: `usr-${randomUUID().slice(0, 8)}`,
        organizationId: params.organizationId,
        email: this.normaliseEmail(params.email),
        passwordHash: await bcrypt.hash(params.password, BCRYPT_ROUNDS),
        name: params.name.trim(),
        jobTitle: params.jobTitle.trim(),
        role: params.role,
        avatarInitials: this.initialsOf(params.name),
      },
    })) as User;
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    // A Google-only account has no local password — it can never be matched by one.
    if (!user.passwordHash) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  /** Called when Company Details creates the org and makes this user its Owner. */
  async attachOrganization(
    userId: string,
    organizationId: string,
    jobTitle?: string,
  ): Promise<User> {
    return (await this.prisma.user.update({
      where: { id: userId },
      data: {
        organizationId,
        role: 'OWNER',
        ...(jobTitle?.trim() ? { jobTitle: jobTitle.trim() } : {}),
      },
    })) as User;
  }

  async remove(userId: string): Promise<void> {
    await this.prisma.user.delete({ where: { id: userId } });
  }

  private normaliseEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private initialsOf(fullName: string): string {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    const first = parts[0][0];
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  }
}
