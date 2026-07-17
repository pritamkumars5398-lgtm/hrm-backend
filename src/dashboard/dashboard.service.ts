import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ActivityItem,
  DashboardData,
  DashboardStat,
  LeaveBreakdownSlice,
  UpcomingLeaveItem,
  WeeklyAttendancePoint,
} from './dashboard.entity';

const LEAVE_TYPES = ['ANNUAL', 'SICK', 'PERSONAL', 'UNPAID'] as const;

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Mirrors PermissionsGuard's own matching — full access, an exact key, or the namespace wildcard. */
function grants(permissions: string[], ...keys: string[]): boolean {
  if (permissions.includes('*')) return true;
  return keys.some((key) => {
    if (permissions.includes(key)) return true;
    const namespace = key.split('.')[0];
    return permissions.includes(`${namespace}.*`);
  });
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Same caveat as every other module: a Mongo `{ deletedAt: null }` filter
   *  does NOT match documents where the field was never written at all (vs.
   *  explicitly set to null) — filter in code instead, everywhere. */
  private async activeEmployees(organizationId: string) {
    const all = await this.prisma.employee.findMany({ where: { organizationId } });
    return all.filter((e) => !e.deletedAt);
  }

  private async myEmployee(userId: string, organizationId: string) {
    const employees = await this.activeEmployees(organizationId);
    return employees.find((e) => e.userId === userId) ?? null;
  }

  /**
   * Every tile and activity row is filtered by the caller's real permissions
   * before it is assembled — never trimmed on the frontend after the fact
   * (§4.7: "a user only sees tiles their permissions actually grant").
   */
  async get(organizationId: string, userId: string, permissions: string[]): Promise<DashboardData> {
    const [stats, activity, weeklyAttendance, leave] = await Promise.all([
      this.buildStats(organizationId, permissions),
      this.buildActivity(organizationId, userId, permissions),
      this.buildWeeklyAttendance(organizationId, permissions),
      this.buildLeaveOverview(organizationId, permissions),
    ]);
    return { stats, activity, weeklyAttendance, ...leave };
  }

  /** Last 7 calendar days (today inclusive), company-wide present headcount
   *  per day — real data replacing the old hand-drawn SVG chart. */
  private async buildWeeklyAttendance(organizationId: string, permissions: string[]): Promise<WeeklyAttendancePoint[]> {
    if (!grants(permissions, 'attendance.manage')) return [];

    const activeEmployees = await this.activeEmployees(organizationId);
    const activeIds = activeEmployees.map((e) => e.id);
    if (activeIds.length === 0) return [];

    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    const startISO = isoDate(start);
    const todayISO = isoDate(today);

    const records = await this.prisma.attendanceRecord.findMany({
      where: { organizationId, employeeId: { in: activeIds }, date: { gte: startISO, lte: todayISO }, checkIn: { not: null } },
    });
    const presentByDate = new Map<string, number>();
    for (const r of records) {
      presentByDate.set(r.date, (presentByDate.get(r.date) ?? 0) + 1);
    }

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const iso = isoDate(d);
      return {
        label: d.toLocaleDateString('en-GB', { weekday: 'short' }),
        present: presentByDate.get(iso) ?? 0,
        expected: activeIds.length,
      };
    });
  }

  /** Approved leave this year, by type, plus how many requests are still
   *  pending and what's coming up next — all gated on leave.approve, all
   *  real (replacing the old hardcoded donut + fake events list). */
  private async buildLeaveOverview(
    organizationId: string,
    permissions: string[],
  ): Promise<{ leaveBreakdown: LeaveBreakdownSlice[]; pendingLeaveCount: number; upcomingLeave: UpcomingLeaveItem[] }> {
    if (!grants(permissions, 'leave.approve')) {
      return { leaveBreakdown: [], pendingLeaveCount: 0, upcomingLeave: [] };
    }

    const yearStart = `${new Date().getFullYear()}-01-01`;
    const todayISO = isoDate(new Date());

    const [approvedThisYear, pendingLeaveCount, upcomingRaw] = await Promise.all([
      this.prisma.leaveRequest.findMany({ where: { organizationId, status: 'APPROVED', startDate: { gte: yearStart } } }),
      this.prisma.leaveRequest.count({ where: { organizationId, status: 'PENDING' } }),
      this.prisma.leaveRequest.findMany({
        where: { organizationId, status: 'APPROVED', startDate: { gte: todayISO } },
        orderBy: { startDate: 'asc' },
        take: 5,
      }),
    ]);

    const leaveBreakdown: LeaveBreakdownSlice[] = LEAVE_TYPES.map((type) => ({
      type,
      days: approvedThisYear.filter((r) => r.type === type).reduce((sum, r) => sum + r.days, 0),
    })).filter((slice) => slice.days > 0);

    const employeeIds = [...new Set(upcomingRaw.map((r) => r.employeeId))];
    const employees = employeeIds.length
      ? await this.prisma.employee.findMany({ where: { id: { in: employeeIds } } })
      : [];
    const employeeById = new Map(employees.map((e) => [e.id, e]));

    const upcomingLeave: UpcomingLeaveItem[] = upcomingRaw
      .filter((r) => employeeById.has(r.employeeId))
      .map((r) => {
        const employee = employeeById.get(r.employeeId)!;
        return {
          id: r.id,
          employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
          type: r.type as UpcomingLeaveItem['type'],
          startDate: r.startDate,
          endDate: r.endDate,
          days: r.days,
        };
      });

    return { leaveBreakdown, pendingLeaveCount, upcomingLeave };
  }

  private async buildStats(organizationId: string, permissions: string[]): Promise<DashboardStat[]> {
    const stats: DashboardStat[] = [];
    const now = new Date();
    const todayISO = isoDate(now);
    const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

    if (grants(permissions, 'employees.view', 'employees.manage')) {
      const all = await this.prisma.employee.findMany({ where: { organizationId }, select: { deletedAt: true, startDate: true } });
      const active = all.filter((e) => !e.deletedAt);
      const newThisMonth = active.filter((e) => isoDate(e.startDate) >= monthStart).length;
      stats.push({
        id: 'st-headcount',
        label: 'Employees',
        value: String(active.length),
        delta: newThisMonth > 0 ? `+${newThisMonth} this month` : null,
      });
    }

    if (grants(permissions, 'attendance.manage')) {
      const activeEmployees = await this.activeEmployees(organizationId);
      const activeIds = activeEmployees.map((e) => e.id);
      const todaysRecords = activeIds.length
        ? await this.prisma.attendanceRecord.findMany({
            where: { organizationId, employeeId: { in: activeIds }, date: todayISO, checkIn: { not: null } },
          })
        : [];
      const presentToday = todaysRecords.length;
      stats.push({
        id: 'st-present',
        label: 'Present today',
        value: String(presentToday),
        delta: activeEmployees.length === 0 ? null : `${Math.round((presentToday / activeEmployees.length) * 100)}%`,
      });
    }

    if (grants(permissions, 'leave.approve')) {
      const [onLeaveToday, pending] = await Promise.all([
        this.prisma.leaveRequest.findMany({
          where: { organizationId, status: 'APPROVED', startDate: { lte: todayISO }, endDate: { gte: todayISO } },
        }),
        this.prisma.leaveRequest.count({ where: { organizationId, status: 'PENDING' } }),
      ]);
      stats.push({
        id: 'st-leave',
        label: 'On leave',
        value: String(onLeaveToday.length),
        delta: pending > 0 ? `${pending} pending approval` : null,
      });
    }

    if (grants(permissions, 'payroll.view', 'payroll.manage')) {
      const monthKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
      const finalized = await this.prisma.payslip.findMany({ where: { organizationId, month: monthKey, status: 'FINALIZED' } });
      const gross = Math.round(finalized.reduce((sum, p) => sum + (p.snapshot?.grossEarnings ?? 0), 0));
      stats.push({
        id: 'st-payroll',
        label: `${now.toLocaleDateString('en-GB', { month: 'long' })} payroll`,
        value: new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(gross),
        delta: finalized.length > 0 ? 'Finalized' : 'Ready to review',
      });
    }

    if (grants(permissions, 'performance.manage')) {
      const activeEmployees = await this.activeEmployees(organizationId);
      const activeIds = activeEmployees.map((e) => e.id);
      const openCycle = await this.prisma.appraisalCycle.findFirst({ where: { organizationId, status: 'OPEN' } });
      const reviews = openCycle && activeIds.length
        ? await this.prisma.review.findMany({ where: { organizationId, cycleId: openCycle.id, employeeId: { in: activeIds } } })
        : [];
      const avg = reviews.length === 0 ? 0 : Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10;
      stats.push({
        id: 'st-performance',
        label: 'Average performance',
        value: reviews.length === 0 ? '—' : `${avg.toFixed(1)} / 5`,
        delta: activeIds.length > 0 ? `${reviews.length} of ${activeIds.length} reviewed` : null,
      });
    }

    return stats;
  }

  /**
   * Company-wide activity for anyone who manages the module; otherwise a
   * self-scoped fallback of the caller's own recent events, so an Employee
   * (who holds none of the `.manage`/`.approve` keys) still sees something
   * relevant to them — their own payslip, review, goal progress, leave
   * decision — instead of an empty feed.
   */
  private async buildActivity(organizationId: string, userId: string, permissions: string[]): Promise<ActivityItem[]> {
    const items: ActivityItem[] = [];
    const me = await this.myEmployee(userId, organizationId);

    if (grants(permissions, 'leave.approve')) {
      const pending = await this.prisma.leaveRequest.findFirst({
        where: { organizationId, status: 'PENDING' },
        orderBy: { requestedAt: 'desc' },
      });
      if (pending) {
        const employee = await this.prisma.employee.findUnique({ where: { id: pending.employeeId } });
        if (employee) {
          items.push({
            id: `act-leave-${pending.id}`,
            title: `${employee.firstName} ${employee.lastName} requested ${pending.days} day${pending.days === 1 ? '' : 's'} ${pending.type.toLowerCase()} leave`,
            meta: `${pending.startDate} to ${pending.endDate} · awaiting approval`,
            kind: 'leave',
            occurredAt: pending.requestedAt.toISOString(),
          });
        }
      }
    } else if (me) {
      const myLast = await this.prisma.leaveRequest.findFirst({
        where: { organizationId, employeeId: me.id, status: { in: ['APPROVED', 'REJECTED'] } },
        orderBy: { decidedAt: 'desc' },
      });
      if (myLast?.decidedAt) {
        items.push({
          id: `act-leave-${myLast.id}`,
          title: `Your ${myLast.type.toLowerCase()} leave request was ${myLast.status.toLowerCase()}`,
          meta: `${myLast.startDate} to ${myLast.endDate}`,
          kind: 'leave',
          occurredAt: myLast.decidedAt.toISOString(),
        });
      }
    }

    if (grants(permissions, 'payroll.view', 'payroll.manage')) {
      const lastFinalized = await this.prisma.payslip.findFirst({
        where: { organizationId, status: 'FINALIZED' },
        orderBy: { finalizedAt: 'desc' },
      });
      if (lastFinalized?.finalizedAt) {
        const employee = await this.prisma.employee.findUnique({ where: { id: lastFinalized.employeeId } });
        items.push({
          id: `act-payroll-${lastFinalized.id}`,
          title: `${lastFinalized.month} payslip finalized${employee ? ` for ${employee.firstName} ${employee.lastName}` : ''}`,
          meta: `Net ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(lastFinalized.snapshot?.netSalary ?? 0)}`,
          kind: 'payroll',
          occurredAt: lastFinalized.finalizedAt.toISOString(),
        });
      }
    } else if (me) {
      const myPayslip = await this.prisma.payslip.findFirst({
        where: { organizationId, employeeId: me.id, status: 'FINALIZED' },
        orderBy: { finalizedAt: 'desc' },
      });
      if (myPayslip?.finalizedAt) {
        items.push({
          id: `act-payroll-${myPayslip.id}`,
          title: `Your ${myPayslip.month} payslip was finalized`,
          meta: `Net ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(myPayslip.snapshot?.netSalary ?? 0)}`,
          kind: 'payroll',
          occurredAt: myPayslip.finalizedAt.toISOString(),
        });
      }
    }

    if (grants(permissions, 'employees.view', 'employees.manage')) {
      const activeSorted = (await this.activeEmployees(organizationId)).sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
      const lastHire = activeSorted[0] ?? null;
      if (lastHire) {
        items.push({
          id: `act-employee-${lastHire.id}`,
          title: `${lastHire.firstName} ${lastHire.lastName} joined the company`,
          meta: lastHire.department,
          kind: 'employee',
          occurredAt: lastHire.createdAt.toISOString(),
        });
      }
    }

    if (grants(permissions, 'performance.manage')) {
      const lastReview = await this.prisma.review.findFirst({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      });
      if (lastReview) {
        const [employee, reviewer, cycle] = await Promise.all([
          this.prisma.employee.findUnique({ where: { id: lastReview.employeeId } }),
          this.prisma.user.findUnique({ where: { id: lastReview.reviewerUserId }, select: { name: true } }),
          this.prisma.appraisalCycle.findUnique({ where: { id: lastReview.cycleId } }),
        ]);
        if (employee) {
          items.push({
            id: `act-performance-${lastReview.id}`,
            title: `${reviewer?.name ?? 'Someone'} reviewed ${employee.firstName} ${employee.lastName}`,
            meta: `${cycle?.name ?? 'this cycle'} · ${lastReview.rating}/5`,
            kind: 'performance',
            occurredAt: lastReview.createdAt.toISOString(),
          });
        }
      }
    } else if (me) {
      const [myReview, myGoal] = await Promise.all([
        this.prisma.review.findFirst({ where: { organizationId, employeeId: me.id }, orderBy: { createdAt: 'desc' } }),
        this.prisma.goal.findFirst({ where: { organizationId, employeeId: me.id }, orderBy: { updatedAt: 'desc' } }),
      ]);

      if (myReview) {
        const [reviewer, cycle] = await Promise.all([
          this.prisma.user.findUnique({ where: { id: myReview.reviewerUserId }, select: { name: true } }),
          this.prisma.appraisalCycle.findUnique({ where: { id: myReview.cycleId } }),
        ]);
        items.push({
          id: `act-performance-${myReview.id}`,
          title: `${reviewer?.name ?? 'Someone'} reviewed your performance`,
          meta: `${cycle?.name ?? 'this cycle'} · ${myReview.rating}/5`,
          kind: 'performance',
          occurredAt: myReview.createdAt.toISOString(),
        });
      }

      if (myGoal) {
        items.push({
          id: `act-goal-${myGoal.id}`,
          title: `Goal "${myGoal.title}" is ${myGoal.progress}% complete`,
          meta: `Due ${myGoal.dueOn}`,
          kind: 'performance',
          occurredAt: (myGoal.updatedAt ?? myGoal.createdAt).toISOString(),
        });
      }
    }

    return items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
}
