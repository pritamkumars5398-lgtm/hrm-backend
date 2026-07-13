import { ConflictException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { Organization } from './organization.entity';

/**
 * Organisation + membership is **access-control**, which §11.4 puts inside this
 * phase's backend scope. Membership is deliberately modelled as a field on the
 * user (`organizationId` + `role`), because §11.3 fixes one user to exactly one
 * company for now. Multi-company membership is a Phase 2+ idea, and modelling it
 * early would cost more than it saves.
 */
@Injectable()
export class OrganizationsService implements OnModuleInit {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  /** The company the three seeded demo accounts belong to (§9). Idempotent. */
  async onModuleInit(): Promise<void> {
    await this.prisma.organization.upsert({
      where: { id: 'org-alderway' },
      update: {},
      create: {
        id: 'org-alderway',
        name: 'Alderway Labs',
        address: '4 Wharf Road, London, E15 2QR, United Kingdom',
        industry: 'Software & Technology',
        ownerId: 'usr-1',
      },
    });

    this.logger.log('Seeded demo organisation');
  }

  findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id } }) as Promise<Organization | null>;
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

    if (user?.organizationId) {
      throw new ConflictException('You already belong to a company.');
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
