export type PayCycleType = 'FIXED' | 'RANGE';

export type PublicPayCycle = {
  /** Null means nobody has set this up yet. */
  type: PayCycleType | null;
  fixedDay: number | null;
  rangeStart: number | null;
  rangeEnd: number | null;
};

export function toPublicPayCycle(org: {
  payCycleType: string | null;
  payCycleFixedDay: number | null;
  payCycleRangeStart: number | null;
  payCycleRangeEnd: number | null;
}): PublicPayCycle {
  return {
    type: (org.payCycleType as PayCycleType | null) ?? null,
    fixedDay: org.payCycleFixedDay,
    rangeStart: org.payCycleRangeStart,
    rangeEnd: org.payCycleRangeEnd,
  };
}
