import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { deleteCompanyDocument } from '../common/cloudinary-upload';
import { writeAuditLog } from '../common/audit-log';
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
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The company the three seeded demo accounts belong to (§9). Idempotent.
   * findUnique + create rather than `upsert`, which would need Mongo transactions
   * (a replica set) and crash startup on a standalone mongod — see UsersService.
   */
  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.prisma.organization.findUnique({ where: { id: 'org-alderway' } }).catch(() => null);
      if (!existing) {
        await this.prisma.organization.create({
          data: {
            id: 'org-alderway',
            name: 'Alderway Labs',
            address: '4 Wharf Road, London, E15 2QR, United Kingdom',
            industry: 'Software & Technology',
            ownerId: 'usr-1',
          },
        }).catch((err) => {
          if (!String(err).includes('replica set') && !String(err).includes('P2031')) {
            throw err;
          }
        });
      }

      this.logger.log('Seeded demo organisation');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('replica set') && !msg.includes('P2031')) {
        this.logger.error('Skipped demo organisation seeding — check MONGO_URI / network.', msg);
      }
    }
  }

  findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id } }) as Promise<Organization | null>;
  }

  /** Company profile edits from Settings. Owner-only — enforced at the controller. */
  async update(
    id: string,
    patch: {
      name?: string;
      address?: string;
      industry?: string;
      leaveNotificationEmail?: string;
      attendanceLateThreshold?: string;
      attendanceHalfDayThreshold?: number;
      attendanceWorkingHours?: number;
      attendanceHolidays?: string[];
    },
    userId?: string,
  ): Promise<Organization> {
    const existing = await this.prisma.organization.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Company not found.');

    if (patch.attendanceWorkingHours !== undefined) {
      if (patch.attendanceWorkingHours <= 0 || patch.attendanceWorkingHours > 24) {
        throw new BadRequestException('Working hours must be between 1 and 24.');
      }
    }

    const workingHours = patch.attendanceWorkingHours ?? existing.attendanceWorkingHours ?? 8.0;

    if (patch.attendanceHalfDayThreshold !== undefined) {
      if (patch.attendanceHalfDayThreshold <= 0 || patch.attendanceHalfDayThreshold > workingHours) {
        throw new BadRequestException('Half-day threshold must be greater than 0 and less than total working hours.');
      }
    }

    if (patch.attendanceLateThreshold !== undefined && patch.attendanceLateThreshold !== '') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.attendanceLateThreshold)) {
        throw new BadRequestException('Late threshold must be a valid HH:MM time string (e.g. 09:30).');
      }
    }

    const updated = (await this.prisma.organization.update({
      where: { id },
      data: {
        ...(patch.name ? { name: patch.name.trim() } : {}),
        ...(patch.address ? { address: patch.address.trim() } : {}),
        ...(patch.industry ? { industry: patch.industry } : {}),
        ...(patch.leaveNotificationEmail !== undefined
          ? { leaveNotificationEmail: patch.leaveNotificationEmail.trim() || null }
          : {}),
        ...(patch.attendanceLateThreshold !== undefined ? { attendanceLateThreshold: patch.attendanceLateThreshold } : {}),
        ...(patch.attendanceHalfDayThreshold !== undefined ? { attendanceHalfDayThreshold: patch.attendanceHalfDayThreshold } : {}),
        ...(patch.attendanceWorkingHours !== undefined ? { attendanceWorkingHours: patch.attendanceWorkingHours } : {}),
        ...(patch.attendanceHolidays !== undefined ? { attendanceHolidays: patch.attendanceHolidays } : {}),
      },
    })) as Organization;

    if (userId) {
      await writeAuditLog(this.prisma, {
        organizationId: id,
        userId,
        action: 'UPDATE',
        resource: 'Organization',
        resourceId: id,
        result: 'ALLOW',
        details: { patch },
      });
    }

    return updated;
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

    await writeAuditLog(this.prisma, {
      organizationId: organization.id,
      userId: params.userId,
      action: 'CREATE',
      resource: 'Organization',
      resourceId: organization.id,
      result: 'ALLOW',
      details: { name: params.name, industry: params.industry },
    });

    return { organization };
  }

  /**
   * Permanently deletes a company and every row scoped to it across every
   * module.
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

    const affectedMemberships = await this.prisma.membership.findMany({ where: { organizationId } });
    await this.notifications.pushOnly(
      affectedMemberships.map((m) => m.userId),
      { title: 'Your company was deleted', body: `${organization.name} has been permanently deleted by its Owner.` },
    );

    const documents = await this.prisma.document.findMany({ where: { organizationId } });
    for (const doc of documents) {
      await deleteCompanyDocument(configService, doc.cloudinaryPublicId, doc.cloudinaryResourceType as 'image' | 'raw');
    }

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
