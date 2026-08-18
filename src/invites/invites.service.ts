import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ComplianceService } from '../compliance/compliance.service';
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../common/email.service';
import type { Invite } from './invite.entity';
import { writeAuditLog } from '../common/audit-log';

type FinancialDetailsInput = {
  accName: string;
  accNumber: string;
  bankName: string;
  ifscCode: string;
};

type EducationDetailInput = {
  degree: string;
  institution: string;
  year: string;
};

type FamilyDetailInput = {
  name: string;
  relationship: string;
  contactNumber?: string;
};

const EXPIRY_DAYS = 7;

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly notifications: NotificationsService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private async triggerComplianceScan(employeeId: string, organizationId: string) {
    try {
      const complianceService = this.moduleRef.get(ComplianceService, { strict: false });
      await complianceService.evalApplicability(employeeId, organizationId);
    } catch (err) {
      console.error('Failed to trigger compliance scan in invites:', err);
    }
  }

  private linkFor(token: string): string {
    const origin = (this.configService.get<string>('CORS_ORIGINS') ?? 'http://localhost:5173')
      .split(',')[0]
      .trim();
    return `${origin}/login`;
  }

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
    permissions: string[];
    invitedBy: string;
    source?: 'employee-management' | 'team-members';
    // HR Data
    firstName?: string;
    lastName?: string;
    jobTitle?: string;
    department?: string;
    startDate?: string;
    employmentType?: string;
    workLocation?: string;
    employeeId?: string;
    dob?: string;
    gender?: string;
    contactNumber?: string;
    homeAddress?: string;
    photoUrl?: string;
    financialDetails?: FinancialDetailsInput;
    educationDetails?: EducationDetailInput[];
    familyDetails?: FamilyDetailInput[];
  }): Promise<{ invite: Invite; tempPassword: string | null }> {
    const email = params.email.trim().toLowerCase();

    const outstanding = await this.prisma.invite.findFirst({
      where: { organizationId: params.organizationId, email, status: 'PENDING' },
    });
    if (outstanding) {
      throw new ConflictException('There is already a pending invite for that email in this company.');
    }

    let user = await this.usersService.findByEmail(email);
    let tempPassword: string | null = null;

    // A person can legitimately belong to many companies (multi-org, §0) — an
    // existing account elsewhere is never a reason to refuse. But re-inviting
    // someone who is ALREADY a member of THIS company is a real conflict, not a
    // no-op: left unchecked, this created a redundant pending Invite and
    // returned success without anything meaningful happening membership-wise.
    if (user) {
      const alreadyMember = await this.prisma.membership.findFirst({
        where: { userId: user.id, organizationId: params.organizationId },
      });
      if (alreadyMember) {
        throw new ConflictException('That person is already a member of this company.');
      }
    }

    if (!user) {
      // 1. Generate temp password
      tempPassword = randomBytes(4).toString('hex'); // 8 char hex
      // 2. Create User
      const nameFallback = params.firstName ? `${params.firstName} ${params.lastName || ''}`.trim() : email.split('@')[0];
      user = await this.usersService.create({
        email,
        password: tempPassword,
        name: nameFallback,
        requiresPasswordReset: true,
      });
    }

    // 3. Create Membership — the pre-check above guarantees none exists yet.
    const createdMembership = await this.prisma.membership.create({
      data: {
        id: `mem-${randomUUID().slice(0, 8)}`,
        userId: user.id,
        organizationId: params.organizationId,
        jobTitle: params.jobTitle || 'Employee',
        permissions: params.permissions,
      },
    });

    await writeAuditLog(this.prisma, {
      organizationId: params.organizationId,
      userId: params.invitedBy,
      action: 'CREATE',
      resource: 'Membership',
      resourceId: createdMembership.id,
      result: 'ALLOW',
      details: { invitedUserId: user.id, permissions: params.permissions },
    });

    let targetEmployeeId = '';
    if (params.source === 'employee-management') {
      const existingEmployee = await this.prisma.employee.findFirst({
        where: { userId: user.id, organizationId: params.organizationId }
      });

      if (existingEmployee?.deletedAt) {
        targetEmployeeId = existingEmployee.id;
        // A soft-deleted record still holds the unique (userId, org) slot, so a
        // re-add restores and refreshes it rather than failing the create.
        await this.prisma.employee.update({
          where: { id: existingEmployee.id },
          data: {
            deletedAt: null,
            employeeId: params.employeeId || existingEmployee.employeeId || '',
            firstName: params.firstName || existingEmployee.firstName,
            lastName: params.lastName || existingEmployee.lastName,
            contactNumber: params.contactNumber ?? existingEmployee.contactNumber,
            homeAddress: params.homeAddress ?? existingEmployee.homeAddress,
            jobTitle: params.jobTitle || existingEmployee.jobTitle,
            department: params.department || existingEmployee.department,
            startDate: params.startDate ? new Date(params.startDate) : existingEmployee.startDate,
            employmentType: params.employmentType || existingEmployee.employmentType,
            workLocation: params.workLocation || existingEmployee.workLocation,
            photoUrl: params.photoUrl ?? existingEmployee.photoUrl,
            dob: params.dob ?? existingEmployee.dob,
            gender: params.gender ?? existingEmployee.gender,
          },
        });
        await this.triggerComplianceScan(existingEmployee.id, params.organizationId);
      } else if (!existingEmployee) {
        const newEmp = await this.prisma.employee.create({
          data: {
            id: `emp-${randomUUID().slice(0, 8)}`,
            userId: user.id,
            organizationId: params.organizationId,
            employeeId: params.employeeId || '',
            firstName: params.firstName || user.name.split(' ')[0] || '',
            lastName: params.lastName || user.name.split(' ').slice(1).join(' ') || '',
            contactNumber: params.contactNumber || '',
            homeAddress: params.homeAddress || '',
            jobTitle: params.jobTitle || '',
            department: params.department || '',
            startDate: params.startDate ? new Date(params.startDate) : new Date(),
            employmentType: params.employmentType || '',
            workLocation: params.workLocation || '',
            photoUrl: params.photoUrl || null,
            dob: params.dob || null,
            gender: params.gender || null,
            ...(params.financialDetails ? { financialDetails: params.financialDetails } : {}),
            ...(params.educationDetails?.length ? { educationDetails: params.educationDetails } : {}),
            ...(params.familyDetails?.length ? { familyDetails: params.familyDetails } : {}),
          },
        });
        targetEmployeeId = newEmp.id;
        await this.triggerComplianceScan(newEmp.id, params.organizationId);
      }

      // Write Audit Log
      await writeAuditLog(this.prisma, {
        organizationId: params.organizationId,
        userId: params.invitedBy,
        action: 'CREATE',
        resource: 'Employee',
        resourceId: targetEmployeeId,
        result: 'ALLOW',
        details: { email: params.email, employeeId: params.employeeId },
      });
    }

    // 5. Create Invite record
    const now = new Date();
    const invite = (await this.prisma.invite.create({
      data: {
        id: `inv-${randomUUID().slice(0, 8)}`,
        organizationId: params.organizationId,
        email,
        permissions: params.permissions,
        status: 'PENDING',
        token: this.newToken(),
        invitedBy: params.invitedBy,
        expiresAt: this.expiryFrom(now),
      },
    })) as Invite;

    await writeAuditLog(this.prisma, {
      organizationId: params.organizationId,
      userId: params.invitedBy,
      action: 'CREATE',
      resource: 'Invite',
      resourceId: invite.id,
      result: 'ALLOW',
      details: { email: invite.email },
    });

    // A brand-new account has no push tokens yet — this still lands as a real
    // in-app notification waiting for them the moment they log in.
    await this.notifications.create({
      userId: user.id,
      organizationId: params.organizationId,
      title: params.source === 'employee-management' ? 'You were added as an employee' : 'You were added to the team',
      body: params.jobTitle ? `Welcome aboard as ${params.jobTitle}.` : 'Welcome aboard.',
      kind: 'employee',
    });

    // 6. Send invite email
    const nameFallback = params.firstName ? `${params.firstName} ${params.lastName || ''}`.trim() : user.name;
    void this.emailService.sendInvite(email, nameFallback, this.linkFor(invite.token), tempPassword);

    return { invite, tempPassword };
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

  async revoke(id: string, organizationId: string, callerUserId: string): Promise<Invite> {
    const invite = await this.findOwned(id, organizationId);

    if (invite.status === 'ACCEPTED') {
      throw new BadRequestException('That invite has already been accepted.');
    }

    const updated = (await this.prisma.invite.update({
      where: { id },
      data: { status: 'REVOKED' },
    })) as Invite;

    await writeAuditLog(this.prisma, {
      organizationId,
      userId: callerUserId,
      action: 'UPDATE',
      resource: 'Invite',
      resourceId: id,
      result: 'ALLOW',
      details: { inviteId: id, status: 'REVOKED', email: invite.email },
    });

    return updated;
  }

  /** Issues a fresh token and expiry — the old link stops working. */
  async resend(id: string, organizationId: string, callerUserId: string): Promise<Invite> {
    const invite = await this.findOwned(id, organizationId);

    if (invite.status === 'ACCEPTED') {
      throw new BadRequestException('That invite has already been accepted.');
    }

    const now = new Date();

    const updated = (await this.prisma.invite.update({
      where: { id },
      data: {
        status: 'PENDING',
        token: this.newToken(),
        createdAt: now,
        expiresAt: this.expiryFrom(now),
      },
    })) as Invite;

    await writeAuditLog(this.prisma, {
      organizationId,
      userId: callerUserId,
      action: 'UPDATE',
      resource: 'Invite',
      resourceId: id,
      result: 'ALLOW',
      details: { inviteId: id, status: 'PENDING_RESEND', email: invite.email },
    });

    // Send invite email (tempPassword is null for resends)
    void this.emailService.sendInvite(updated.email, updated.email.split('@')[0], this.linkFor(updated.token), null);

    return updated;
  }
}
