import type { LeaveType } from '../leave/leave.entity';

export type AttendanceStatus = 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ABSENT' | 'LEAVE';

export type PublicAttendanceRecord = {
  id: string;
  organizationId: string;
  employeeId: string;
  employeeName: string;
  avatarInitials: string;
  department: string;
  managerName: string | null;
  /** YYYY-MM-DD */
  date: string;
  status: AttendanceStatus;
  /** HH:MM, or null if there is no record at all for this day. */
  clockIn: string | null;
  clockOut: string | null;
  hours: number;
};

export type DaySummary = {
  date: string;
  isWeekend: boolean;
  present: number;
  late: number;
  halfDay: number;
  absent: number;
  leave: number;
  rate: number | null;
};

export type PublicAttendanceMonth = {
  year: number;
  month: number;
  /** Whose records these are — 'me' when the caller lacks attendance.manage. */
  scope: 'company' | 'me';
  headcount: number;
  summary: {
    presentToday: number;
    lateToday: number;
    absentToday: number;
    leaveToday: number;
    avgHours: number;
  };
  days: DaySummary[];
  today: PublicAttendanceRecord[];
  todayDate: string;
  /**
   * The caller's own check-in state for the real current day — independent of
   * `todayDate`/`days`/`today` above, which follow whatever day is selected in
   * the calendar. Null only if the caller has no Employee record in this org.
   */
  myTodayStatus: {
    checkedIn: boolean;
    checkedOut: boolean;
    checkInTime: string | null;
    checkOutTime: string | null;
    /** Set when today falls inside one of the caller's own APPROVED leave requests. */
    onLeave: { type: LeaveType } | null;
  } | null;
};

// A day's cutoff for "late" and the minimum worked hours to not count as a
// half day. Fixed defaults — no per-company WorkSchedule model yet (deliberately
// out of scope for this pass; revisit if a real client ever needs it configurable).
const LATE_CUTOFF_MINUTES = 9 * 60 + 30; // 09:30
const HALF_DAY_HOURS_THRESHOLD = 5;

export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Derives status + worked hours from raw check-in/out timestamps. Never stored — always computed. */
export function deriveStatus(checkIn: Date, checkOut: Date | null): { status: AttendanceStatus; hours: number } {
  const minutesOfDay = checkIn.getHours() * 60 + checkIn.getMinutes();
  const late = minutesOfDay > LATE_CUTOFF_MINUTES;
  const hours = checkOut ? Math.round(((checkOut.getTime() - checkIn.getTime()) / 3600000) * 10) / 10 : 0;

  if (checkOut && hours < HALF_DAY_HOURS_THRESHOLD) {
    return { status: 'HALF_DAY', hours };
  }
  return { status: late ? 'LATE' : 'PRESENT', hours };
}

export function toPublicRecord(
  record: { id: string; organizationId: string; employeeId: string; date: string; checkIn: Date | null; checkOut: Date | null },
  employee: { firstName: string; lastName: string; department: string },
  managerName: string | null,
  /** Approved leave covering this exact day, if any — takes priority over "no check-in = absent". */
  onLeave?: boolean,
): PublicAttendanceRecord {
  const name = `${employee.firstName} ${employee.lastName}`.trim();
  const initials = ((employee.firstName[0] ?? '') + (employee.lastName[0] ?? '')).toUpperCase() || '?';

  if (!record.checkIn) {
    return {
      id: record.id,
      organizationId: record.organizationId,
      employeeId: record.employeeId,
      employeeName: name,
      avatarInitials: initials,
      department: employee.department,
      managerName,
      date: record.date,
      status: onLeave ? 'LEAVE' : 'ABSENT',
      clockIn: null,
      clockOut: null,
      hours: 0,
    };
  }

  const { status, hours } = deriveStatus(record.checkIn, record.checkOut);

  return {
    id: record.id,
    organizationId: record.organizationId,
    employeeId: record.employeeId,
    employeeName: name,
    avatarInitials: initials,
    department: employee.department,
    managerName,
    date: record.date,
    status,
    clockIn: hhmm(record.checkIn),
    clockOut: record.checkOut ? hhmm(record.checkOut) : null,
    hours,
  };
}
