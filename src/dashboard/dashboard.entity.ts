export type DashboardStat = {
  id: string;
  label: string;
  value: string;
  delta: string | null;
};

export type ActivityKind = 'leave' | 'payroll' | 'employee' | 'performance';

export type ActivityItem = {
  id: string;
  title: string;
  meta: string;
  kind: ActivityKind;
  /** ISO timestamp — the frontend derives its own "2h ago" from this rather
   *  than trusting a hardcoded id->label map (that's what the mock did). */
  occurredAt: string;
};

export type WeeklyAttendancePoint = {
  label: string;
  present: number;
  expected: number;
};

export type LeaveBreakdownSlice = {
  type: 'ANNUAL' | 'SICK' | 'PERSONAL' | 'UNPAID';
  days: number;
};

export type UpcomingLeaveItem = {
  id: string;
  employeeName: string;
  type: 'ANNUAL' | 'SICK' | 'PERSONAL' | 'UNPAID';
  startDate: string;
  endDate: string;
  days: number;
};

export type DashboardData = {
  /** Only the tiles the caller's permissions actually grant (§4.7) — never a
   *  placeholder for one they can't see. */
  stats: DashboardStat[];
  activity: ActivityItem[];
  /** Company-wide, gated on attendance.manage — empty otherwise. */
  weeklyAttendance: WeeklyAttendancePoint[];
  /** Company-wide, gated on leave.approve — empty otherwise. */
  leaveBreakdown: LeaveBreakdownSlice[];
  pendingLeaveCount: number;
  upcomingLeave: UpcomingLeaveItem[];
};
