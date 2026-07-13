import { Injectable, type OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import type { Role, User } from './user.entity';

const BCRYPT_ROUNDS = 10;

/** Matches the frontend's seeded demo accounts so both halves demo identically (§9). */
const DEMO_PASSWORD = 'demo1234';
const SEED_USERS: Array<Omit<User, 'passwordHash' | 'createdAt'>> = [
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
];

/**
 * In-memory store. Phase 1 has no database by design (§2) — MongoDB Atlas +
 * Prisma arrive in Phase 2, at which point only this class changes.
 */
@Injectable()
export class UsersService implements OnModuleInit {
  private readonly users = new Map<string, User>();

  async onModuleInit(): Promise<void> {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);

    for (const seed of SEED_USERS) {
      this.users.set(seed.id, {
        ...seed,
        passwordHash,
        createdAt: new Date().toISOString(),
      });
    }
  }

  findById(id: string): User | undefined {
    return this.users.get(id);
  }

  findByEmail(email: string): User | undefined {
    const normalised = this.normaliseEmail(email);
    return [...this.users.values()].find((u) => u.email === normalised);
  }

  async create(params: {
    email: string;
    password: string | null;
    name: string;
    role?: Role;
  }): Promise<User> {
    const user: User = {
      id: `usr-${randomUUID().slice(0, 8)}`,
      // The person who signs up owns the company they are about to create (§11.2),
      // but that company does not exist yet.
      organizationId: null,
      email: this.normaliseEmail(params.email),
      passwordHash: params.password ? await bcrypt.hash(params.password, BCRYPT_ROUNDS) : '',
      name: params.name.trim(),
      jobTitle: '',
      role: params.role ?? 'OWNER',
      avatarInitials: this.initialsOf(params.name),
      createdAt: new Date().toISOString(),
    };

    this.users.set(user.id, user);
    return user;
  }

  /** Everyone belonging to one company. Never returns users from another org. */
  findAllByOrganization(organizationId: string): User[] {
    return [...this.users.values()]
      .filter((u) => u.organizationId === organizationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
    const user: User = {
      id: `usr-${randomUUID().slice(0, 8)}`,
      organizationId: params.organizationId,
      email: this.normaliseEmail(params.email),
      passwordHash: await bcrypt.hash(params.password, BCRYPT_ROUNDS),
      name: params.name.trim(),
      jobTitle: params.jobTitle.trim(),
      role: params.role,
      avatarInitials: this.initialsOf(params.name),
      createdAt: new Date().toISOString(),
    };

    this.users.set(user.id, user);
    return user;
  }

  remove(userId: string): boolean {
    return this.users.delete(userId);
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    // A Google-only account has no local password — it can never be matched by one.
    if (!user.passwordHash) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  /** Called when Company Details creates the org and makes this user its Owner. */
  attachOrganization(userId: string, organizationId: string, jobTitle?: string): User | undefined {
    const user = this.users.get(userId);
    if (!user) return undefined;

    const updated: User = {
      ...user,
      organizationId,
      role: 'OWNER',
      jobTitle: jobTitle?.trim() || user.jobTitle,
    };

    this.users.set(user.id, updated);
    return updated;
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
