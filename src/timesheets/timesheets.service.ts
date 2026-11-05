import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { randomUUID } from 'node:crypto';

export type TimeRow = {
  id: string;
  client: string;
  project: string;
  task: string;
  hours: number[]; // 7 days Mon-Sun
  isBillable: boolean;
};

export type SaveTimesheetDto = {
  weekStartDate?: string;
  rows: TimeRow[];
};

const INITIAL_ROWS: TimeRow[] = [
  {
    id: 'row-1',
    client: 'Acme Corp',
    project: 'Enterprise Portal',
    task: 'Frontend Dashboard Development',
    hours: [8, 8, 8, 7.5, 8, 0, 0],
    isBillable: true,
  },
  {
    id: 'row-2',
    client: 'Internal',
    project: 'HRMS SaaS Integration',
    task: 'Prisma Schema & API Wiring',
    hours: [0, 0, 0, 1, 0, 0, 0],
    isBillable: false,
  },
];

@Injectable()
export class TimesheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private getWeekStartDate(): string {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(now.setDate(diff));
    return monday.toISOString().slice(0, 10);
  }

  private calculateHours(rows: TimeRow[]) {
    let totalHours = 0;
    let billableHours = 0;
    for (const r of rows) {
      const rowSum = (r.hours || []).reduce((a, b) => a + (Number(b) || 0), 0);
      totalHours += rowSum;
      if (r.isBillable) billableHours += rowSum;
    }
    return { totalHours, billableHours };
  }

  async getCurrentTimesheet(organizationId: string, userId: string, userName: string) {
    const weekStartDate = this.getWeekStartDate();

    let timesheet = await this.prisma.timesheet.findFirst({
      where: { organizationId, userId, weekStartDate },
    });

    if (!timesheet) {
      const { totalHours, billableHours } = this.calculateHours(INITIAL_ROWS);
      timesheet = await this.prisma.timesheet.create({
        data: {
          id: `ts-${randomUUID().slice(0, 8)}`,
          organizationId,
          userId,
          employeeName: userName || 'Employee',
          weekStartDate,
          status: 'DRAFT',
          rowsJson: JSON.stringify(INITIAL_ROWS),
          totalHours,
          billableHours,
        },
      });
    }

    let rows: TimeRow[] = [];
    try {
      rows = JSON.parse(timesheet.rowsJson || '[]');
    } catch {
      rows = [];
    }

    return {
      ...timesheet,
      rows,
      createdAt: timesheet.createdAt.toISOString().slice(0, 10),
    };
  }

  async saveTimesheet(
    organizationId: string,
    userId: string,
    userName: string,
    dto: SaveTimesheetDto,
  ) {
    const weekStartDate = dto.weekStartDate || this.getWeekStartDate();
    const { totalHours, billableHours } = this.calculateHours(dto.rows);

    let timesheet = await this.prisma.timesheet.findFirst({
      where: { organizationId, userId, weekStartDate },
    });

    if (timesheet) {
      if (timesheet.status === 'APPROVED') {
        throw new BadRequestException('This timesheet is already approved and locked.');
      }
      timesheet = await this.prisma.timesheet.update({
        where: { id: timesheet.id },
        data: {
          rowsJson: JSON.stringify(dto.rows),
          totalHours,
          billableHours,
          employeeName: userName || timesheet.employeeName,
        },
      });
    } else {
      timesheet = await this.prisma.timesheet.create({
        data: {
          id: `ts-${randomUUID().slice(0, 8)}`,
          organizationId,
          userId,
          employeeName: userName || 'Employee',
          weekStartDate,
          status: 'DRAFT',
          rowsJson: JSON.stringify(dto.rows),
          totalHours,
          billableHours,
        },
      });
    }

    return {
      ...timesheet,
      rows: dto.rows,
      createdAt: timesheet.createdAt.toISOString().slice(0, 10),
    };
  }

  async submitTimesheet(organizationId: string, id: string, userName: string) {
    const timesheet = await this.prisma.timesheet.findFirst({
      where: { id, organizationId },
    });
    if (!timesheet) throw new NotFoundException('Timesheet not found.');

    const updated = await this.prisma.timesheet.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });

    // Notify managers
    const memberships = await this.prisma.membership.findMany({ where: { organizationId } });
    if (memberships.length > 0) {
      await this.notifications.createForMany(
        memberships.map((m) => m.userId),
        {
          organizationId,
          title: 'Timesheet Submitted For Approval',
          body: `${userName || timesheet.employeeName} submitted weekly timesheet (${updated.totalHours} hrs).`,
          kind: 'timesheets',
          link: '/dashboard/timesheets',
        },
      );
    }

    let rows: TimeRow[] = [];
    try {
      rows = JSON.parse(updated.rowsJson || '[]');
    } catch {
      rows = [];
    }

    return {
      ...updated,
      rows,
      createdAt: updated.createdAt.toISOString().slice(0, 10),
    };
  }

  async approveTimesheet(organizationId: string, id: string, approverName: string) {
    const timesheet = await this.prisma.timesheet.findFirst({
      where: { id, organizationId },
    });
    if (!timesheet) throw new NotFoundException('Timesheet not found.');

    const updated = await this.prisma.timesheet.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: approverName,
      },
    });

    if (timesheet.userId) {
      await this.notifications.create({
        userId: timesheet.userId,
        organizationId,
        title: 'Timesheet Approved',
        body: `Your timesheet for week ${timesheet.weekStartDate} has been approved by ${approverName}.`,
        kind: 'timesheets',
        link: '/dashboard/timesheets',
      });
    }

    let rows: TimeRow[] = [];
    try {
      rows = JSON.parse(updated.rowsJson || '[]');
    } catch {
      rows = [];
    }

    return {
      ...updated,
      rows,
      createdAt: updated.createdAt.toISOString().slice(0, 10),
    };
  }

  async rejectTimesheet(organizationId: string, id: string, rejecterName: string, reason: string) {
    const timesheet = await this.prisma.timesheet.findFirst({
      where: { id, organizationId },
    });
    if (!timesheet) throw new NotFoundException('Timesheet not found.');

    const updated = await this.prisma.timesheet.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason || 'Needs revisions by employee.',
      },
    });

    if (timesheet.userId) {
      await this.notifications.create({
        userId: timesheet.userId,
        organizationId,
        title: 'Timesheet Sent Back for Revisions',
        body: `Your timesheet for week ${timesheet.weekStartDate} was returned by ${rejecterName}: ${reason || 'Please adjust hours'}.`,
        kind: 'timesheets',
        link: '/dashboard/timesheets',
      });
    }

    let rows: TimeRow[] = [];
    try {
      rows = JSON.parse(updated.rowsJson || '[]');
    } catch {
      rows = [];
    }

    return {
      ...updated,
      rows,
      createdAt: updated.createdAt.toISOString().slice(0, 10),
    };
  }

  async getAll(organizationId: string) {
    const list = await this.prisma.timesheet.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    return list.map((ts) => {
      let rows: TimeRow[] = [];
      try {
        rows = JSON.parse(ts.rowsJson || '[]');
      } catch {
        rows = [];
      }
      return {
        ...ts,
        rows,
        createdAt: ts.createdAt.toISOString().slice(0, 10),
      };
    });
  }
}
