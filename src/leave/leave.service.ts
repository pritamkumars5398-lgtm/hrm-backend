import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { writeAuditLog } from '../common/audit-log';
import type { ApplyLeaveDto } from './dto/apply-leave.dto';
import type { UpdateLeavePolicyDto } from './dto/update-leave-policy.dto';
import {
  LEAVE_TYPES,
  daysBetween,
  resolveEntitlement,
  toPublicRequest,
  type LeaveType,
  type PublicLeaveBalance,
  type PublicLeaveData,
  type PublicLeavePolicy,
  type PublicLeaveRequest,
} from './leave.entity';

export function calculateWorkingDays(
  startDateStr: string,
  endDateStr: string,
  holidays: string[] = [],
): number {
  let count = 0;
  const start = new Date(`${startDateStr}T00:00:00`);
  const end = new Date(`${endDateStr}T00:00:00`);
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
    
    const pad = (n: number) => String(n).padStart(2, '0');
    const isoDateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const isHoliday = holidays.includes(isoDateStr);
    
    if (!isWeekend && !isHoliday) {
      count++;
    }
  }
  return count;
}

/** Does this permission set grant company-wide leave approval? Mirrors PermissionsGuard's matching. */
function canApprove(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('leave.approve') || permissions.includes('leave.*');
}

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly approvals: ApprovalsService,
  ) {}

  /**
   * `deletedAt: null` in the Mongo `where` clause does NOT match documents where
   * the field was never written at all (vs. explicitly set to null) — a real bug
   * found and fixed once already for Employees' own listing. Filter in code
   * instead, everywhere this service reads employees.
   */
  private async myEmployee(userId: string, organizationId: string) {
    const employees = await this.prisma.employee.findMany({ where: { userId, organizationId } });
    return employees.find((e) => !e.deletedAt) ?? null;
  }

  /** The org's configured entitlement, falling back to defaults if unset or the org is somehow missing. */
  private async entitlementFor(organizationId: string): Promise<Record<LeaveType, number>> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { leaveAnnualDays: true, leaveSickDays: true, leavePersonalDays: true },
    });
    return resolveEntitlement(org ?? { leaveAnnualDays: null, leaveSickDays: null, leavePersonalDays: null });
  }

  async get(params: { userId: string; organizationId: string; permissions: string[] }): Promise<PublicLeaveData> {
    const { organizationId } = params;
    const manage = canApprove(params.permissions);
    const entitlement = await this.entitlementFor(organizationId);

    const rawEmployees = await this.prisma.employee.findMany({ where: { organizationId } });
    const allEmployees = rawEmployees.filter((e) => !e.deletedAt);
    const myEmployeeRecord = allEmployees.find((e) => e.userId === params.userId) ?? null;

    const visibleEmployees = manage ? allEmployees : allEmployees.filter((e) => e.userId === params.userId);
    const employeeById = new Map(allEmployees.map((e) => [e.id, e]));

    const rawRequests = visibleEmployees.length
      ? await this.prisma.leaveRequest.findMany({
          where: { organizationId, employeeId: { in: visibleEmployees.map((e) => e.id) } },
          orderBy: { requestedAt: 'desc' },
        })
      : [];

    // Resolve decider names (a decidedByUserId is a User id, not an Employee id —
    // the approver may have no Employee record of their own, e.g. an Owner).
    const deciderIds = [...new Set(rawRequests.map((r) => r.decidedByUserId).filter((id): id is string => !!id))];
    const deciders = deciderIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: deciderIds } }, select: { id: true, name: true } })
      : [];
    const deciderNameById = new Map(deciders.map((d) => [d.id, d.name]));

    const requests: PublicLeaveRequest[] = rawRequests
      .filter((r) => employeeById.has(r.employeeId))
      .map((r) =>
        toPublicRequest(r, employeeById.get(r.employeeId)!, r.decidedByUserId ? (deciderNameById.get(r.decidedByUserId) ?? null) : null),
      );

    const balances: PublicLeaveBalance[] = myEmployeeRecord
      ? this.balancesFrom(rawRequests.filter((r) => r.employeeId === myEmployeeRecord.id), entitlement)
      : LEAVE_TYPES.map((type) => ({ type, total: entitlement[type], used: 0 }));

    // Nobody — not even the Owner — may approve their own request. Enforced here
    // (and again in `decide`), not just hidden in the UI.
    const pendingApprovals = manage
      ? requests.filter((r) => r.status === 'PENDING' && r.employeeId !== myEmployeeRecord?.id)
      : [];

    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const upcoming = requests
      .filter((r) => r.status === 'APPROVED' && r.endDate >= today && r.startDate <= horizon)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    return {
      balances,
      requests,
      pendingApprovals,
      scope: manage ? 'company' : 'me',
      upcoming,
      hasEmployeeRecord: myEmployeeRecord !== null,
      policy: { annual: entitlement.ANNUAL, sick: entitlement.SICK, personal: entitlement.PERSONAL },
    };
  }

  /** Pure — derives balances from already-fetched requests + a resolved entitlement. */
  private balancesFrom(
    employeeRequests: Array<{ type: string; status: string; days: number }>,
    entitlement: Record<LeaveType, number>,
  ): PublicLeaveBalance[] {
    const approved = employeeRequests.filter((r) => r.status === 'APPROVED');
    const pending = employeeRequests.filter((r) => r.status === 'PENDING');
    return LEAVE_TYPES.map((type) => {
      const used = approved.filter((r) => r.type === type).reduce((sum, r) => sum + r.days, 0);
      const pendingDays = pending.filter((r) => r.type === type).reduce((sum, r) => sum + r.days, 0);
      return { type, total: entitlement[type], used, pending: pendingDays };
    });
  }

  private async balancesFor(employeeId: string, organizationId: string): Promise<PublicLeaveBalance[]> {
    const [requests, entitlement] = await Promise.all([
      this.prisma.leaveRequest.findMany({ where: { organizationId, employeeId, status: { in: ['APPROVED', 'PENDING'] } } }),
      this.entitlementFor(organizationId),
    ]);
    return this.balancesFrom(requests, entitlement);
  }

  async updatePolicy(
    userId: string,
    organizationId: string,
    permissions: string[],
    patch: UpdateLeavePolicyDto,
  ): Promise<PublicLeavePolicy> {
    if (!canApprove(permissions)) {
      throw new ForbiddenException('You do not have permission to change the leave policy.');
    }

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(patch.annual !== undefined ? { leaveAnnualDays: patch.annual } : {}),
        ...(patch.sick !== undefined ? { leaveSickDays: patch.sick } : {}),
        ...(patch.personal !== undefined ? { leavePersonalDays: patch.personal } : {}),
      },
      select: { leaveAnnualDays: true, leaveSickDays: true, leavePersonalDays: true },
    });

    // Write audit log
    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'UPDATE_POLICY',
      resource: 'Organization',
      resourceId: organizationId,
      result: 'ALLOW',
      details: patch,
    });

    const entitlement = resolveEntitlement(updated);
    return { annual: entitlement.ANNUAL, sick: entitlement.SICK, personal: entitlement.PERSONAL };
  }

  async apply(userId: string, organizationId: string, dto: ApplyLeaveDto): Promise<PublicLeaveRequest> {
    const me = await this.myEmployee(userId, organizationId);
    if (!me) {
      throw new NotFoundException('No employee record found for you in this company — ask your Owner or HR to add one.');
    }

    if (dto.endDate < dto.startDate) {
      throw new BadRequestException('The end date cannot be before the start date.');
    }

    let days: number;
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { attendanceHolidays: true },
    });
    const holidays = org?.attendanceHolidays || [];

    if (dto.isHalfDay) {
      if (dto.startDate !== dto.endDate) {
        throw new BadRequestException('A half-day leave request must start and end on the same day.');
      }
      // Check if start/end date falls on a weekend or holiday
      const d = new Date(`${dto.startDate}T00:00:00`);
      const dayOfWeek = d.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      if (isWeekend || holidays.includes(dto.startDate)) {
        throw new BadRequestException('You cannot request half-day leave on a weekend or holiday.');
      }
      days = 0.5;
    } else {
      days = calculateWorkingDays(dto.startDate, dto.endDate, holidays);
      if (days === 0) {
        throw new BadRequestException('The requested date range contains only non-working days (weekends/holidays).');
      }
    }

    if (dto.type !== 'UNPAID') {
      const [balance] = (await this.balancesFor(me.id, organizationId)).filter((b) => b.type === dto.type);
      const remaining = balance.total - balance.used;
      if (days > remaining) {
        throw new BadRequestException(`You only have ${remaining} ${remaining === 1 ? 'day' : 'days'} of that leave left.`);
      }
    }

    // Overlap validation permitting parallel half-days
    const existingRequests = await this.prisma.leaveRequest.findMany({
      where: {
        organizationId,
        employeeId: me.id,
        status: { notIn: ['REJECTED', 'CANCELLED'] },
        startDate: { lte: dto.endDate },
        endDate: { gte: dto.startDate },
      },
    });

    for (const ext of existingRequests) {
      if (!dto.isHalfDay || !ext.isHalfDay) {
        throw new ConflictException('You already have leave booked that overlaps those dates.');
      }
      if (dto.startDate === ext.startDate && dto.halfDayPeriod === ext.halfDayPeriod) {
        throw new ConflictException('You already have a half-day leave request booked for this period on this date.');
      }
    }

    const created = await this.prisma.leaveRequest.create({
      data: {
        id: `lv-${randomUUID().slice(0, 8)}`,
        organizationId,
        employeeId: me.id,
        type: dto.type,
        startDate: dto.startDate,
        endDate: dto.endDate,
        days,
        isHalfDay: dto.isHalfDay || false,
        halfDayPeriod: dto.halfDayPeriod || null,
        reason: dto.reason.trim(),
        status: 'PENDING',
      },
    });

    // Write audit log
    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'CREATE',
      resource: 'LeaveRequest',
      resourceId: created.id,
      result: 'ALLOW',
      details: { type: dto.type, startDate: dto.startDate, endDate: dto.endDate, days, isHalfDay: dto.isHalfDay },
    });

    await this.approvals.createApproval(
      organizationId,
      me.id,
      'Leave',
      created.id,
      `${dto.type} Leave Request - ${me.firstName} ${me.lastName}`,
      `Requested ${days} days from ${dto.startDate} to ${dto.endDate}. Reason: ${dto.reason.trim()}`
    );

    const approverIds = await this.approverUserIds(organizationId, userId);
    if (approverIds.length) {
      await this.notifications.createForMany(approverIds, {
        organizationId,
        title: 'New leave request awaiting your approval',
        body: `${me.firstName} ${me.lastName} requested ${days} day${days === 1 ? '' : 's'} ${dto.type.toLowerCase()} leave.`,
        kind: 'leave',
        link: '/dashboard/leave',
      });
    }

    return toPublicRequest(created, me, null);
  }

  /** Every member (other than the requester) whose permissions grant leave.approve. */
  private async approverUserIds(organizationId: string, excludeUserId: string): Promise<string[]> {
    const memberships = await this.prisma.membership.findMany({ where: { organizationId } });
    return memberships
      .filter((m) => m.userId !== excludeUserId && canApprove(m.permissions))
      .map((m) => m.userId);
  }

  async decide(
    userId: string,
    organizationId: string,
    permissions: string[],
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    skipPermissionCheck = false,
  ): Promise<PublicLeaveRequest> {
    if (!skipPermissionCheck && !canApprove(permissions)) {
      throw new ForbiddenException('You do not have permission to decide on leave requests.');
    }

    const request = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!request || request.organizationId !== organizationId) {
      throw new NotFoundException('That request no longer exists.');
    }
    if (request.status !== 'PENDING') {
      throw new BadRequestException('That request has already been decided.');
    }

    const me = await this.myEmployee(userId, organizationId);
    if (me && request.employeeId === me.id) {
      throw new ForbiddenException('You cannot decide on your own leave request.');
    }

    if (decision === 'APPROVED' && request.type !== 'UNPAID') {
      // Re-verify leave balance limits at decision time!
      const balances = await this.balancesFor(request.employeeId, organizationId);
      const balance = balances.find((b) => b.type === request.type);
      if (balance) {
        const remaining = balance.total - balance.used;
        if (request.days > remaining) {
          throw new BadRequestException(
            `Employee only has ${remaining} days of ${request.type} leave left. Cannot approve.`,
          );
        }
      }
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: decision, decidedByUserId: userId, decidedAt: new Date() },
    });

    const employee = await this.prisma.employee.findUnique({ where: { id: request.employeeId } });
    if (!employee) {
      throw new NotFoundException('The employee on this request no longer exists.');
    }

    const decider = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

    // Write audit log
    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'DECIDE',
      resource: 'LeaveRequest',
      resourceId: id,
      result: 'ALLOW',
      details: { decision },
    });

    await this.notifications.create({
      userId: employee.userId,
      organizationId,
      title: decision === 'APPROVED' ? 'Your leave was approved' : 'Your leave was rejected',
      body: `${updated.type.charAt(0)}${updated.type.slice(1).toLowerCase()} leave, ${updated.startDate} to ${updated.endDate}.`,
      kind: 'leave',
      link: '/dashboard/leave',
    });

    return toPublicRequest(updated, employee, decider?.name ?? null);
  }

  async cancel(userId: string, organizationId: string, id: string): Promise<PublicLeaveRequest> {
    const request = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!request || request.organizationId !== organizationId) {
      throw new NotFoundException('That request no longer exists.');
    }

    const me = await this.myEmployee(userId, organizationId);
    if (!me || request.employeeId !== me.id) {
      throw new ForbiddenException('You can only cancel your own leave requests.');
    }

    if (request.status === 'REJECTED' || request.status === 'CANCELLED') {
      throw new BadRequestException('This request is already decided or cancelled.');
    }

    const prevStatus = request.status;

    // Update status to CANCELLED
    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    // If it was PENDING, we should also cancel/remove the approval request if one exists
    if (prevStatus === 'PENDING') {
      const approval = await this.prisma.approvalRequest.findFirst({
        where: { organizationId, sourceModule: 'Leave', sourceRecordId: id },
      });
      if (approval) {
        await this.prisma.approvalRequest.update({
          where: { id: approval.id },
          data: { status: 'REJECTED' }, // mark as rejected/cancelled in approvals queue
        });
      }
    }

    // Write audit log
    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'CANCEL',
      resource: 'LeaveRequest',
      resourceId: id,
      result: 'ALLOW',
      details: { prevStatus },
    });

    // Notify managers
    const approverIds = await this.approverUserIds(organizationId, userId);
    if (approverIds.length) {
      await this.notifications.createForMany(approverIds, {
        organizationId,
        title: 'Leave request cancelled',
        body: `${me.firstName} ${me.lastName} cancelled their ${request.type.toLowerCase()} leave request from ${request.startDate} to ${request.endDate}.`,
        kind: 'leave',
        link: '/dashboard/leave',
      });
    }

    return toPublicRequest(updated, me, null);
  }
}
