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
    email: 'owner@demo.com',
    name: 'Priya Nair',
    avatarInitials: 'PN',
  },
  {
    id: 'usr-2',
    email: 'hr@demo.com',
    name: 'Marta Lindqvist',
    avatarInitials: 'ML',
  },
  {
    id: 'usr-3',
    email: 'manager@demo.com',
    name: 'Samuel Okafor',
    avatarInitials: 'SO',
  },
] as const;

const SEED_MEMBERSHIPS = [
  {
    id: 'mem-1',
    userId: 'usr-1',
    organizationId: 'org-alderway',
    jobTitle: 'Founder & CEO',
    permissions: ['*'],
  },
  {
    id: 'mem-2',
    userId: 'usr-2',
    organizationId: 'org-alderway',
    jobTitle: 'HR Manager',
    permissions: ['employees.*', 'attendance.*', 'leave.*', 'documents.*', 'reports.view', 'team.invite'],
  },
  {
    id: 'mem-3',
    userId: 'usr-3',
    organizationId: 'org-alderway',
    jobTitle: 'Engineering Manager',
    permissions: ['attendance.view', 'leave.approve', 'performance.view', 'documents.view'],
  },
] as const;

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent seeding on a fixed id: restarting the server re-asserts the demo
   * accounts without duplicating them or clobbering real data.
   *
   * Uses findUnique + create/update rather than `upsert`: Prisma implements
   * `upsert` on MongoDB with a transaction, which requires the deployment to be
   * a replica set. A standalone mongod (a common local/dev setup) would throw
   * "Transactions are not supported by this deployment" and abort app startup.
   */
  async onModuleInit(): Promise<void> {
    // Seeding must never take the whole app down: if the database is briefly
    // unreachable at boot (e.g. a DNS/Atlas blip), log and carry on so the
    // server still binds its port. Prisma reconnects per-request afterwards, and
    // a later restart re-asserts the seed. Aborting here is what previously
    // turned a transient DB hiccup into a hard ERR_CONNECTION_REFUSED.
    try {
      const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);

      for (const seed of SEED_USERS) {
        const existing = await this.prisma.user.findUnique({ where: { id: seed.id } });
        if (!existing) {
          await this.prisma.user.create({ data: { ...seed, passwordHash } });
        }
      }

      for (const mem of SEED_MEMBERSHIPS) {
        const existing = await this.prisma.membership.findUnique({ where: { id: mem.id } });
        if (existing) {
          // Re-assert permissions so preset changes land on restart.
          await this.prisma.membership.update({
            where: { id: mem.id },
            data: { permissions: [...mem.permissions] },
          });
        } else {
          await this.prisma.membership.create({
            data: { ...mem, permissions: [...mem.permissions] },
          });
        }
      }

      this.logger.log(`Seeded ${SEED_USERS.length} demo accounts and memberships`);
    } catch (error) {
      this.logger.error(
        'Skipped demo seeding — database unreachable at boot. The API will still start; check MONGO_URI / network.',
        error instanceof Error ? error.message : String(error),
      );
    }
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
  async findAllByOrganization(organizationId: string): Promise<any[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });

    const userIds = memberships.map((m) => m.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
    });

    return memberships.map((m) => {
      const u = users.find((user) => user.id === m.userId)!;
      return {
        ...u,
        jobTitle: m.jobTitle,
        permissions: m.permissions,
        membershipId: m.id,
        organizationId: m.organizationId,
      };
    });
  }

  async create(params: {
    email: string;
    password: string | null;
    name: string;
    requiresPasswordReset?: boolean;
  }): Promise<User> {
    return (await this.prisma.user.create({
      data: {
        id: `usr-${randomUUID().slice(0, 8)}`,
        email: this.normaliseEmail(params.email),
        passwordHash: params.password ? await bcrypt.hash(params.password, BCRYPT_ROUNDS) : '',
        requiresPasswordReset: params.requiresPasswordReset ?? false,
        name: params.name.trim(),
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
  ): Promise<any> {
    return this.prisma.membership.create({
      data: {
        id: `mem-${randomUUID().slice(0, 8)}`,
        userId,
        organizationId,
        jobTitle: jobTitle?.trim() || '',
        permissions: ['*'], // The Owner always holds every permission
      },
    });
  }

  async getMemberships(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
    });

    if (memberships.length === 0) return [];

    const orgIds = memberships.map((m) => m.organizationId);
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, name: true },
    });

    return memberships.map((m) => {
      const org = orgs.find((o) => o.id === m.organizationId);
      return {
        ...m,
        organizationName: org?.name ?? 'Unknown Company',
      };
    });
  }

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { 
        passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        requiresPasswordReset: false,
      },
    });
  }

  /**
   * Removes a person's access to ONE company only. In a multi-org world,
   * deleting the `User` (the old behaviour) would kill their login for every
   * other company they belong to — this deletes just the `Membership` row.
   */
  async removeMembership(userId: string, organizationId: string): Promise<void> {
    await this.prisma.membership.delete({
      where: { userId_organizationId: { userId, organizationId } },
    });
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
