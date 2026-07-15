import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { Invite } from './invite.entity';

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
    contactNumber?: string;
    homeAddress?: string;
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

    // 3. Create Membership
    const existingMembership = await this.prisma.membership.findFirst({
      where: { userId: user.id, organizationId: params.organizationId }
    });
    
    if (!existingMembership) {
      await this.prisma.membership.create({
        data: {
          id: `mem-${randomUUID().slice(0, 8)}`,
          userId: user.id,
          organizationId: params.organizationId,
          jobTitle: params.jobTitle || 'Employee',
          permissions: params.permissions,
        },
      });
    }

    // 4. Create Employee record ONLY for the Employee Management entry point.
    //    A Team Members invite is access-control only — User + Membership, no HR
    //    record (§9). Legacy calls without a source default to team-members.
    if (params.source === 'employee-management') {
      const existingEmployee = await this.prisma.employee.findFirst({
        where: { userId: user.id, organizationId: params.organizationId }
      });

      if (!existingEmployee) {
        await this.prisma.employee.create({
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
            ...(params.financialDetails ? { financialDetails: params.financialDetails } : {}),
            ...(params.educationDetails?.length ? { educationDetails: params.educationDetails } : {}),
            ...(params.familyDetails?.length ? { familyDetails: params.familyDetails } : {}),
          },
        });
      }
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
}
