import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { deleteCompanyDocument } from '../common/cloudinary-upload';
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

  /**
   * Permanently deletes a company and every row scoped to it across every
   * module — a hard delete, by explicit decision (no "restore" concept, no
   * `deletedAt` filtering to thread through every other service). Only the
   * Owner (the user who created it, per `ownerId`) may do this, and only if
   * they belong to at least one other company afterwards — nobody can delete
   * their way down to zero companies (§10.2's own-company version of this
   * rule, extended to the account level).
   */
  async remove(configService: ConfigService, userId: string, organizationId: string, confirmName: string): Promise<void> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) {
      throw new NotFoundException('That company no longer exists.');
    }

    if (organization.ownerId !== userId) {
      throw new ForbiddenException('Only the Owner who created this company can delete it.');
    }

    if (organization.name.trim() !== confirmName.trim()) {
      throw new BadRequestException('The company name you entered does not match.');
    }

    const totalMemberships = await this.prisma.membership.count({ where: { userId } });
    if (totalMemberships <= 1) {
      throw new BadRequestException('You must belong to at least one company — create or join another before deleting this one.');
    }

    // Clean up real Cloudinary assets first, best-effort — deleteCompanyDocument
    // already logs (rather than throws) on failure, so one bad asset can't
    // abort the rest of the teardown (§6, "no orphaned Cloudinary assets").
    const documents = await this.prisma.document.findMany({ where: { organizationId } });
    for (const doc of documents) {
      await deleteCompanyDocument(configService, doc.cloudinaryPublicId, doc.cloudinaryResourceType as 'image' | 'raw');
    }

    // No `$transaction` — this schema deliberately avoids it everywhere else
    // too (Mongo transactions need a replica set; a standalone mongod, a
    // common local/dev setup, would throw and abort the whole deletion).
    // Leaf data first, Organization last.
    await Promise.all([
      this.prisma.review.deleteMany({ where: { organizationId } }),
      this.prisma.goal.deleteMany({ where: { organizationId } }),
      this.prisma.appraisalCycle.deleteMany({ where: { organizationId } }),
      this.prisma.payslip.deleteMany({ where: { organizationId } }),
      this.prisma.salaryStructure.deleteMany({ where: { organizationId } }),
      this.prisma.leaveRequest.deleteMany({ where: { organizationId } }),
      this.prisma.attendanceRecord.deleteMany({ where: { organizationId } }),
      this.prisma.document.deleteMany({ where: { organizationId } }),
      this.prisma.invite.deleteMany({ where: { organizationId } }),
    ]);

    await this.prisma.employee.deleteMany({ where: { organizationId } });
    await this.prisma.membership.deleteMany({ where: { organizationId } });
    await this.prisma.organization.delete({ where: { id: organizationId } });
  }
}
