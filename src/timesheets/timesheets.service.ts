import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { writeAuditLog } from '../common/audit-log';
import type { SaveTimesheetDto } from './dto/timesheets.dto';
import { ModuleRef } from '@nestjs/core';
import { ComplianceService } from '../compliance/compliance.service';

function canManage(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('timesheets.manage') || permissions.includes('reports.view');
}

@Injectable()
export class TimesheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private async getEmployee(userId: string, organizationId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { userId, organizationId },
    });
    if (!employee || employee.deletedAt) {
      throw new NotFoundException('Employee profile not found.');
    }
    return employee;
  }

  async saveTimesheet(organizationId: string, userId: string, dto: SaveTimesheetDto) {
    const employee = await this.getEmployee(userId, organizationId);
    
    // Validate daily hours arrays & daily sums
    const dailyTotals = Array(7).fill(0);
    for (const r of dto.rows) {
      if (r.hours.length !== 7) {
        throw new BadRequestException('Each row must contain exactly 7 daily hour values.');
      }
      for (let i = 0; i < 7; i++) {
        const h = r.hours[i];
        if (h < 0 || h > 24) {
          throw new BadRequestException('Daily hours must be between 0 and 24.');
        }
        dailyTotals[i] += h;
        if (dailyTotals[i] > 24) {
          throw new BadRequestException(`Total hours tracked on day ${i + 1} cannot exceed 24 hours.`);
        }
      }
    }

    // Calculate total hours
    let totalHours = 0;
    for (const r of dto.rows) {
      totalHours += r.hours.reduce((a, b) => a + b, 0);
    }

    const existing = await this.prisma.timesheet.findFirst({
      where: { employeeId: employee.id, weekStartDate: dto.weekStartDate, organizationId },
    });

    if (existing) {
      if (existing.status === 'APPROVED') {
        throw new ForbiddenException('Cannot modify an approved timesheet.');
      }
      const updated = await this.prisma.timesheet.update({
        where: { id: existing.id },
        data: {
          totalHours,
          rowsJson: JSON.stringify(dto.rows),
        },
      });

      await writeAuditLog(this.prisma, {
        organizationId,
        userId,
        action: 'UPDATE',
        resource: 'Timesheet',
        resourceId: updated.id,
        result: 'ALLOW',
        details: { weekStartDate: dto.weekStartDate, totalHours },
      });

      return {
        id: updated.id,
        weekStartDate: updated.weekStartDate,
        status: updated.status,
        totalHours: updated.totalHours,
        rows: dto.rows,
      };
    }

    const created = await this.prisma.timesheet.create({
      data: {
        id: `tsh-${randomUUID().slice(0, 8)}`,
        organizationId,
        employeeId: employee.id,
        weekStartDate: dto.weekStartDate,
        status: 'DRAFT',
        totalHours,
        rowsJson: JSON.stringify(dto.rows),
      },
    });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'CREATE',
      resource: 'Timesheet',
      resourceId: created.id,
      result: 'ALLOW',
      details: { weekStartDate: dto.weekStartDate, totalHours },
    });

    return {
      id: created.id,
      weekStartDate: created.weekStartDate,
      status: created.status,
      totalHours: created.totalHours,
      rows: dto.rows,
    };
  }

  async getTimesheet(organizationId: string, userId: string, weekStartDate: string) {
    const employee = await this.getEmployee(userId, organizationId);

    const timesheet = await this.prisma.timesheet.findFirst({
      where: { employeeId: employee.id, weekStartDate, organizationId },
    });

    if (!timesheet) {
      return {
        id: '',
        weekStartDate,
        status: 'DRAFT',
        totalHours: 0,
        rows: [],
      };
    }

    let rows = [];
    try {
      rows = JSON.parse(timesheet.rowsJson);
    } catch (err) {
      console.error(`Failed to parse timesheet rows for ${timesheet.id}`, err);
    }

    return {
      id: timesheet.id,
      weekStartDate: timesheet.weekStartDate,
      status: timesheet.status,
      totalHours: timesheet.totalHours,
      rows,
    };
  }

  async updateStatus(
    id: string,
    organizationId: string,
    userId: string,
    permissions: string[],
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED',
  ) {
    const timesheet = await this.prisma.timesheet.findUnique({ where: { id } });
    if (!timesheet || timesheet.organizationId !== organizationId) {
      throw new NotFoundException('Timesheet not found.');
    }

    // Immutability checks: Block changing status of already APPROVED timesheets
    if (timesheet.status === 'APPROVED') {
      throw new ForbiddenException('Cannot modify status of an approved timesheet.');
    }

    const employee = await this.prisma.employee.findFirst({ where: { userId, organizationId } });

    // Submission to SUBMITTED or back to DRAFT is allowed by the owner employee
    if (status === 'DRAFT' || status === 'SUBMITTED') {
      if (!employee || timesheet.employeeId !== employee.id) {
        throw new ForbiddenException('You can only submit or modify your own timesheets.');
      }
    }

    // Approval/rejection is restricted to managers
    if (status === 'APPROVED' || status === 'REJECTED') {
      if (!canManage(permissions)) {
        throw new ForbiddenException('Only managers can approve or reject timesheets.');
      }
    }

    const updated = await this.prisma.timesheet.update({
      where: { id },
      data: { status },
    });

    // Write audit log
    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: status === 'APPROVED' || status === 'REJECTED' ? 'DECIDE' : 'UPDATE',
      resource: 'Timesheet',
      resourceId: id,
      result: 'ALLOW',
      details: { status },
    });

    // Notifications
    const timesheetEmployee = await this.prisma.employee.findUnique({ where: { id: timesheet.employeeId } });
    if (status === 'SUBMITTED' && timesheetEmployee?.managerId) {
      const manager = await this.prisma.employee.findUnique({ where: { id: timesheetEmployee.managerId } });
      if (manager?.userId) {
        await this.notifications.create({
          userId: manager.userId,
          organizationId,
          title: 'Timesheet Submitted',
          body: `${timesheetEmployee.firstName} submitted weekly timesheet for ${timesheet.weekStartDate}.`,
          kind: 'employee',
          link: '/dashboard/timesheets',
        });
      }
    }

    if ((status === 'APPROVED' || status === 'REJECTED') && timesheetEmployee?.userId) {
      await this.notifications.create({
        userId: timesheetEmployee.userId,
        organizationId,
        title: `Timesheet ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
        body: `Your weekly timesheet for ${timesheet.weekStartDate} has been ${status.toLowerCase()}.`,
        kind: 'employee',
        link: '/dashboard/timesheets',
      });
    }

    if (status === 'APPROVED') {
      if (updated.totalHours > 48) {
        try {
          const complianceService = this.moduleRef.get(ComplianceService, { strict: false });
          const obligations = await this.prisma.complianceObligation.findMany({
            where: { organizationId, targetType: 'EMPLOYEE', targetId: timesheet.employeeId },
          });
          for (const obl of obligations) {
            const req = await this.prisma.complianceRequirement.findUnique({ where: { id: obl.requirementId } });
            if (req && req.category === 'ATTENDANCE') {
              await complianceService.triggerViolation(
                organizationId,
                obl.id,
                'OVERTIME_LIMIT_BREACH',
                `Employee breached weekly work limit: worked ${updated.totalHours} hours (limit is 48 hours) in week starting ${timesheet.weekStartDate}.`,
              );
            }
          }
        } catch (err) {
          console.error('Failed to trigger compliance overtime violation:', err);
        }
      }
    }

    let rows = [];
    try {
      rows = JSON.parse(updated.rowsJson);
    } catch (err) {
      console.error(`Failed to parse timesheet rows for ${updated.id}`, err);
    }

    return {
      id: updated.id,
      weekStartDate: updated.weekStartDate,
      status: updated.status,
      totalHours: updated.totalHours,
      rows,
    };
  }

  async listAll(organizationId: string, permissions: string[]) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to view all timesheets.');
    }

    const timesheets = await this.prisma.timesheet.findMany({
      where: { organizationId },
      orderBy: { weekStartDate: 'desc' },
    });

    const allEmployees = await this.prisma.employee.findMany({
      where: { organizationId },
    });
    const employees = allEmployees.filter((e) => !e.deletedAt);

    return timesheets.map((t) => {
      const emp = employees.find((e) => e.id === t.employeeId);
      const employeeName = emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown Employee';

      let rows = [];
      try {
        rows = JSON.parse(t.rowsJson);
      } catch (err) {
        console.error(`Failed to parse timesheet rows for ${t.id}`, err);
      }

      return {
        id: t.id,
        employeeId: t.employeeId,
        employeeName,
        weekStartDate: t.weekStartDate,
        status: t.status,
        totalHours: t.totalHours,
        rows,
      };
    });
  }
}
