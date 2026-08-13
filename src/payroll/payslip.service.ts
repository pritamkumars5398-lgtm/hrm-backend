import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { structureForMonth } from './salary.entity';
import {
  computeAmounts,
  computeUnpaidDays,
  daysInMonth,
  isoDate,
  type PublicPayslip,
} from './payslip.entity';
import type { SavePayslipDraftDto } from './dto/save-payslip-draft.dto';
import { ApprovalsService } from '../approvals/approvals.service';
import { writeAuditLog } from '../common/audit-log';

/** payroll.manage implies view — mirrors PermissionsGuard's own '*'/wildcard matching. */
function canView(permissions: string[]): boolean {
  return (
    permissions.includes('*') ||
    permissions.includes('payroll.view') ||
    permissions.includes('payroll.manage') ||
    permissions.includes('payroll.*')
  );
}

function canManage(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('payroll.manage') || permissions.includes('payroll.*');
}

function assertValidMonth(month: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new BadRequestException('month must be YYYY-MM.');
  }
}

@Injectable()
export class PayslipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => ApprovalsService))
    private readonly approvals: ApprovalsService,
  ) {}

  /**
   * One row per employee for the month — active employees, plus anyone (even
   * offboarded since) who already has a saved payslip for it, so a finalized
   * record never disappears just because someone left later.
   *
   * Without payroll.view/manage this is self-service: at most one row, for the
   * caller's own Employee record, and only once it's FINALIZED — a draft is HR
   * still working the numbers, not something to show the person they're about.
   */
  async list(
    organizationId: string,
    userId: string,
    permissions: string[],
    month: string,
    forceSelf = false,
  ): Promise<PublicPayslip[]> {
    assertValidMonth(month);

    if (forceSelf || !canView(permissions)) {
      return this.myPayslip(organizationId, userId, month);
    }

    const allEmployees = await this.prisma.employee.findMany({ where: { organizationId } });
    const existingPayslips = await this.prisma.payslip.findMany({ where: { organizationId, month } });
    const payslipByEmployee = new Map(existingPayslips.map((p) => [p.employeeId, p]));

    const employeesWithPayslip = new Set(existingPayslips.map((p) => p.employeeId));
    const employees = allEmployees.filter((e) => !e.deletedAt || employeesWithPayslip.has(e.id));

    if (employees.length === 0) return [];

    const structures = await this.prisma.salaryStructure.findMany({
      where: { organizationId, employeeId: { in: employees.map((e) => e.id) } },
    });
    const structuresByEmployee = new Map<string, typeof structures>();
    for (const s of structures) {
      const bucket = structuresByEmployee.get(s.employeeId) ?? [];
      bucket.push(s);
      structuresByEmployee.set(s.employeeId, bucket);
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { attendanceHalfDayThreshold: true, attendanceHolidays: true },
    });
    const halfDayThreshold = org?.attendanceHalfDayThreshold ?? 5.0;
    const holidays = org?.attendanceHolidays || [];

    const { attendanceByEmployeeDate, leaveByEmployeeDate } = await this.attendanceAndLeaveFor(
      organizationId,
      employees.map((e) => e.id),
      month,
    );

    const deciderIds = [...new Set(existingPayslips.map((p) => p.finalizedByUserId).filter((id): id is string => !!id))];
    const deciders = deciderIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: deciderIds } }, select: { id: true, name: true } })
      : [];
    const deciderNameById = new Map(deciders.map((d) => [d.id, d.name]));

    const today = new Date();

    return employees.map((employee) => {
      const structure = structureForMonth(structuresByEmployee.get(employee.id) ?? [], month);
      const saved = payslipByEmployee.get(employee.id) ?? null;

      return this.toPublic(employee, structure, saved, {
        attendanceByDate: attendanceByEmployeeDate.get(employee.id) ?? new Map(),
        leaveByDate: leaveByEmployeeDate.get(employee.id) ?? new Map(),
        today,
        month,
        finalizedByName: saved?.finalizedByUserId ? (deciderNameById.get(saved.finalizedByUserId) ?? null) : null,
        halfDayThreshold,
        holidays,
      });
    });
  }

  async saveDraft(
    employeeId: string,
    organizationId: string,
    permissions: string[],
    month: string,
    dto: SavePayslipDraftDto,
  ): Promise<PublicPayslip> {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage payroll data.');
    }
    assertValidMonth(month);

    const employee = await this.requireEmployeeAnyStatus(employeeId, organizationId);

    const existing = await this.prisma.payslip.findUnique({ where: { employeeId_month: { employeeId, month } } });
    if (existing && existing.status !== 'DRAFT') {
      throw new BadRequestException(`This payslip has status ${existing.status} and cannot be edited.`);
    }

    const data = {
      bonus: dto.bonus ?? existing?.bonus ?? 0,
      incentive: dto.incentive ?? existing?.incentive ?? 0,
      reimbursement: dto.reimbursement ?? existing?.reimbursement ?? 0,
      otherEarnings: dto.otherEarnings ?? existing?.otherEarnings ?? 0,
      incomeTax: dto.incomeTax ?? existing?.incomeTax ?? 0,
      otherDeduction: dto.otherDeduction ?? existing?.otherDeduction ?? 0,
      notes: dto.notes !== undefined ? dto.notes : (existing?.notes ?? null),
    };

    const saved = existing
      ? await this.prisma.payslip.update({ where: { id: existing.id }, data })
      : await this.prisma.payslip.create({
          data: {
            id: `pay-${randomUUID().slice(0, 8)}`,
            organizationId,
            employeeId,
            month,
            status: 'DRAFT',
            ...data,
          },
        });

    return this.oneFor(employee, organizationId, month, saved);
  }

  async submitApproval(
    employeeId: string,
    organizationId: string,
    userId: string,
    permissions: string[],
    month: string,
  ): Promise<PublicPayslip> {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage payroll data.');
    }
    assertValidMonth(month);

    const employee = await this.requireEmployeeAnyStatus(employeeId, organizationId);

    const existing = await this.prisma.payslip.findUnique({ where: { employeeId_month: { employeeId, month } } });
    if (existing && existing.status !== 'DRAFT') {
      throw new BadRequestException(`This payslip has status ${existing.status} and cannot be submitted for approval.`);
    }

    const structures = await this.prisma.salaryStructure.findMany({ where: { organizationId, employeeId } });
    const structure = structureForMonth(structures, month);
    if (!structure) {
      throw new BadRequestException('This employee has no salary structure yet — set one up before submitting payroll.');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { attendanceHalfDayThreshold: true, attendanceHolidays: true },
    });
    const halfDayThreshold = org?.attendanceHalfDayThreshold ?? 5.0;
    const holidays = org?.attendanceHolidays || [];

    const { attendanceByEmployeeDate, leaveByEmployeeDate } = await this.attendanceAndLeaveFor(
      organizationId,
      [employeeId],
      month,
    );

    const unpaidDays = computeUnpaidDays({
      month,
      startDate: employee.startDate,
      today: new Date(),
      attendanceByDate: attendanceByEmployeeDate.get(employeeId) ?? new Map(),
      leaveByDate: leaveByEmployeeDate.get(employeeId) ?? new Map(),
      halfDayThreshold,
      holidays,
    });

    const editable = {
      bonus: existing?.bonus ?? 0,
      incentive: existing?.incentive ?? 0,
      reimbursement: existing?.reimbursement ?? 0,
      otherEarnings: existing?.otherEarnings ?? 0,
      incomeTax: existing?.incomeTax ?? 0,
      otherDeduction: existing?.otherDeduction ?? 0,
    };

    const amounts = computeAmounts({
      basic: structure.basic,
      hra: structure.hra,
      otherAllowance: structure.otherAllowance,
      daysInMonth: daysInMonth(month),
      unpaidDays,
      ...editable,
    });

    const data = {
      ...editable,
      notes: existing?.notes ?? null,
      status: 'PENDING_APPROVAL',
    };

    const saved = existing
      ? await this.prisma.payslip.update({ where: { id: existing.id }, data })
      : await this.prisma.payslip.create({
          data: { id: `pay-${randomUUID().slice(0, 8)}`, organizationId, employeeId, month, ...data },
        });

    const name = `${employee.firstName} ${employee.lastName}`.trim();
    const periodLabel = new Date(Number(month.split('-')[0]), Number(month.split('-')[1]) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    await this.approvals.createApproval(
      organizationId,
      employeeId,
      'Payroll',
      saved.id,
      `Payroll Approval: ${name} - ${periodLabel}`,
      `Basic: ₹${structure.basic.toLocaleString('en-IN')}, Gross: ₹${amounts.grossEarnings.toLocaleString('en-IN')}, Deductions: ₹${amounts.totalDeductions.toLocaleString('en-IN')}, Net Pay: ₹${amounts.netSalary.toLocaleString('en-IN')}.`,
    );

    // Write audit log
    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'SUBMIT_APPROVAL',
      resource: 'Payslip',
      resourceId: saved.id,
      result: 'ALLOW',
      details: { month },
    });

    return this.oneFor(employee, organizationId, month, saved);
  }

  async decide(
    userId: string,
    organizationId: string,
    permissions: string[],
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    rejectionReason?: string,
  ): Promise<PublicPayslip> {
    if (!permissions.includes('*') && !permissions.includes('payroll.manage') && !permissions.includes('payroll.*') && !permissions.includes('approvals.manage')) {
      throw new ForbiddenException('You do not have permission to decide on payroll approvals.');
    }

    const payslip = await this.prisma.payslip.findUnique({ where: { id } });
    if (!payslip || payslip.organizationId !== organizationId) {
      throw new NotFoundException('That payslip record no longer exists.');
    }
    if (payslip.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('That payslip is not pending approval.');
    }

    const employee = await this.requireEmployeeAnyStatus(payslip.employeeId, organizationId);

    let saved;
    if (decision === 'APPROVED') {
      const structures = await this.prisma.salaryStructure.findMany({ where: { organizationId, employeeId: employee.id } });
      const structure = structureForMonth(structures, payslip.month);
      if (!structure) {
        throw new BadRequestException('This employee has no salary structure set up.');
      }

      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { attendanceHalfDayThreshold: true, attendanceHolidays: true },
      });
      const halfDayThreshold = org?.attendanceHalfDayThreshold ?? 5.0;
      const holidays = org?.attendanceHolidays || [];

      const { attendanceByEmployeeDate, leaveByEmployeeDate } = await this.attendanceAndLeaveFor(
        organizationId,
        [employee.id],
        payslip.month,
      );

      const unpaidDays = computeUnpaidDays({
        month: payslip.month,
        startDate: employee.startDate,
        today: new Date(),
        attendanceByDate: attendanceByEmployeeDate.get(employee.id) ?? new Map(),
        leaveByDate: leaveByEmployeeDate.get(employee.id) ?? new Map(),
        halfDayThreshold,
        holidays,
      });

      const amounts = computeAmounts({
        basic: structure.basic,
        hra: structure.hra,
        otherAllowance: structure.otherAllowance,
        daysInMonth: daysInMonth(payslip.month),
        unpaidDays,
        bonus: payslip.bonus,
        incentive: payslip.incentive,
        reimbursement: payslip.reimbursement,
        otherEarnings: payslip.otherEarnings,
        incomeTax: payslip.incomeTax,
        otherDeduction: payslip.otherDeduction,
      });

      const snapshot = {
        basic: structure.basic,
        hra: structure.hra,
        otherAllowance: structure.otherAllowance,
        daysInMonth: daysInMonth(payslip.month),
        unpaidDays,
        lopDeduction: amounts.lopDeduction,
        grossEarnings: amounts.grossEarnings,
        totalDeductions: amounts.totalDeductions,
        netSalary: amounts.netSalary,
      };

      saved = await this.prisma.payslip.update({
        where: { id },
        data: {
          status: 'FINALIZED',
          snapshot,
          finalizedAt: new Date(),
          finalizedByUserId: userId,
        },
      });

      await this.notifications.create({
        userId: employee.userId,
        organizationId,
        title: 'Your payslip was finalized',
        body: `${payslip.month} · Net ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amounts.netSalary)}`,
        kind: 'payroll',
        link: '/dashboard/payslip',
      });
    } else {
      saved = await this.prisma.payslip.update({
        where: { id },
        data: {
          status: 'DRAFT',
          notes: rejectionReason ? `Rejected: ${rejectionReason}. ${payslip.notes || ''}` : payslip.notes,
        },
      });

      const membership = await this.prisma.membership.findFirst({
        where: { organizationId, permissions: { has: 'payroll.manage' } },
      });
      if (membership) {
        await this.notifications.create({
          userId: membership.userId,
          organizationId,
          title: `Payslip rejected for ${employee.firstName} ${employee.lastName}`,
          body: rejectionReason ? `Reason: ${rejectionReason}` : `The payslip for ${payslip.month} was rejected.`,
          kind: 'payroll',
          link: `/dashboard/payroll?tab=monthly`,
        });
      }
    }

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: decision,
      resource: 'Payslip',
      resourceId: id,
      result: 'ALLOW',
      details: { decision, rejectionReason },
    });

    return this.oneFor(employee, organizationId, payslip.month, saved);
  }

  /** Self-service: the caller's own FINALIZED payslip for the month, or []. */
  private async myPayslip(organizationId: string, userId: string, month: string): Promise<PublicPayslip[]> {
    const employees = await this.prisma.employee.findMany({ where: { userId, organizationId } });
    const employee = employees.find((e) => !e.deletedAt);
    if (!employee) return [];

    const saved = await this.prisma.payslip.findUnique({ where: { employeeId_month: { employeeId: employee.id, month } } });
    if (!saved || saved.status !== 'FINALIZED') return [];

    return [await this.oneFor(employee, organizationId, month, saved)];
  }

  private async requireEmployeeAnyStatus(id: string, organizationId: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee || employee.organizationId !== organizationId) {
      throw new NotFoundException('That employee no longer exists.');
    }
    return employee;
  }

  /** Re-derives one full PublicPayslip after a write, reusing `list`'s per-employee logic. */
  private async oneFor(
    employee: Awaited<ReturnType<PayslipService['requireEmployeeAnyStatus']>>,
    organizationId: string,
    month: string,
    saved: NonNullable<Awaited<ReturnType<typeof this.prisma.payslip.findUnique>>>,
  ): Promise<PublicPayslip> {
    const structures = await this.prisma.salaryStructure.findMany({ where: { organizationId, employeeId: employee.id } });
    const structure = structureForMonth(structures, month);

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { attendanceHalfDayThreshold: true, attendanceHolidays: true },
    });
    const halfDayThreshold = org?.attendanceHalfDayThreshold ?? 5.0;
    const holidays = org?.attendanceHolidays || [];

    const { attendanceByEmployeeDate, leaveByEmployeeDate } = await this.attendanceAndLeaveFor(
      organizationId,
      [employee.id],
      month,
    );

    const finalizedByName = saved.finalizedByUserId
      ? (await this.prisma.user.findUnique({ where: { id: saved.finalizedByUserId }, select: { name: true } }))?.name ?? null
      : null;

    return this.toPublic(employee, structure, saved, {
      attendanceByDate: attendanceByEmployeeDate.get(employee.id) ?? new Map(),
      leaveByDate: leaveByEmployeeDate.get(employee.id) ?? new Map(),
      today: new Date(),
      month,
      finalizedByName,
      halfDayThreshold,
      holidays,
    });
  }

  private toPublic(
    employee: { id: string; employeeId: string | null; firstName: string; lastName: string; department: string; jobTitle: string; organizationId: string; startDate: Date },
    structure: { basic: number; hra: number; otherAllowance: number } | null,
    saved: {
      id: string;
      status: string;
      bonus: number;
      incentive: number;
      reimbursement: number;
      otherEarnings: number;
      incomeTax: number;
      otherDeduction: number;
      notes: string | null;
      finalizedAt: Date | null;
      snapshot: { basic: number; hra: number; otherAllowance: number; daysInMonth: number; unpaidDays: number; lopDeduction: number; grossEarnings: number; totalDeductions: number; netSalary: number } | null;
    } | null,
    ctx: {
      attendanceByDate: Map<string, { checkIn: Date | null; checkOut: Date | null }>;
      leaveByDate: Map<string, { type: string; isHalfDay: boolean }>;
      today: Date;
      month: string;
      finalizedByName: string | null;
      halfDayThreshold?: number | null;
      holidays?: string[];
    },
  ): PublicPayslip {
    const name = `${employee.firstName} ${employee.lastName}`.trim();
    const initials = ((employee.firstName[0] ?? '') + (employee.lastName[0] ?? '')).toUpperCase() || '?';

    const isFinalized = saved?.status === 'FINALIZED' && saved.snapshot;

    if (isFinalized) {
      const snap = saved.snapshot!;
      return {
        id: saved.id,
        organizationId: employee.organizationId,
        employeeId: employee.id,
        employeeCode: employee.employeeId,
        employeeName: name,
        avatarInitials: initials,
        department: employee.department,
        designation: employee.jobTitle,
        month: ctx.month,
        status: 'FINALIZED',
        hasSalaryStructure: true,
        basic: snap.basic,
        hra: snap.hra,
        otherAllowance: snap.otherAllowance,
        daysInMonth: snap.daysInMonth,
        unpaidDays: snap.unpaidDays,
        bonus: saved.bonus,
        incentive: saved.incentive,
        reimbursement: saved.reimbursement,
        otherEarnings: saved.otherEarnings,
        incomeTax: saved.incomeTax,
        otherDeduction: saved.otherDeduction,
        lopDeduction: snap.lopDeduction,
        grossEarnings: snap.grossEarnings,
        totalDeductions: snap.totalDeductions,
        netSalary: snap.netSalary,
        notes: saved.notes,
        finalizedAt: saved.finalizedAt ? saved.finalizedAt.toISOString().slice(0, 10) : null,
        finalizedBy: ctx.finalizedByName,
      };
    }

    // DRAFT (saved or virtual) — everything computed live from current data.
    const basic = structure?.basic ?? 0;
    const hra = structure?.hra ?? 0;
    const otherAllowance = structure?.otherAllowance ?? 0;
    const unpaidDays = computeUnpaidDays({
      month: ctx.month,
      startDate: employee.startDate,
      today: ctx.today,
      attendanceByDate: ctx.attendanceByDate,
      leaveByDate: ctx.leaveByDate,
      halfDayThreshold: ctx.halfDayThreshold,
      holidays: ctx.holidays,
    });

    const editable = {
      bonus: saved?.bonus ?? 0,
      incentive: saved?.incentive ?? 0,
      reimbursement: saved?.reimbursement ?? 0,
      otherEarnings: saved?.otherEarnings ?? 0,
      incomeTax: saved?.incomeTax ?? 0,
      otherDeduction: saved?.otherDeduction ?? 0,
    };

    const amounts = computeAmounts({
      basic,
      hra,
      otherAllowance,
      daysInMonth: daysInMonth(ctx.month),
      unpaidDays,
      ...editable,
    });

    return {
      id: saved?.id ?? null,
      organizationId: employee.organizationId,
      employeeId: employee.id,
      employeeCode: employee.employeeId,
      employeeName: name,
      avatarInitials: initials,
      department: employee.department,
      designation: employee.jobTitle,
      month: ctx.month,
      status: (saved?.status as any) ?? 'DRAFT',
      hasSalaryStructure: structure !== null,
      basic,
      hra,
      otherAllowance,
      daysInMonth: daysInMonth(ctx.month),
      unpaidDays,
      ...editable,
      lopDeduction: amounts.lopDeduction,
      grossEarnings: amounts.grossEarnings,
      totalDeductions: amounts.totalDeductions,
      netSalary: amounts.netSalary,
      notes: saved?.notes ?? null,
      finalizedAt: null,
      finalizedBy: null,
    };
  }

  /** Batched attendance + approved-leave lookup for a set of employees over one month. */
  private async attendanceAndLeaveFor(organizationId: string, employeeIds: string[], month: string) {
    const attendanceByEmployeeDate = new Map<string, Map<string, { checkIn: Date | null; checkOut: Date | null }>>();
    const leaveByEmployeeDate = new Map<string, Map<string, { type: string; isHalfDay: boolean }>>();

    if (employeeIds.length === 0) return { attendanceByEmployeeDate, leaveByEmployeeDate };

    const total = daysInMonth(month);
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(total).padStart(2, '0')}`;

    const records = await this.prisma.attendanceRecord.findMany({
      where: { organizationId, employeeId: { in: employeeIds }, date: { gte: monthStart, lte: monthEnd } },
    });
    for (const r of records) {
      const bucket = attendanceByEmployeeDate.get(r.employeeId) ?? new Map();
      bucket.set(r.date, { checkIn: r.checkIn, checkOut: r.checkOut });
      attendanceByEmployeeDate.set(r.employeeId, bucket);
    }

    const leaveRequests = await this.prisma.leaveRequest.findMany({
      where: {
        organizationId,
        employeeId: { in: employeeIds },
        status: 'APPROVED',
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
    });
    for (const req of leaveRequests) {
      const bucket = leaveByEmployeeDate.get(req.employeeId) ?? new Map();
      for (let d = new Date(`${req.startDate}T00:00:00`); isoDate(d) <= req.endDate; d.setDate(d.getDate() + 1)) {
        const iso = isoDate(d);
        if (iso >= monthStart && iso <= monthEnd) {
          bucket.set(iso, { type: req.type, isHalfDay: req.isHalfDay });
        }
      }
      leaveByEmployeeDate.set(req.employeeId, bucket);
    }

    return { attendanceByEmployeeDate, leaveByEmployeeDate };
  }
}
