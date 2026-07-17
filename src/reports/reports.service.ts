import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { DepartmentRow, ReportsData } from './reports.entity';

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Mirrors PermissionsGuard's own matching — payroll cost stays hidden from
 *  anyone without real payroll access, even if they hold reports.view (§4.6). */
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

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string, permissions: string[]): Promise<ReportsData> {
    const allEmployees: EmployeeRow[] = await this.prisma.employee.findMany({
      where: { organizationId },
      select: { id: true, department: true, startDate: true, deletedAt: true },
    });
    // There is no lifecycle/status field on Employee (§ employee.entity's own
    // note) — a soft-deleted record is the only real signal that someone left,
    // so it stands in for "attrition" here.
    const activeEmployees = allEmployees.filter((e) => !e.deletedAt);
    const activeIds = activeEmployees.map((e) => e.id);

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthStart = `${year}-${pad(month + 1)}-01`;
    const todayISO = isoDate(now);

    const [records, leaveRequests, allApprovedLeave] = await Promise.all([
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
      this.prisma.leaveRequest.findMany({ where: { organizationId, status: 'APPROVED' } }),
    ]);

    const attendedKeys = new Set(records.map((r) => `${r.employeeId}:${r.date}`));
    const leaveKeys = new Set<string>();
    for (const req of leaveRequests) {
      for (let d = new Date(`${req.startDate}T00:00:00`); isoDate(d) < todayISO; d.setDate(d.getDate() + 1)) {
        const iso = isoDate(d);
        if (iso >= monthStart) leaveKeys.add(`${req.employeeId}:${iso}`);
      }
    }

    // Same "expected working day" definition as the real Attendance module:
    // weekdays only, from join date forward, never today/the future, and a
    // day covered by approved leave doesn't count as a failure to attend.
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

    const leaveDaysFor = (employeeIds: string[]): number => {
      const idSet = new Set(employeeIds);
      return allApprovedLeave.filter((r) => idSet.has(r.employeeId)).reduce((sum, r) => sum + r.days, 0);
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
      const cutoff = new Date(date.getFullYear(), date.getMonth() + 1, 0); // last day of that month
      const count = allEmployees.filter((e) => e.startDate <= cutoff && (!e.deletedAt || e.deletedAt > cutoff)).length;
      return { label: date.toLocaleDateString('en-GB', { month: 'short' }), value: count };
    });

    let payrollCost: number | null = null;
    if (canViewPayroll(permissions)) {
      const currentMonthKey = `${year}-${pad(month + 1)}`;
      const finalizedPayslips = await this.prisma.payslip.findMany({
        where: { organizationId, month: currentMonthKey, status: 'FINALIZED' },
      });
      payrollCost = Math.round(finalizedPayslips.reduce((sum, p) => sum + (p.snapshot?.grossEarnings ?? 0), 0));
    }

    return {
      headcount: allEmployees.length,
      activeCount: activeEmployees.length,
      attritionRate: allEmployees.length === 0 ? 0 : round1(((allEmployees.length - activeEmployees.length) / allEmployees.length) * 100),
      avgAttendance: attendanceRateFor(activeEmployees),
      leaveDaysTaken: allApprovedLeave.reduce((sum, r) => sum + r.days, 0),
      payrollCost,
      departments,
      headcountByMonth,
    };
  }
}
