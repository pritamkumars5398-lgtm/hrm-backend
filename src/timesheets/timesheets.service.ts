import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { SaveTimesheetDto } from './dto/timesheets.dto';

function canManage(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('timesheets.manage') || permissions.includes('reports.view');
}

@Injectable()
export class TimesheetsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async updateStatus(id: string, organizationId: string, permissions: string[], status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED') {
    const timesheet = await this.prisma.timesheet.findUnique({ where: { id } });
    if (!timesheet || timesheet.organizationId !== organizationId) {
      throw new NotFoundException('Timesheet not found.');
    }

    // Submission to SUBMITTED or back to DRAFT is allowed by the owner employee
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
