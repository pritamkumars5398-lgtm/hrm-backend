export type PublicSalaryStructure = {
  id: string;
  organizationId: string;
  employeeId: string;
  basic: number;
  hra: number;
  otherAllowance: number;
  /** Computed, never stored — Basic + HRA + Other Allowance. */
  gross: number;
  effectiveFrom: string;
  createdAt: string;
  createdByUserId: string;
};

export function grossOf(s: { basic: number; hra: number; otherAllowance: number }): number {
  return s.basic + s.hra + s.otherAllowance;
}

export function toPublicSalaryStructure(record: {
  id: string;
  organizationId: string;
  employeeId: string;
  basic: number;
  hra: number;
  otherAllowance: number;
  effectiveFrom: string;
  createdAt: Date;
  createdByUserId: string;
}): PublicSalaryStructure {
  return {
    id: record.id,
    organizationId: record.organizationId,
    employeeId: record.employeeId,
    basic: record.basic,
    hra: record.hra,
    otherAllowance: record.otherAllowance,
    gross: grossOf(record),
    effectiveFrom: record.effectiveFrom,
    createdAt: record.createdAt.toISOString().slice(0, 10),
    createdByUserId: record.createdByUserId,
  };
}

/**
 * Which structure applies to a given month (YYYY-MM) — the latest revision
 * whose effectiveFrom is on or before that month. Revisions dated after the
 * month don't apply yet; a month before any revision exists has none.
 */
export function structureForMonth<T extends { effectiveFrom: string }>(
  history: T[],
  month: string,
): T | null {
  const monthEnd = `${month}-31`;
  const candidates = history.filter((s) => s.effectiveFrom <= monthEnd);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, s) => (s.effectiveFrom > latest.effectiveFrom ? s : latest));
}
