import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { writeAuditLog } from '../common/audit-log';
import type { DepartmentRow, ReportsData } from './reports.entity';

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
const round1 = (n: number) => Math.round(n * 10) / 10;

function canViewPayroll(permissions: string[]): boolean {
  return (
    permissions.includes('*') ||
    permissions.includes('payroll.view') ||
    permissions.includes('payroll.manage') ||
    permissions.includes('payroll.*')
  );
}

type EmployeeRow = {
  id: string;
  department: string;
  startDate: Date;
  deletedAt: Date | null;
};

function extractRawNumber(val: any): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  if (val.$numberInt) return parseInt(val.$numberInt, 10);
  if (val.$numberDouble) return parseFloat(val.$numberDouble);
  if (val.$numberLong) return parseInt(val.$numberLong, 10);
  return Number(val) || 0;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string, userId: string, permissions: string[]): Promise<ReportsData> {
    const allEmployees: EmployeeRow[] = await this.prisma.employee.findMany({
      where: { organizationId },
      select: { id: true, department: true, startDate: true, deletedAt: true },
    });
    const activeEmployees = allEmployees.filter((e) => !e.deletedAt);
    const activeIds = activeEmployees.map((e) => e.id);

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthStart = `${year}-${pad(month + 1)}-01`;
    const todayISO = isoDate(now);
    const currentMonthKey = `${year}-${pad(month + 1)}`;

    const [
      records,
      leaveRequests,
      rawLeaveByEmployee,
      rawExpenses,
      travelRequests,
      openTickets,
      totalAssets,
      rawPayroll,
    ] = await Promise.all([
      activeIds.length
        ? this.prisma.attendanceRecord.findMany({
            where: { organizationId, employeeId: { in: activeIds }, date: { gte: monthStart, lt: todayISO }, checkIn: { not: null } },
          })
        : Promise.resolve([]),
      activeIds.length
        ? this.prisma.leaveRequest.findMany({
            where: { organizationId, employeeId: { in: activeIds }, status: 'APPROVED', startDate: { lt: todayISO }, endDate: { gte: monthStart } },
          })
        : Promise.resolve([]),
      this.prisma.leaveRequest.aggregateRaw({
        pipeline: [
          { $match: { organizationId, status: 'APPROVED' } },
          { $group: { _id: '$employeeId', totalDays: { $sum: '$days' } } }
        ]
      }),
      this.prisma.expenseClaim.aggregateRaw({
        pipeline: [
          { $match: { organizationId, status: { $in: ['APPROVED', 'REIMBURSED'] } } },
          {
            $group: {
              _id: null,
              total: {
                $sum: {
                  $ifNull: [
                    '$reimbursedAmount',
                    { $ifNull: ['$approvedAmount', '$amount'] }
                  ]
                }
              }
            }
          }
        ]
      }),
      this.prisma.travelRequest.count({
        where: { organizationId, status: { in: ['APPROVED', 'BOOKED'] } },
      }),
      this.prisma.helpdeskTicket.count({
        where: { organizationId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
      this.prisma.asset.count({
        where: { organizationId },
      }),
      canViewPayroll(permissions)
        ? this.prisma.payslip.aggregateRaw({
            pipeline: [
              { $match: { organizationId, month: currentMonthKey, status: 'FINALIZED' } },
              {
                $group: {
                  _id: null,
                  total: { $sum: '$snapshot.grossEarnings' }
                }
              }
            ]
          })
        : Promise.resolve([]),
    ]);

    const attendedKeys = new Set(records.map((r) => `${r.employeeId}:${r.date}`));
    const leaveKeys = new Set<string>();
    for (const req of leaveRequests) {
      for (let d = new Date(`${req.startDate}T00:00:00`); isoDate(d) < todayISO; d.setDate(d.getDate() + 1)) {
        const iso = isoDate(d);
        if (iso >= monthStart) leaveKeys.add(`${req.employeeId}:${iso}`);
      }
    }

    const attendanceRateFor = (employees: EmployeeRow[]): number => {
      let expected = 0;
      let attended = 0;
      for (const emp of employees) {
        const startISO = isoDate(emp.startDate);
        const from = startISO > monthStart ? startISO : monthStart;
        for (let d = new Date(`${from}T00:00:00`); isoDate(d) < todayISO; d.setDate(d.getDate() + 1)) {
          if (isWeekend(d)) continue;
          const iso = isoDate(d);
          const key = `${emp.id}:${iso}`;
          if (leaveKeys.has(key)) continue;
          expected++;
          if (attendedKeys.has(key)) attended++;
        }
      }
      return expected === 0 ? 0 : round1((attended / expected) * 100);
    };

    const leaveDaysByEmployee = new Map<string, number>(
      (rawLeaveByEmployee as unknown as Array<{ _id: string; totalDays: any }>).map((item) => [
        item._id,
        extractRawNumber(item.totalDays),
      ])
    );

    const leaveDaysFor = (employeeIds: string[]): number => {
      return employeeIds.reduce((sum, id) => sum + (leaveDaysByEmployee.get(id) ?? 0), 0);
    };

    const departmentNames = [...new Set(activeEmployees.map((e) => e.department))];
    const departments: DepartmentRow[] = departmentNames
      .map((department) => {
        const people = activeEmployees.filter((e) => e.department === department);
        return {
          department,
          headcount: people.length,
          attendanceRate: attendanceRateFor(people),
          leaveDaysTaken: leaveDaysFor(people.map((p) => p.id)),
          share: activeEmployees.length === 0 ? 0 : round1((people.length / activeEmployees.length) * 100),
        };
      })
      .sort((a, b) => b.headcount - a.headcount);

    const headcountByMonth = Array.from({ length: 6 }, (_, i) => {
      const date = new Date(year, month - (5 - i), 1);
      const cutoff = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      const count = allEmployees.filter((e) => e.startDate <= cutoff && (!e.deletedAt || e.deletedAt > cutoff)).length;
      return { label: date.toLocaleDateString('en-GB', { month: 'short' }), value: count };
    });

    let payrollCost: number | null = null;
    if (canViewPayroll(permissions)) {
      payrollCost = Math.round(
        extractRawNumber((rawPayroll as unknown as Array<{ total: any }>)[0]?.total)
      );
    }

    const expenseTotal = Math.round(
      extractRawNumber((rawExpenses as unknown as Array<{ total: any }>)[0]?.total)
    );

    const totalLeaveDays = [...leaveDaysByEmployee.values()].reduce((sum, d) => sum + d, 0);

    return {
      headcount: allEmployees.length,
      activeCount: activeEmployees.length,
      attritionRate: allEmployees.length === 0 ? 0 : round1(((allEmployees.length - activeEmployees.length) / allEmployees.length) * 100),
      avgAttendance: attendanceRateFor(activeEmployees),
      leaveDaysTaken: totalLeaveDays,
      payrollCost,
      expenseTotal,
      travelCount: travelRequests,
      openTicketsCount: openTickets,
      totalAssetsCount: totalAssets,
      departments,
      headcountByMonth,
    };
  }

  async export(organizationId: string, userId: string, permissions: string[]): Promise<ReportsData> {
    const data = await this.get(organizationId, userId, permissions);

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'EXPORT',
      resource: 'Reports',
      resourceId: `rpt-${organizationId}`,
      result: 'ALLOW',
      details: { format: 'CSV', activeHeadcount: data.activeCount },
    });

    return data;
  }
}
