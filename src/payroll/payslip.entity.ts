import { deriveStatus } from '../attendance/attendance.entity';

export type PayslipStatus = 'DRAFT' | 'FINALIZED';

export type PublicPayslip = {
  /** Null when nobody has saved anything for this employee/month yet — a "virtual" draft. */
  id: string | null;
  organizationId: string;
  employeeId: string;
  /** The human-readable Employee ID business field (e.g. "EMP-045") — not always set. */
  employeeCode: string | null;
  employeeName: string;
  avatarInitials: string;
  department: string;
  designation: string;
  month: string;
  status: PayslipStatus;
  /** False when there's no Salary Structure to run payroll against yet — finalize is blocked. */
  hasSalaryStructure: boolean;
  basic: number;
  hra: number;
  otherAllowance: number;
  daysInMonth: number;
  /** ABSENT + UNPAID-leave days count 1, HALF_DAY counts 0.5. Weekends never count. */
  unpaidDays: number;
  bonus: number;
  incentive: number;
  reimbursement: number;
  otherEarnings: number;
  incomeTax: number;
  otherDeduction: number;
  lopDeduction: number;
  grossEarnings: number;
  totalDeductions: number;
  netSalary: number;
  notes: string | null;
  finalizedAt: string | null;
  finalizedBy: string | null;
};

const pad = (n: number) => String(n).padStart(2, '0');
// Local-date formatting, deliberately not toISOString() — that converts to UTC
// first, which shifts the calendar day on any server not running in UTC+0.
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

export function daysInMonth(month: string): number {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return new Date(year, mon, 0).getDate();
}

/**
 * Which weekdays in this month count against pay: no check-in and no approved
 * paid leave = ABSENT (1 day), approved UNPAID leave (1 day), HALF_DAY worked
 * (0.5 day). Never synthesizes a verdict for today or the future — mirrors
 * Attendance's own rule, since a month can be previewed before it's over.
 */
export function computeUnpaidDays(params: {
  month: string;
  startDate: Date;
  today: Date;
  attendanceByDate: Map<string, { checkIn: Date | null; checkOut: Date | null }>;
  /** date -> leave request details, approved leave only. */
  leaveByDate: Map<string, { type: string; isHalfDay: boolean }>;
  halfDayThreshold?: number | null;
  holidays?: string[];
}): number {
  const { month, startDate, today, attendanceByDate, leaveByDate, halfDayThreshold, holidays = [] } = params;
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const total = daysInMonth(month);
  const todayISO = isoDate(today);
  const joinedISO = isoDate(startDate);

  let unpaid = 0;

  for (let day = 1; day <= total; day++) {
    const date = new Date(year, mon - 1, day);
    const iso = isoDate(date);

    if (isWeekend(date)) continue;
    if (iso < joinedISO) continue; // not yet joined
    if (iso >= todayISO) continue; // not yet resolved
    if (holidays.includes(iso)) continue; // public holiday is a paid day off

    const record = attendanceByDate.get(iso);
    const leave = leaveByDate.get(iso);

    if (record?.checkIn) {
      const { status } = deriveStatus(record.checkIn, record.checkOut, null, halfDayThreshold, leave?.isHalfDay);
      if (status === 'HALF_DAY') {
        unpaid += 0.5;
      }
      if (leave?.isHalfDay && leave.type === 'UNPAID') {
        unpaid += 0.5;
      }
      continue;
    }

    if (leave) {
      if (leave.isHalfDay) {
        unpaid += 0.5; // absent portion of half-day leave
        if (leave.type === 'UNPAID') {
          unpaid += 0.5; // unpaid leave portion of half-day leave
        }
      } else {
        if (leave.type === 'UNPAID') {
          unpaid += 1.0;
        }
      }
      continue;
    }

    unpaid += 1.0; // no check-in, no approved leave -> absent
  }

  return unpaid;
}

export function computeAmounts(params: {
  basic: number;
  hra: number;
  otherAllowance: number;
  daysInMonth: number;
  unpaidDays: number;
  bonus: number;
  incentive: number;
  reimbursement: number;
  otherEarnings: number;
  incomeTax: number;
  otherDeduction: number;
}): { lopDeduction: number; grossEarnings: number; totalDeductions: number; netSalary: number } {
  const structureGross = params.basic + params.hra + params.otherAllowance;
  const dailyRate = params.daysInMonth > 0 ? structureGross / params.daysInMonth : 0;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const lopDeduction = round2(dailyRate * params.unpaidDays);
  const grossEarnings = round2(structureGross + params.bonus + params.incentive + params.reimbursement + params.otherEarnings);
  const totalDeductions = round2(params.incomeTax + params.otherDeduction + lopDeduction);
  const netSalary = round2(grossEarnings - totalDeductions);

  return { lopDeduction, grossEarnings, totalDeductions, netSalary };
}
