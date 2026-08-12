import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { InvitesService } from '../invites/invites.service';
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
  ) {}

  async createJob(organizationId: string, permissions: string[], dto: CreateJobDto) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage job requisitions.');
    }

    return this.prisma.jobRequisition.create({
      data: {
        id: `job-${randomUUID().slice(0, 8)}`,
        organizationId,
        title: dto.title.trim(),
        department: dto.department.trim(),
        location: dto.location.trim(),
        headcount: dto.headcount,
        status: 'OPEN',
        description: dto.description?.trim() || null,
      },
    });
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

  async createCandidate(organizationId: string, permissions: string[], dto: CreateCandidateDto) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage candidates.');
    }

    const job = await this.prisma.jobRequisition.findUnique({
      where: { id: dto.requisitionId },
    });
    if (!job || job.organizationId !== organizationId) {
      throw new NotFoundException('The specified job requisition does not exist.');
    }

    return this.prisma.candidate.create({
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
      } catch (err) {
        // Propagate conflict or validation exception directly
        if (err instanceof ConflictException || err instanceof BadRequestException) {
          throw err;
        }
        throw new BadRequestException(err instanceof Error ? err.message : String(err));
      }
    }

    return this.prisma.candidate.update({
      where: { id },
      data: { stage },
    });
  }
}
