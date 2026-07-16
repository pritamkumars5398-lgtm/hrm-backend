export type LeaveType = 'ANNUAL' | 'SICK' | 'PERSONAL' | 'UNPAID';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export const LEAVE_TYPES: LeaveType[] = ['ANNUAL', 'SICK', 'PERSONAL', 'UNPAID'];

/** Fallback used until a company sets its own policy (§ leave policy). Unpaid
 *  has no cap — it is never shown as configurable. */
export const LEAVE_ENTITLEMENT: Record<LeaveType, number> = {
  ANNUAL: 25,
  SICK: 10,
  PERSONAL: 5,
  UNPAID: 0,
};

/** Resolves the effective entitlement for a company: its own configured values
 *  where set, the default otherwise. */
export function resolveEntitlement(org: {
  leaveAnnualDays: number | null;
  leaveSickDays: number | null;
  leavePersonalDays: number | null;
}): Record<LeaveType, number> {
  return {
    ANNUAL: org.leaveAnnualDays ?? LEAVE_ENTITLEMENT.ANNUAL,
    SICK: org.leaveSickDays ?? LEAVE_ENTITLEMENT.SICK,
    PERSONAL: org.leavePersonalDays ?? LEAVE_ENTITLEMENT.PERSONAL,
    UNPAID: LEAVE_ENTITLEMENT.UNPAID,
  };
}

export type PublicLeavePolicy = {
  annual: number;
  sick: number;
  personal: number;
};

export type PublicLeaveBalance = {
  type: LeaveType;
  total: number;
  used: number;
};

export type PublicLeaveRequest = {
  id: string;
  organizationId: string;
  employeeId: string;
  employeeName: string;
  avatarInitials: string;
  department: string;
  managerName: string | null;
  type: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
};

export type PublicLeaveData = {
  balances: PublicLeaveBalance[];
  requests: PublicLeaveRequest[];
  pendingApprovals: PublicLeaveRequest[];
  scope: 'company' | 'me';
  upcoming: PublicLeaveRequest[];
  /** The company's current entitlement — read-only for everyone, editable via
   *  `PATCH /leave/policy` by whoever holds leave.approve. */
  policy: PublicLeavePolicy;
  /**
   * False when the caller has no Employee HR record in this company — e.g. a
   * Team-Members-only invite (§0.1). `apply()` would 404 for them; surface this
   * upfront so the UI can say so before they fill out a whole form.
   */
  hasEmployeeRecord: boolean;
};

/** Whole days between two ISO dates, inclusive. */
export function daysBetween(start: string, end: string): number {
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  const diff = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
  return diff + 1;
}

export function toPublicRequest(
  record: {
    id: string;
    organizationId: string;
    employeeId: string;
    type: string;
    startDate: string;
    endDate: string;
    days: number;
    reason: string;
    status: string;
    requestedAt: Date;
    decidedByUserId: string | null;
    decidedAt: Date | null;
  },
  employee: { firstName: string; lastName: string; department: string },
  decidedByName: string | null,
): PublicLeaveRequest {
  const name = `${employee.firstName} ${employee.lastName}`.trim();
  const initials = ((employee.firstName[0] ?? '') + (employee.lastName[0] ?? '')).toUpperCase() || '?';

  return {
    id: record.id,
    organizationId: record.organizationId,
    employeeId: record.employeeId,
    employeeName: name,
    avatarInitials: initials,
    department: employee.department,
    managerName: null,
    type: record.type as LeaveType,
    startDate: record.startDate,
    endDate: record.endDate,
    days: record.days,
    reason: record.reason,
    status: record.status as LeaveStatus,
    requestedAt: record.requestedAt.toISOString().slice(0, 10),
    decidedBy: decidedByName,
    decidedAt: record.decidedAt ? record.decidedAt.toISOString().slice(0, 10) : null,
  };
}
