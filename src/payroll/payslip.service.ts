import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { structureForMonth } from './salary.entity';
import {
  computeAmounts,
  computeUnpaidDays,
  daysInMonth,
  isoDate,
  type PublicPayslip,
} from './payslip.entity';
import type { SavePayslipDraftDto } from './dto/save-payslip-draft.dto';

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
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One row per employee for the month — active employees, plus anyone (even
   * offboarded since) who already has a saved payslip for it, so a finalized
   * record never disappears just because someone left later.
   */
  async list(organizationId: string, permissions: string[], month: string): Promise<PublicPayslip[]> {
    if (!canView(permissions)) {
      throw new ForbiddenException('You do not have permission to view payroll data.');
    }
    assertValidMonth(month);

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

    const { attendanceByEmployeeDate, leaveTypeByEmployeeDate } = await this.attendanceAndLeaveFor(
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
        leaveTypeByDate: leaveTypeByEmployeeDate.get(employee.id) ?? new Map(),
        today,
        month,
        finalizedByName: saved?.finalizedByUserId ? (deciderNameById.get(saved.finalizedByUserId) ?? null) : null,
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
    if (existing?.status === 'FINALIZED') {
      throw new BadRequestException('This payslip is already finalized and cannot be edited.');
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

  async finalize(
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
    if (existing?.status === 'FINALIZED') {
      throw new BadRequestException('This payslip is already finalized.');
    }

    const structures = await this.prisma.salaryStructure.findMany({ where: { organizationId, employeeId } });
    const structure = structureForMonth(structures, month);
    if (!structure) {
      throw new BadRequestException('This employee has no salary structure yet — set one up before finalizing payroll.');
    }

    const { attendanceByEmployeeDate, leaveTypeByEmployeeDate } = await this.attendanceAndLeaveFor(
      organizationId,
      [employeeId],
      month,
    );

    const unpaidDays = computeUnpaidDays({
      month,
      startDate: employee.startDate,
      today: new Date(),
      attendanceByDate: attendanceByEmployeeDate.get(employeeId) ?? new Map(),
      leaveTypeByDate: leaveTypeByEmployeeDate.get(employeeId) ?? new Map(),
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

    const snapshot = {
      basic: structure.basic,
      hra: structure.hra,
      otherAllowance: structure.otherAllowance,
      daysInMonth: daysInMonth(month),
      unpaidDays,
      lopDeduction: amounts.lopDeduction,
      grossEarnings: amounts.grossEarnings,
      totalDeductions: amounts.totalDeductions,
      netSalary: amounts.netSalary,
    };

    const data = {
      ...editable,
      notes: existing?.notes ?? null,
      status: 'FINALIZED',
      snapshot,
      finalizedAt: new Date(),
      finalizedByUserId: userId,
    };

    const saved = existing
      ? await this.prisma.payslip.update({ where: { id: existing.id }, data })
      : await this.prisma.payslip.create({
          data: { id: `pay-${randomUUID().slice(0, 8)}`, organizationId, employeeId, month, ...data },
        });

    return this.oneFor(employee, organizationId, month, saved);
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

    const { attendanceByEmployeeDate, leaveTypeByEmployeeDate } = await this.attendanceAndLeaveFor(
      organizationId,
      [employee.id],
      month,
    );

    const finalizedByName = saved.finalizedByUserId
      ? (await this.prisma.user.findUnique({ where: { id: saved.finalizedByUserId }, select: { name: true } }))?.name ?? null
      : null;

    return this.toPublic(employee, structure, saved, {
      attendanceByDate: attendanceByEmployeeDate.get(employee.id) ?? new Map(),
      leaveTypeByDate: leaveTypeByEmployeeDate.get(employee.id) ?? new Map(),
      today: new Date(),
      month,
      finalizedByName,
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
      leaveTypeByDate: Map<string, string>;
      today: Date;
      month: string;
      finalizedByName: string | null;
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
      leaveTypeByDate: ctx.leaveTypeByDate,
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
      status: 'DRAFT',
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
    const leaveTypeByEmployeeDate = new Map<string, Map<string, string>>();

    if (employeeIds.length === 0) return { attendanceByEmployeeDate, leaveTypeByEmployeeDate };

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
      const bucket = leaveTypeByEmployeeDate.get(req.employeeId) ?? new Map();
      for (let d = new Date(`${req.startDate}T00:00:00`); isoDate(d) <= req.endDate; d.setDate(d.getDate() + 1)) {
        const iso = isoDate(d);
        if (iso >= monthStart && iso <= monthEnd) bucket.set(iso, req.type);
      }
      leaveTypeByEmployeeDate.set(req.employeeId, bucket);
    }

    return { attendanceByEmployeeDate, leaveTypeByEmployeeDate };
  }
}
