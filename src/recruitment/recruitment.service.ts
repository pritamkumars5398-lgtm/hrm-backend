import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { randomUUID } from 'node:crypto';

export type CreateJobDto = {
  title: string;
  department: string;
  location?: string;
  type?: string;
  experienceLevel?: string;
  salaryRange?: string;
  description?: string;
  requirements?: string[];
  benefits?: string[];
  headcount?: number;
  status?: 'OPEN' | 'CLOSED' | 'DRAFT';
};

export type SubmitApplicationDto = {
  jobPostingId: string;
  candidateName: string;
  email: string;
  phone?: string;
  resumeUrl?: string;
  coverLetter?: string;
  experienceYears?: number;
  expectedSalary?: string;
};

@Injectable()
export class RecruitmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // =========================================================================
  // Public APIs (No Auth Required)
  // =========================================================================

  async getPublicJobs(search?: string, department?: string) {
    const where: any = { status: 'OPEN' };
    if (department && department !== 'All') {
      where.department = department;
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { department: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }

    const jobs = await this.prisma.jobPosting.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return jobs.map((j) => ({
      ...j,
      createdAt: j.createdAt.toISOString().slice(0, 10),
    }));
  }

  async getPublicJobById(id: string) {
    const job = await this.prisma.jobPosting.findUnique({ where: { id } });
    if (!job || job.status !== 'OPEN') {
      throw new NotFoundException('Job posting not found or no longer active.');
    }
    return {
      ...job,
      createdAt: job.createdAt.toISOString().slice(0, 10),
    };
  }

  async submitPublicApplication(payload: SubmitApplicationDto) {
    const job = await this.prisma.jobPosting.findUnique({ where: { id: payload.jobPostingId } });
    if (!job) {
      throw new NotFoundException('Selected job requisition was not found.');
    }

    // Heuristic AI Score calculation based on experience and complete application profile
    let aiScore = 78;
    if (payload.experienceYears && payload.experienceYears >= 5) aiScore += 12;
    else if (payload.experienceYears && payload.experienceYears >= 2) aiScore += 6;
    if (payload.resumeUrl) aiScore += 4;
    if (payload.coverLetter && payload.coverLetter.length > 50) aiScore += 4;
    aiScore = Math.min(99, aiScore);

    const application = await this.prisma.jobApplication.create({
      data: {
        id: `cand-${randomUUID().slice(0, 8)}`,
        jobPostingId: job.id,
        organizationId: job.organizationId,
        candidateName: payload.candidateName.trim(),
        email: payload.email.trim().toLowerCase(),
        phone: payload.phone?.trim() ?? '',
        resumeUrl: payload.resumeUrl ?? null,
        coverLetter: payload.coverLetter?.trim() ?? null,
        experienceYears: payload.experienceYears ?? 0,
        expectedSalary: payload.expectedSalary ?? null,
        status: 'APPLIED',
        aiScore,
      },
    });

    // Notify organization members
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId: job.organizationId },
    });
    const targetUserIds = memberships.map((m) => m.userId);

    if (targetUserIds.length > 0) {
      await this.notifications.createForMany(targetUserIds, {
        organizationId: job.organizationId,
        title: 'New Candidate Applied',
        body: `${payload.candidateName} applied for ${job.title} (${aiScore}% AI Match).`,
        kind: 'recruitment',
        link: '/dashboard/recruitment',
      });
    }

    return {
      ...application,
      jobTitle: job.title,
      department: job.department,
      appliedAt: application.appliedAt.toISOString().slice(0, 10),
    };
  }

  // =========================================================================
  // Admin ATS Dashboard APIs (Workspace Auth Scoped)
  // =========================================================================

  async getJobs(organizationId: string) {

    const jobs = await this.prisma.jobPosting.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const applications = await this.prisma.jobApplication.findMany({
      where: { organizationId },
      select: { jobPostingId: true },
    });

    const counts: Record<string, number> = {};
    for (const a of applications) {
      counts[a.jobPostingId] = (counts[a.jobPostingId] || 0) + 1;
    }

    return jobs.map((j) => ({
      ...j,
      createdAt: j.createdAt.toISOString().slice(0, 10),
      applicantCount: counts[j.id] || 0,
      applicantsCount: counts[j.id] || 0, // compatibility with frontend types
    }));
  }

  async createJob(organizationId: string, payload: CreateJobDto) {
    if (!payload.title?.trim() || !payload.department?.trim()) {
      throw new BadRequestException('Job title and department are required.');
    }

    const job = await this.prisma.jobPosting.create({
      data: {
        id: `job-${randomUUID().slice(0, 8)}`,
        organizationId,
        title: payload.title.trim(),
        department: payload.department.trim(),
        location: payload.location || 'Remote / Hybrid',
        type: payload.type || 'Full-time',
        experienceLevel: payload.experienceLevel || 'Mid-Level',
        salaryRange: payload.salaryRange || null,
        description: payload.description || '',
        requirements: payload.requirements || [],
        benefits: payload.benefits || [],
        headcount: payload.headcount || 1,
        status: payload.status || 'OPEN',
      },
    });

    return {
      ...job,
      applicantCount: 0,
      applicantsCount: 0,
      createdAt: job.createdAt.toISOString().slice(0, 10),
    };
  }

  async updateJob(organizationId: string, id: string, payload: Partial<CreateJobDto>) {
    const existing = await this.prisma.jobPosting.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Job requisition not found.');

    const updated = await this.prisma.jobPosting.update({
      where: { id },
      data: {
        title: payload.title?.trim(),
        department: payload.department?.trim(),
        location: payload.location,
        type: payload.type,
        experienceLevel: payload.experienceLevel,
        salaryRange: payload.salaryRange,
        description: payload.description,
        requirements: payload.requirements,
        benefits: payload.benefits,
        headcount: payload.headcount,
        status: payload.status,
      },
    });

    const count = await this.prisma.jobApplication.count({ where: { jobPostingId: id } });

    return {
      ...updated,
      applicantCount: count,
      applicantsCount: count,
      createdAt: updated.createdAt.toISOString().slice(0, 10),
    };
  }

  async deleteJob(organizationId: string, id: string) {
    const existing = await this.prisma.jobPosting.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Job requisition not found.');

    await this.prisma.jobApplication.deleteMany({ where: { jobPostingId: id } });
    await this.prisma.jobPosting.delete({ where: { id } });

    return { ok: true };
  }

  async getApplications(organizationId: string, jobPostingId?: string, status?: string) {

    const where: any = { organizationId };
    if (jobPostingId) where.jobPostingId = jobPostingId;
    if (status) where.status = status;

    const [applications, jobs] = await Promise.all([
      this.prisma.jobApplication.findMany({
        where,
        orderBy: { appliedAt: 'desc' },
      }),
      this.prisma.jobPosting.findMany({
        where: { organizationId },
        select: { id: true, title: true, department: true },
      }),
    ]);

    const jobMap = new Map(jobs.map((j) => [j.id, j]));

    return applications.map((a) => {
      const job = jobMap.get(a.jobPostingId);
      return {
        ...a,
        jobTitle: job?.title || 'Unknown Role',
        department: job?.department || 'General',
        experience: `${a.experienceYears || 0} yrs`,
        appliedDate: a.appliedAt.toISOString().slice(0, 10),
        appliedAt: a.appliedAt.toISOString().slice(0, 10),
        stage: a.status, // frontend compatibility alias
        name: a.candidateName, // frontend compatibility alias
      };
    });
  }

  async updateApplication(organizationId: string, id: string, payload: any) {
    const existing = await this.prisma.jobApplication.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Candidate application not found.');

    const status = payload.status || payload.stage;

    const updated = await this.prisma.jobApplication.update({
      where: { id },
      data: {
        status: status ? status : undefined,
        notes: payload.notes !== undefined ? payload.notes : undefined,
        aiScore: payload.aiScore !== undefined ? payload.aiScore : undefined,
        interviewDate: payload.interviewDate ? new Date(payload.interviewDate) : undefined,
      },
    });

    const job = await this.prisma.jobPosting.findUnique({
      where: { id: updated.jobPostingId },
      select: { title: true, department: true },
    });

    return {
      ...updated,
      jobTitle: job?.title || 'General',
      department: job?.department || 'General',
      experience: `${updated.experienceYears || 0} yrs`,
      appliedDate: updated.appliedAt.toISOString().slice(0, 10),
      appliedAt: updated.appliedAt.toISOString().slice(0, 10),
      stage: updated.status,
      name: updated.candidateName,
    };
  }

  async convertToEmployee(organizationId: string, applicationId: string) {
    const application = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, organizationId },
    });
    if (!application) throw new NotFoundException('Candidate application not found.');

    const job = await this.prisma.jobPosting.findUnique({
      where: { id: application.jobPostingId },
    });

    // Split name into first and last
    const nameParts = application.candidateName.trim().split(/\s+/);
    const firstName = nameParts[0] || 'New';
    const lastName = nameParts.slice(1).join(' ') || 'Employee';

    // Create a new employee record
    const empId = `emp-${randomUUID().slice(0, 8)}`;
    const employee = await this.prisma.employee.create({
      data: {
        id: empId,
        userId: `usr-hired-${randomUUID().slice(0, 8)}`,
        organizationId,
        employeeId: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
        firstName,
        lastName,
        contactNumber: application.phone || '+91 90000 00000',
        jobTitle: job?.title || 'Software Engineer',
        department: job?.department || 'Engineering',
        startDate: new Date(),
        employmentType: job?.type || 'Full-time',
        workLocation: job?.location || 'Remote / Hybrid',
        status: 'ACTIVE',
      },
    });

    // Mark application as HIRED
    const updatedApplication = await this.prisma.jobApplication.update({
      where: { id: applicationId },
      data: { status: 'HIRED' },
    });

    // Notify organization
    const memberships = await this.prisma.membership.findMany({ where: { organizationId } });
    if (memberships.length > 0) {
      await this.notifications.createForMany(
        memberships.map((m) => m.userId),
        {
          organizationId,
          title: 'Candidate Onboarded As Employee',
          body: `${application.candidateName} was hired and added to the employee directory.`,
          kind: 'employees',
          link: '/dashboard/employees',
        },
      );
    }

    return {
      message: 'Candidate successfully converted to active employee.',
      employee,
      application: {
        ...updatedApplication,
        stage: 'HIRED',
      },
    };
  }
}
