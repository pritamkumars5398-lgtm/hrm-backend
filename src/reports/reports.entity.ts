export type DepartmentRow = {
  department: string;
  headcount: number;
  attendanceRate: number;
  leaveDaysTaken: number;
  share: number;
};

export type ReportsData = {
  headcount: number;
  activeCount: number;
  attritionRate: number;
  avgAttendance: number;
  leaveDaysTaken: number;
  /** Null unless the caller holds `payroll.view`/`payroll.manage`/`*` — never
   *  just `reports.view` (§ Phase 3 §4.6's compound check). */
  payrollCost: number | null;
  departments: DepartmentRow[];
  headcountByMonth: Array<{ label: string; value: number }>;
};

/** Minimal RFC 4180-ish CSV escaping — wraps a field in quotes if it contains
 *  a comma, quote or newline, doubling any embedded quotes. */
function csvField(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(data: ReportsData): string {
  const lines: string[] = [];

  lines.push('Summary');
  lines.push('Metric,Value');
  lines.push(`${csvField('Headcount (active)')},${data.activeCount}`);
  lines.push(`${csvField('Headcount (on record)')},${data.headcount}`);
  lines.push(`${csvField('Attrition rate %')},${data.attritionRate}`);
  lines.push(`${csvField('Attendance rate % (this month)')},${data.avgAttendance}`);
  lines.push(`${csvField('Leave days taken (approved)')},${data.leaveDaysTaken}`);
  if (data.payrollCost !== null) {
    lines.push(`${csvField('Payroll cost (gross, this month)')},${data.payrollCost}`);
  }

  lines.push('');
  lines.push('Department,Headcount,Share %,Attendance %,Leave Days');
  for (const row of data.departments) {
    lines.push(
      [
        csvField(row.department),
        row.headcount,
        row.share,
        row.attendanceRate,
        row.leaveDaysTaken,
      ].join(','),
    );
  }

  return lines.join('\n');
}
