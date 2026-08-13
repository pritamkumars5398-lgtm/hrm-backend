import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { writeAuditLog } from '../common/audit-log';
import type { PublicOnboarding, PublicOnboardingData, PublicOnboardingTask } from './onboarding.entity';
import type { AddTaskDto, UpdateTaskDto } from './dto/onboarding.dto';

function canManage(permissions: string[]): boolean {
  return (
    permissions.includes('*') ||
    permissions.includes('recruitment.manage') ||
    permissions.includes('employees.manage') ||
    permissions.includes('reports.view')
  );
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async activeEmployees(organizationId: string) {
    const all = await this.prisma.employee.findMany({ where: { organizationId } });
    return all.filter((e) => !e.deletedAt);
  }

  private async myEmployee(userId: string, organizationId: string) {
    const employees = await this.activeEmployees(organizationId);
    return employees.find((e) => e.userId === userId) ?? null;
  }

  async get(params: { userId: string; organizationId: string; permissions: string[] }): Promise<PublicOnboardingData> {
    const { userId, organizationId, permissions } = params;
    const manage = canManage(permissions);
    const allEmployees = await this.activeEmployees(organizationId);
    const me = allEmployees.find((e) => e.userId === userId) ?? null;

    let scope: PublicOnboardingData['scope'];
    let visible: typeof allEmployees;

    if (manage) {
      scope = 'company';
      visible = allEmployees;
    } else {
      const reports = me ? allEmployees.filter((e) => e.managerId === me.id) : [];
      if (reports.length > 0) {
        scope = 'team';
        visible = reports;
      } else {
        scope = 'me';
        visible = me ? [me] : [];
      }
    }

    if (visible.length === 0) {
      return { scope, records: [], summary: { total: 0, pending: 0, completed: 0, avgProgress: 0 } };
    }

    const visibleIds = visible.map((e) => e.id);
    const [onboardings, allTasks] = await Promise.all([
      this.prisma.onboarding.findMany({ where: { organizationId, employeeId: { in: visibleIds } } }),
      this.prisma.onboardingTask.findMany({ where: { organizationId } }),
    ]);

    const onboardingRecords: PublicOnboarding[] = [];
    const empMap = new Map(allEmployees.map((e) => [e.id, e]));

    for (const ob of onboardings) {
      const emp = empMap.get(ob.employeeId);
      if (!emp) continue;

      const tasks = allTasks
        .filter((t) => t.onboardingId === ob.id)
        .map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          category: t.category as PublicOnboardingTask['category'],
          status: t.status as PublicOnboardingTask['status'],
          dueDate: t.dueDate,
        }));

      const completedCount = tasks.filter((t) => t.status === 'COMPLETED').length;
      const progress = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100);

      onboardingRecords.push({
        id: ob.id,
        organizationId: ob.organizationId,
        employeeId: ob.employeeId,
        employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
        jobTitle: emp.jobTitle,
        department: emp.department,
        joiningDate: emp.startDate.toISOString().slice(0, 10),
        status: ob.status as PublicOnboarding['status'],
        buddy: ob.buddy,
        checklistProgress: progress,
        tasks,
      });
    }

    const total = onboardingRecords.length;
    const completed = onboardingRecords.filter((r) => r.status === 'COMPLETED').length;
    const pending = total - completed;
    const avgProgress = total === 0 ? 0 : Math.round(onboardingRecords.reduce((acc, r) => acc + r.checklistProgress, 0) / total);

    return {
      scope,
      records: onboardingRecords.sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
      summary: {
        total,
        pending,
        completed,
        avgProgress,
      },
    };
  }

  async addTask(
    userId: string,
    organizationId: string,
    permissions: string[],
    employeeId: string,
    dto: AddTaskDto,
  ): Promise<PublicOnboardingTask> {
    if (!canManage(permissions)) {
      const me = await this.myEmployee(userId, organizationId);
      const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
      if (!employee || employee.organizationId !== organizationId || !me || employee.managerId !== me.id) {
        throw new ForbiddenException('You do not have permission to manage this onboarding.');
      }
    }

    const onboarding = await this.prisma.onboarding.findUnique({ where: { employeeId } });
    if (!onboarding || onboarding.organizationId !== organizationId) {
      throw new NotFoundException('Onboarding record not found.');
    }

    const taskId = `ob-tsk-${randomUUID().slice(0, 8)}`;
    const task = await this.prisma.onboardingTask.create({
      data: {
        id: taskId,
        organizationId,
        onboardingId: onboarding.id,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        category: dto.category,
        status: 'PENDING',
        dueDate: dto.dueDate || null,
      },
    });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'CREATE',
      resource: 'OnboardingTask',
      resourceId: taskId,
      result: 'ALLOW',
      details: { title: dto.title },
    });

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      category: task.category as PublicOnboardingTask['category'],
      status: task.status as PublicOnboardingTask['status'],
      dueDate: task.dueDate,
    };
  }

  async updateTask(
    userId: string,
    organizationId: string,
    permissions: string[],
    taskId: string,
    dto: UpdateTaskDto,
  ): Promise<void> {
    const task = await this.prisma.onboardingTask.findUnique({ where: { id: taskId } });
    if (!task || task.organizationId !== organizationId) {
      throw new NotFoundException('Task not found.');
    }

    const onboarding = await this.prisma.onboarding.findUnique({ where: { id: task.onboardingId } });
    if (!onboarding) {
      throw new NotFoundException('Onboarding record not found.');
    }

    const manage = canManage(permissions);
    const me = await this.myEmployee(userId, organizationId);
    const isOwnTask = me !== null && onboarding.employeeId === me.id;

    if (!manage && !isOwnTask && (!me || onboarding.buddy !== me.firstName)) {
      // Check reporting manager scope
      const employee = await this.prisma.employee.findUnique({ where: { id: onboarding.employeeId } });
      if (!employee || employee.managerId !== me?.id) {
        throw new ForbiddenException('You do not have permission to update this task.');
      }
    }

    await this.prisma.onboardingTask.update({
      where: { id: taskId },
      data: { status: dto.status },
    });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'UPDATE',
      resource: 'OnboardingTask',
      resourceId: taskId,
      result: 'ALLOW',
      details: { status: dto.status },
    });

    // Notify assignee / manager
    if (dto.status === 'COMPLETED' && isOwnTask) {
      const employee = await this.prisma.employee.findUnique({ where: { id: onboarding.employeeId } });
      if (employee?.managerId) {
        const manager = await this.prisma.employee.findUnique({ where: { id: employee.managerId } });
        if (manager?.userId) {
          await this.notifications.create({
            userId: manager.userId,
            organizationId,
            title: 'Onboarding task completed',
            body: `${employee.firstName} completed task: "${task.title}"`,
            kind: 'employee',
            link: '/dashboard/onboarding',
          });
        }
      }
    }
  }

  async completeOnboarding(
    userId: string,
    organizationId: string,
    permissions: string[],
    employeeId: string,
  ): Promise<void> {
    if (!canManage(permissions)) {
      const me = await this.myEmployee(userId, organizationId);
      const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
      if (!employee || employee.organizationId !== organizationId || !me || employee.managerId !== me.id) {
        throw new ForbiddenException('You do not have permission to complete this onboarding.');
      }
    }

    const onboarding = await this.prisma.onboarding.findUnique({ where: { employeeId } });
    if (!onboarding || onboarding.organizationId !== organizationId) {
      throw new NotFoundException('Onboarding record not found.');
    }

    // Verify all tasks are completed
    const pendingTasks = await this.prisma.onboardingTask.findMany({
      where: { onboardingId: onboarding.id, status: 'PENDING' },
    });
    if (pendingTasks.length > 0) {
      throw new BadRequestException('All onboarding tasks must be completed before finalizing.');
    }

    await this.prisma.onboarding.update({
      where: { id: onboarding.id },
      data: { status: 'COMPLETED' },
    });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'UPDATE',
      resource: 'Onboarding',
      resourceId: onboarding.id,
      result: 'ALLOW',
      details: { status: 'COMPLETED' },
    });

    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (employee) {
      await this.notifications.create({
        userId: employee.userId,
        organizationId,
        title: 'Onboarding Completed!',
        body: 'Welcome to Alderway Labs! Your induction checklist is fully complete.',
        kind: 'employee',
        link: '/dashboard/onboarding',
      });
    }
  }
}
