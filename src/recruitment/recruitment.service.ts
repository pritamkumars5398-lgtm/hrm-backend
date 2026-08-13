import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { InvitesService } from '../invites/invites.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { writeAuditLog } from '../common/audit-log';
import type { CreateJobDto, CreateCandidateDto } from './dto/recruitment.dto';

function canManage(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('recruitment.manage') || permissions.includes('recruitment.*');
}

function canView(permissions: string[]): boolean {
  return (
    permissions.includes('*') ||
    permissions.includes('recruitment.view') ||
    permissions.includes('recruitment.manage') ||
    permissions.includes('recruitment.*') ||
    permissions.includes('employees.view')
  );
}

@Injectable()
export class RecruitmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitesService: InvitesService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  async createJob(organizationId: string, userId: string, permissions: string[], dto: CreateJobDto) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage job requisitions.');
    }

    const status = dto.status || 'OPEN';

    const job = await this.prisma.jobRequisition.create({
      data: {
        id: `job-${randomUUID().slice(0, 8)}`,
        organizationId,
        title: dto.title.trim(),
        department: dto.department.trim(),
        location: dto.location.trim(),
        headcount: dto.headcount,
        status,
        description: dto.description?.trim() || null,
      },
    });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'CREATE',
      resource: 'JobRequisition',
      resourceId: job.id,
      result: 'ALLOW',
      details: { title: dto.title, department: dto.department },
    });

    return job;
  }

  async submitRequisition(id: string, organizationId: string, userId: string, permissions: string[]) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage job requisitions.');
    }

    const job = await this.prisma.jobRequisition.findUnique({ where: { id } });
    if (!job || job.organizationId !== organizationId) {
      throw new NotFoundException('Job requisition not found.');
    }

    if (job.status !== 'DRAFT') {
      throw new BadRequestException('Only draft job requisitions can be submitted for approval.');
    }

    const updated = await this.prisma.jobRequisition.update({
      where: { id },
      data: { status: 'PENDING' },
    });

    await this.approvalsService.createApproval(
      organizationId,
      userId,
      'Recruitment',
      id,
      `Job Requisition: ${job.title}`,
      `Department: ${job.department}\nLocation: ${job.location}\nHeadcount: ${job.headcount}`,
    );

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'UPDATE',
      resource: 'JobRequisition',
      resourceId: id,
      result: 'ALLOW',
      details: { status: 'PENDING' },
    });

    return updated;
  }

  async listJobs(organizationId: string, permissions: string[]) {
    if (!canView(permissions)) {
      throw new ForbiddenException('You do not have permission to view job requisitions.');
    }

    return this.prisma.jobRequisition.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createCandidate(organizationId: string, userId: string, permissions: string[], dto: CreateCandidateDto) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage candidates.');
    }

    const job = await this.prisma.jobRequisition.findUnique({
      where: { id: dto.requisitionId },
    });
    if (!job || job.organizationId !== organizationId) {
      throw new NotFoundException('The specified job requisition does not exist.');
    }

    const candidate = await this.prisma.candidate.create({
      data: {
        id: `cand-${randomUUID().slice(0, 8)}`,
        organizationId,
        requisitionId: dto.requisitionId,
        name: dto.name.trim(),
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone?.trim() || null,
        stage: 'APPLIED',
        resumeUrl: dto.resumeUrl?.trim() || null,
      },
    });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'CREATE',
      resource: 'Candidate',
      resourceId: candidate.id,
      result: 'ALLOW',
      details: { name: dto.name, email: dto.email },
    });

    return candidate;
  }

  async listCandidates(organizationId: string, permissions: string[]) {
    if (!canView(permissions)) {
      throw new ForbiddenException('You do not have permission to view candidates.');
    }

    return this.prisma.candidate.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateCandidateStage(
    id: string,
    organizationId: string,
    userId: string,
    permissions: string[],
    stage: 'APPLIED' | 'SCREENED' | 'INTERVIEW' | 'OFFERED' | 'HIRED' | 'REJECTED',
  ) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage candidates.');
    }

    const candidate = await this.prisma.candidate.findUnique({ where: { id } });
    if (!candidate || candidate.organizationId !== organizationId) {
      throw new NotFoundException('Candidate not found.');
    }

    if (stage === 'HIRED') {
      if (candidate.stage === 'HIRED') {
        throw new ConflictException('This candidate has already been hired.');
      }

      const job = await this.prisma.jobRequisition.findUnique({
        where: { id: candidate.requisitionId },
      });

      const parts = candidate.name.trim().split(/\s+/);
      const firstName = parts[0] || '';
      const lastName = parts.slice(1).join(' ') || '';

      // Create invite & employee (checks for existing user/membership conflict automatically)
      try {
        await this.invitesService.create({
          organizationId,
          email: candidate.email,
          permissions: ['attendance.view', 'leave.view', 'performance.view', 'documents.view'],
          invitedBy: userId,
          source: 'employee-management',
          firstName,
          lastName,
          jobTitle: job?.title || 'Employee',
          department: job?.department || 'Staff',
          contactNumber: candidate.phone || undefined,
        });

        // Query the newly created Employee record to establish the link
        const createdUser = await this.prisma.user.findFirst({
          where: { email: candidate.email.trim().toLowerCase() },
        });
        if (createdUser) {
          const employee = await this.prisma.employee.findFirst({
            where: { userId: createdUser.id, organizationId },
          });

          if (employee) {
            // Check if Onboarding record already exists to ensure idempotency
            const existingOnboarding = await this.prisma.onboarding.findUnique({
              where: { employeeId: employee.id },
            });

            if (!existingOnboarding) {
              const onboardingId = `ob-${randomUUID().slice(0, 8)}`;
              await this.prisma.onboarding.create({
                data: {
                  id: onboardingId,
                  organizationId,
                  employeeId: employee.id,
                  status: 'IN_PROGRESS',
                  buddy: 'Rahul Mehta',
                },
              });

              // Pre-populate default onboarding tasks
              const defaultTasks = [
                { title: 'Verify Aadhaar & PAN card', category: 'HR', description: 'Upload and verify government identity cards.' },
                { title: 'Sign Employment Contract', category: 'EMPLOYEE', description: 'Read and sign the physical/digital employment contract.' },
                { title: 'Provision Laptop & IT Access', category: 'IT', description: 'Assign work laptop and set up Google Workspace/Active Directory accounts.' },
                { title: 'Schedule Team Introduction', category: 'MANAGER', description: 'Orient new hire to the department teammates.' },
              ];

              await Promise.all(
                defaultTasks.map((t) =>
                  this.prisma.onboardingTask.create({
                    data: {
                      id: `ob-tsk-${randomUUID().slice(0, 8)}`,
                      organizationId,
                      onboardingId,
                      title: t.title,
                      description: t.description,
                      category: t.category,
                      status: 'PENDING',
                    },
                  }),
                ),
              );

              // Write Audit Log for Onboarding initialization
              await writeAuditLog(this.prisma, {
                organizationId,
                userId,
                action: 'CREATE',
                resource: 'Onboarding',
                resourceId: onboardingId,
                result: 'ALLOW',
                details: { status: 'IN_PROGRESS' },
              });
            }
          }
        }
      } catch (err) {
        // Propagate conflict or validation exception directly
        if (err instanceof ConflictException || err instanceof BadRequestException) {
          throw err;
        }
        throw new BadRequestException(err instanceof Error ? err.message : String(err));
      }
    }

    const updatedCandidate = await this.prisma.candidate.update({
      where: { id },
      data: { stage },
    });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'UPDATE',
      resource: 'Candidate',
      resourceId: id,
      result: 'ALLOW',
      details: { stage },
    });

    return updatedCandidate;
  }
}
