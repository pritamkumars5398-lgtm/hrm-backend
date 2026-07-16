import { ConflictException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { Organization } from './organization.entity';

/**
 * Organisation + membership is **access-control**, which §11.4 puts inside this
 * phase's backend scope. Membership is its own model (`Membership`) linking a
 * user to a company with a granular permission list, so one user can belong to
 * several companies with different rights in each (§10, §11.3).
 */
@Injectable()
export class OrganizationsService implements OnModuleInit {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * The company the three seeded demo accounts belong to (§9). Idempotent.
   * findUnique + create rather than `upsert`, which would need Mongo transactions
   * (a replica set) and crash startup on a standalone mongod — see UsersService.
   */
  async onModuleInit(): Promise<void> {
    // Non-fatal, same reasoning as UsersService.onModuleInit: a DB blip at boot
    // must not stop the API from listening.
    try {
      const existing = await this.prisma.organization.findUnique({ where: { id: 'org-alderway' } });
      if (!existing) {
        await this.prisma.organization.create({
          data: {
            id: 'org-alderway',
            name: 'Alderway Labs',
            address: '4 Wharf Road, London, E15 2QR, United Kingdom',
            industry: 'Software & Technology',
            ownerId: 'usr-1',
          },
        });
      }

      this.logger.log('Seeded demo organisation');
    } catch (error) {
      this.logger.error(
        'Skipped demo organisation seeding — database unreachable at boot.',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id } }) as Promise<Organization | null>;
  }

  /** Company profile edits from Settings. Owner-only — enforced at the controller. */
  async update(
    id: string,
    patch: { name?: string; address?: string; industry?: string; leaveNotificationEmail?: string },
  ): Promise<Organization> {
    return (await this.prisma.organization.update({
      where: { id },
      data: {
        ...(patch.name ? { name: patch.name.trim() } : {}),
        ...(patch.address ? { address: patch.address.trim() } : {}),
        ...(patch.industry ? { industry: patch.industry } : {}),
        // '' explicitly clears it — only skip the field when it's undefined
        // (not sent at all), unlike the trim-and-skip-empty fields above.
        ...(patch.leaveNotificationEmail !== undefined
          ? { leaveNotificationEmail: patch.leaveNotificationEmail.trim() || null }
          : {}),
      },
    })) as Organization;
  }

  /**
   * Creates the company and makes the caller its Owner. Refuses if they already
   * belong to one — otherwise a repeated submit would orphan the first company
   * and silently move the user into a second.
   */
  async create(params: {
    userId: string;
    name: string;
    address: string;
    industry: string;
    jobTitle?: string;
  }): Promise<{ organization: Organization }> {
    const user = await this.usersService.findById(params.userId);
    if (!user) {
      throw new ConflictException('User not found.');
    }

    const organization = (await this.prisma.organization.create({
      data: {
        id: `org-${randomUUID().slice(0, 8)}`,
        name: params.name.trim(),
        address: params.address.trim(),
        industry: params.industry,
        ownerId: params.userId,
      },
    })) as Organization;

    await this.usersService.attachOrganization(
      params.userId,
      organization.id,
      params.jobTitle,
    );

    return { organization };
  }
}
