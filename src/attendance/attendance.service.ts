import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { hhmm, toPublicRecord, type DaySummary, type PublicAttendanceMonth } from './attendance.entity';
import type { LeaveType } from '../leave/leave.entity';

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** Does this permission set grant company-wide attendance? Mirrors PermissionsGuard's matching. */
function canManage(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('attendance.manage') || permissions.includes('attendance.*');
}

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolves the caller's own Employee record in this org, or null if they have none. */
  private async myEmployee(userId: string, organizationId: string) {
    const employees = await this.prisma.employee.findMany({
      where: { userId, organizationId },
    });
    return employees.find((e) => !e.deletedAt) ?? null;
  }

  async checkIn(userId: string, organizationId: string): Promise<void> {
    const employee = await this.myEmployee(userId, organizationId);
    if (!employee) {
      throw new NotFoundException('No employee record found for you in this company — ask your Owner or HR to add one.');
    }

    const today = isoDate(new Date());
    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
    });

    if (existing?.checkIn) {
      throw new ConflictException('You have already checked in today.');
    }

    if (existing) {
      await this.prisma.attendanceRecord.update({ where: { id: existing.id }, data: { checkIn: new Date() } });
    } else {
      await this.prisma.attendanceRecord.create({
        data: {
          id: `att-${randomUUID().slice(0, 8)}`,
          organizationId,
          employeeId: employee.id,
          date: today,
          checkIn: new Date(),
        },
      });
    }
  }

  async checkOut(userId: string, organizationId: string): Promise<void> {
    const employee = await this.myEmployee(userId, organizationId);
    if (!employee) {
      throw new NotFoundException('No employee record found for you in this company — ask your Owner or HR to add one.');
    }

    const today = isoDate(new Date());
    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
    });

    if (!existing?.checkIn) {
      throw new BadRequestException('You have not checked in yet today.');
    }
    if (existing.checkOut) {
      throw new BadRequestException('You have already checked out today.');
    }

    await this.prisma.attendanceRecord.update({ where: { id: existing.id }, data: { checkOut: new Date() } });
  }

  /**
   * Scope is decided here, server-side, from the caller's real permissions —
   * never trusted from the request. Holding attendance.manage sees the whole
   * company; anyone else sees only themselves.
   */
  async getMonth(params: {
    userId: string;
    organizationId: string;
    permissions: string[];
    year: number;
    month: number; // 0-indexed, matching JS Date
    selectedDate?: string;
  }): Promise<PublicAttendanceMonth> {
    const { organizationId, year, month } = params;
    const manage = canManage(params.permissions);

    const allEmployees = await this.prisma.employee.findMany({
      where: { organizationId },
    });
    let employees = allEmployees.filter((e) => !e.deletedAt);

    if (!manage) {
      employees = employees.filter((e) => e.userId === params.userId);
    }

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthStart = `${year}-${pad(month + 1)}-01`;
    const monthEnd = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`;

    const employeeIds = employees.map((e) => e.id);
    const rawRecords = employeeIds.length
      ? await this.prisma.attendanceRecord.findMany({
          where: { organizationId, employeeId: { in: employeeIds }, date: { gte: monthStart, lte: monthEnd } },
        })
      : [];

    const recordByKey = new Map(rawRecords.map((r) => [`${r.employeeId}:${r.date}`, r]));

    // Approved leave overlapping this month, expanded to a per-day lookup —
    // a day covered by approved leave is neither "present" nor "absent".
    const approvedLeave = employeeIds.length
      ? await this.prisma.leaveRequest.findMany({
          where: { organizationId, employeeId: { in: employeeIds }, status: 'APPROVED', startDate: { lte: monthEnd }, endDate: { gte: monthStart } },
        })
      : [];
    const leaveByKey = new Map<string, string>();
    for (const req of approvedLeave) {
      for (let d = new Date(`${req.startDate}T00:00:00`); isoDate(d) <= req.endDate; d.setDate(d.getDate() + 1)) {
        const iso = isoDate(d);
        if (iso >= monthStart && iso <= monthEnd) leaveByKey.set(`${req.employeeId}:${iso}`, req.type);
      }
    }

    // The caller's own status for the REAL current day — independent of which
    // month/day the calendar is browsing. `employees` may already be filtered
    // to just the caller (scope 'me'); resolve fresh so this is correct in the
    // 'company' scope too (an Owner who is also an Employee can check in).
    const myEmployeeRecord =
      employees.find((e) => e.userId === params.userId) ??
      (await this.myEmployee(params.userId, organizationId));
    let myTodayStatus: PublicAttendanceMonth['myTodayStatus'] = null;
    if (myEmployeeRecord) {
      const todayISO = isoDate(new Date());
      const myRecord =
        recordByKey.get(`${myEmployeeRecord.id}:${todayISO}`) ??
        (await this.prisma.attendanceRecord.findUnique({
          where: { employeeId_date: { employeeId: myEmployeeRecord.id, date: todayISO } },
        }));

      // Independent of `leaveByKey` above, which is scoped to the queried
      // month — today's own leave status must hold regardless of which month
      // the calendar is currently browsing.
      const myLeaveToday = await this.prisma.leaveRequest.findFirst({
        where: {
          organizationId,
          employeeId: myEmployeeRecord.id,
          status: 'APPROVED',
          startDate: { lte: todayISO },
          endDate: { gte: todayISO },
        },
      });

      myTodayStatus = {
        checkedIn: Boolean(myRecord?.checkIn),
        checkedOut: Boolean(myRecord?.checkOut),
        checkInTime: myRecord?.checkIn ? hhmm(myRecord.checkIn) : null,
        checkOutTime: myRecord?.checkOut ? hhmm(myRecord.checkOut) : null,
        onLeave: myLeaveToday ? { type: myLeaveToday.type as LeaveType } : null,
      };
    }

    const todayISO = isoDate(new Date());
    const byDate = new Map<string, ReturnType<typeof toPublicRecord>[]>();

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const iso = `${year}-${pad(month + 1)}-${pad(day)}`;
      if (isWeekend(date)) continue; // weekends carry no rows at all — a deliberate simplification.
      // Never synthesize a verdict for today or the future — "no record yet" is not the same as absent.
      if (iso >= todayISO) continue;

      for (const employee of employees) {
        // Not yet joined on this date — nothing to record.
        if (isoDate(employee.startDate) > iso) continue;

        const raw = recordByKey.get(`${employee.id}:${iso}`);
        const record = toPublicRecord(
          raw ?? { id: `absent-${employee.id}-${iso}`, organizationId, employeeId: employee.id, date: iso, checkIn: null, checkOut: null },
          employee,
          null,
          leaveByKey.has(`${employee.id}:${iso}`),
        );

        const bucket = byDate.get(iso) ?? [];
        bucket.push(record);
        byDate.set(iso, bucket);
      }
    }

    // Today's own row(s) — shown even though the loop above stops before today,
    // since today is never synthesized as absent. Included if either a real
    // check-in exists, or today falls inside approved leave (so "who's in
    // today" correctly shows leave, not silence).
    for (const employee of employees) {
      const raw = recordByKey.get(`${employee.id}:${todayISO}`);
      const onLeaveToday = leaveByKey.has(`${employee.id}:${todayISO}`);
      if (raw?.checkIn || onLeaveToday) {
        const bucket = byDate.get(todayISO) ?? [];
        bucket.push(
          toPublicRecord(
            raw ?? { id: `leave-${employee.id}-${todayISO}`, organizationId, employeeId: employee.id, date: todayISO, checkIn: null, checkOut: null },
            employee,
            null,
            onLeaveToday,
          ),
        );
        byDate.set(todayISO, bucket);
      }
    }

    const days: DaySummary[] = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rows]) => {
        const present = rows.filter((r) => r.status === 'PRESENT').length;
        const late = rows.filter((r) => r.status === 'LATE').length;
        const halfDay = rows.filter((r) => r.status === 'HALF_DAY').length;
        const absent = rows.filter((r) => r.status === 'ABSENT').length;
        const leave = rows.filter((r) => r.status === 'LEAVE').length;
        // Approved leave is excluded from the rate entirely — it isn't a failure
        // to attend, so it shouldn't drag the heat-map down.
        const expected = rows.length - leave;
        const attended = present + late + halfDay;

        return {
          date,
          isWeekend: false,
          present,
          late,
          halfDay,
          absent,
          leave,
          rate: expected === 0 ? null : attended / expected,
        };
      });

    const workingDays = days;
    const fallback = workingDays.at(-1)?.date ?? todayISO;
    const selectedDate =
      params.selectedDate ?? (byDate.has(todayISO) || days.some((d) => d.date === todayISO) ? todayISO : fallback);

    const today = (byDate.get(selectedDate) ?? []).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    const workedToday = today.filter((r) => r.hours > 0);
    const avgHours =
      workedToday.length === 0
        ? 0
        : Math.round((workedToday.reduce((sum, r) => sum + r.hours, 0) / workedToday.length) * 10) / 10;

    return {
      year,
      month,
      scope: manage ? 'company' : 'me',
      headcount: employees.length,
      summary: {
        presentToday: today.filter((r) => r.status === 'PRESENT').length,
        lateToday: today.filter((r) => r.status === 'LATE').length,
        absentToday: today.filter((r) => r.status === 'ABSENT').length,
        avgHours,
      },
      days,
      today,
      todayDate: selectedDate,
      myTodayStatus,
    };
  }
}
