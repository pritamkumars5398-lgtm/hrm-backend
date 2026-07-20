export type PublicGoal = {
  id: string;
  title: string;
  progress: number;
  dueOn: string;
};

export type PublicReview = {
  id: string;
  cycle: string;
  rating: number;
  reviewer: string;
  summary: string;
  reviewedOn: string;
};

export type PublicPerformanceRecord = {
  id: string;
  organizationId: string;
  employeeId: string;
  employeeName: string;
  avatarInitials: string;
  department: string;
  designation: string;
  managerName: string | null;
  /** 1–5. Null when the current cycle has not been reviewed yet. */
  rating: number | null;
  previousRating: number | null;
  goals: PublicGoal[];
  reviews: PublicReview[];
  /** Can the caller review this specific person / add goals for them? */
  canReview: boolean;
};

export type PublicPerformanceData = {
  scope: 'company' | 'team' | 'me';
  cycle: string;
  records: PublicPerformanceRecord[];
  summary: {
    reviewed: number;
    pending: number;
    avgRating: number;
    avgGoalProgress: number;
  };
  distribution: Array<{ rating: number; count: number }>;
};

/** Quarter name for a given date — "Q3 2026". Also drives cycle boundaries. */
export function quarterFor(date: Date): { name: string; startDate: string; endDate: string } {
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  const startMonth = (quarter - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 0));
  return {
    name: `Q${quarter} ${year}`,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}
