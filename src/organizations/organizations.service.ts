import { ConflictException, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UsersService } from '../users/users.service';
import type { Organization } from './organization.entity';

/**
 * In-memory, like UsersService — no database in Phase 1 (§2).
 *
 * Organisation + membership is **access-control**, which §11.4 puts inside this
 * phase's backend scope. Membership is deliberately modelled as a field on the
 * user (`organizationId` + `role`), because §11.3 fixes one user to exactly one
 * company for now. Multi-company membership is a Phase 2+ idea, and modelling it
 * early would cost more than it saves.
 */
@Injectable()
export class OrganizationsService implements OnModuleInit {
  private readonly organizations = new Map<string, Organization>();

  constructor(private readonly usersService: UsersService) {}

  onModuleInit(): void {
    // The company the three seeded demo accounts belong to (§9).
    this.organizations.set('org-alderway', {
      id: 'org-alderway',
      name: 'Alderway Labs',
      address: '4 Wharf Road, London, E15 2QR, United Kingdom',
      industry: 'Software & Technology',
      ownerId: 'usr-1',
      createdAt: '2024-02-11T09:00:00.000Z',
    });
  }

  findById(id: string): Organization | undefined {
    return this.organizations.get(id);
  }

  /**
   * Creates the company and makes the caller its Owner. Refuses if they already
   * belong to one — otherwise a repeated submit would orphan the first company
   * and silently move the user into a second.
   */
  create(params: {
    userId: string;
    name: string;
    address: string;
    industry: string;
    jobTitle?: string;
  }): { organization: Organization } {
    const user = this.usersService.findById(params.userId);

    if (user?.organizationId) {
      throw new ConflictException('You already belong to a company.');
    }

    const organization: Organization = {
      id: `org-${randomUUID().slice(0, 8)}`,
      name: params.name.trim(),
      address: params.address.trim(),
      industry: params.industry,
      ownerId: params.userId,
      createdAt: new Date().toISOString(),
    };

    this.organizations.set(organization.id, organization);
    this.usersService.attachOrganization(params.userId, organization.id, params.jobTitle);

    return { organization };
  }
}
