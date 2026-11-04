import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { randomUUID } from 'node:crypto';

export type OnboardingTask = {
  id: string;
  title: string;
  category: 'DOCS' | 'IT' | 'HR' | 'TRAINING';
  completed: boolean;
  completedAt?: string;
};

export type CreateOnboardingDto = {
  name: string;
  email?: string;
  jobTitle: string;
  department: string;
  joiningDate: string;
  buddy?: string;
  employeeId?: string;
};

export type UpdateOnboardingDto = {
  name?: string;
  email?: string;
  jobTitle?: string;
  department?: string;
  joiningDate?: string;
  buddy?: string;
  status?: 'IN_PROGRESS' | 'COMPLETED';
};

const DEFAULT_TASKS: Omit<OnboardingTask, 'id' | 'completed'>[] = [
  { title: 'Identity & Address Proof Verification (Aadhaar/PAN)', category: 'DOCS' },
  { title: 'Academic & Relieving Letters Uploaded & Verified', category: 'DOCS' },
  { title: 'Bank Account & Statutory PF Details Registered', category: 'DOCS' },
  { title: 'Signed Employment Agreement & Non-Disclosure (E-Sign)', category: 'HR' },
  { title: 'Company Email, Slack & Google Workspace Account Setup', category: 'IT' },
  { title: 'Hardware Asset (Laptop/Accessories) Handover & VPN Config', category: 'IT' },
  { title: '1-on-1 Buddy Introduction & Team Welcome Call', category: 'HR' },
  { title: 'Code of Conduct, Security & POSH Policy Induction', category: 'TRAINING' },
];

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getAll(organizationId: string, status?: string) {

    const where: any = { organizationId };
    if (status && status !== 'ALL') {
      where.status = status;
    }

    const items = await this.prisma.onboardingTracker.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return items.map((item) => {
      let tasks: OnboardingTask[] = [];
      try {
        tasks = JSON.parse(item.tasksJson || '[]');
      } catch {
        tasks = [];
      }
      return {
        id: item.id,
        organizationId: item.organizationId,
        employeeId: item.employeeId,
        name: item.name,
        email: item.email,
        jobTitle: item.jobTitle,
        department: item.department,
        joiningDate: item.joiningDate,
        buddy: item.buddy,
        status: item.status as 'IN_PROGRESS' | 'COMPLETED',
        checklistProgress: item.checklistProgress,
        tasks,
        createdAt: item.createdAt.toISOString().slice(0, 10),
      };
    });
  }

  async getById(organizationId: string, id: string) {
    const item = await this.prisma.onboardingTracker.findFirst({
      where: { id, organizationId },
    });
    if (!item) throw new NotFoundException('Onboarding tracker entry not found.');

    let tasks: OnboardingTask[] = [];
    try {
      tasks = JSON.parse(item.tasksJson || '[]');
    } catch {
      tasks = [];
    }

    return {
      ...item,
      tasks,
      createdAt: item.createdAt.toISOString().slice(0, 10),
    };
  }

  async create(organizationId: string, dto: CreateOnboardingDto) {
    if (!dto.name?.trim() || !dto.jobTitle?.trim() || !dto.department?.trim()) {
      throw new BadRequestException('Candidate name, job title, and department are required.');
    }

    const tasks: OnboardingTask[] = DEFAULT_TASKS.map((t, idx) => ({
      id: `task-${Date.now()}-${idx + 1}`,
      ...t,
      completed: false,
    }));

    const item = await this.prisma.onboardingTracker.create({
      data: {
        id: `ob-${randomUUID().slice(0, 8)}`,
        organizationId,
        employeeId: dto.employeeId ?? null,
        name: dto.name.trim(),
        email: dto.email?.trim().toLowerCase() ?? '',
        jobTitle: dto.jobTitle.trim(),
        department: dto.department.trim(),
        joiningDate: dto.joiningDate || new Date().toISOString().slice(0, 10),
        buddy: dto.buddy?.trim() || 'Unassigned',
        status: 'IN_PROGRESS',
        checklistProgress: 0,
        tasksJson: JSON.stringify(tasks),
      },
    });

    // Notify team
    const memberships = await this.prisma.membership.findMany({ where: { organizationId } });
    if (memberships.length > 0) {
      await this.notifications.createForMany(
        memberships.map((m) => m.userId),
        {
          organizationId,
          title: 'New Joiner Onboarding Started',
          body: `Induction checklist created for ${item.name} (${item.jobTitle}).`,
          kind: 'onboarding',
          link: '/dashboard/onboarding-tracker',
        },
      );
    }

    return {
      ...item,
      tasks,
      createdAt: item.createdAt.toISOString().slice(0, 10),
    };
  }

  async update(organizationId: string, id: string, dto: UpdateOnboardingDto) {
    const existing = await this.prisma.onboardingTracker.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Onboarding tracker entry not found.');

    const updated = await this.prisma.onboardingTracker.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        email: dto.email?.trim().toLowerCase(),
        jobTitle: dto.jobTitle?.trim(),
        department: dto.department?.trim(),
        joiningDate: dto.joiningDate,
        buddy: dto.buddy?.trim(),
        status: dto.status,
      },
    });

    let tasks: OnboardingTask[] = [];
    try {
      tasks = JSON.parse(updated.tasksJson || '[]');
    } catch {
      tasks = [];
    }

    return {
      ...updated,
      tasks,
      createdAt: updated.createdAt.toISOString().slice(0, 10),
    };
  }

  async toggleTask(organizationId: string, id: string, taskId: string, completed: boolean) {
    const existing = await this.prisma.onboardingTracker.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Onboarding tracker entry not found.');

    let tasks: OnboardingTask[] = [];
    try {
      tasks = JSON.parse(existing.tasksJson || '[]');
    } catch {
      tasks = [];
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    tasks = tasks.map((t) =>
      t.id === taskId
        ? { ...t, completed, completedAt: completed ? todayStr : undefined }
        : t,
    );

    const completedCount = tasks.filter((t) => t.completed).length;
    const progress = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;
    const status = progress === 100 ? 'COMPLETED' : 'IN_PROGRESS';

    const updated = await this.prisma.onboardingTracker.update({
      where: { id },
      data: {
        tasksJson: JSON.stringify(tasks),
        checklistProgress: progress,
        status,
      },
    });

    if (progress === 100 && existing.status !== 'COMPLETED') {
      const memberships = await this.prisma.membership.findMany({ where: { organizationId } });
      if (memberships.length > 0) {
        await this.notifications.createForMany(
          memberships.map((m) => m.userId),
          {
            organizationId,
            title: 'Onboarding 100% Completed',
            body: `${existing.name} has completed all induction checklist items!`,
            kind: 'onboarding',
            link: '/dashboard/onboarding-tracker',
          },
        );
      }
    }

    return {
      ...updated,
      tasks,
      createdAt: updated.createdAt.toISOString().slice(0, 10),
    };
  }

  async delete(organizationId: string, id: string) {
    const existing = await this.prisma.onboardingTracker.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Onboarding tracker entry not found.');

    await this.prisma.onboardingTracker.delete({ where: { id } });
    return { ok: true };
  }
}
