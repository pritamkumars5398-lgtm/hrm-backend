import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { structureForMonth, toPublicSalaryStructure, type PublicSalaryStructure } from './salary.entity';
import type { UpsertSalaryStructureDto } from './dto/upsert-salary-structure.dto';

export type CompanySalaryRow = {
  employeeId: string;
  employeeName: string;
  avatarInitials: string;
  department: string;
  designation: string;
  /** Null if nobody has ever entered a structure for them yet. */
  current: PublicSalaryStructure | null;
};

const currentMonth = () => new Date().toISOString().slice(0, 7);

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

@Injectable()
export class SalaryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Org-scoped lookup that still finds offboarded employees — history is a
   *  record of the past, not a statement about who currently works here. */
  private async requireEmployeeAnyStatus(id: string, organizationId: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee || employee.organizationId !== organizationId) {
      throw new NotFoundException('That employee no longer exists.');
    }
    return employee;
  }

  /** Same, but rejects offboarded employees — you can't set a salary for
   *  someone who no longer works here. */
  private async requireActiveEmployee(id: string, organizationId: string) {
    const employee = await this.requireEmployeeAnyStatus(id, organizationId);
    if (employee.deletedAt) {
      throw new NotFoundException('That employee no longer exists.');
    }
    return employee;
  }

  /** One row per active employee in the company, with whatever structure applies this month. */
  async listCompany(organizationId: string, permissions: string[]): Promise<CompanySalaryRow[]> {
    if (!canView(permissions)) {
      throw new ForbiddenException('You do not have permission to view salary data.');
    }
    const employees = (
      await this.prisma.employee.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } })
    ).filter((e) => !e.deletedAt);

    if (employees.length === 0) return [];

    const allStructures = await this.prisma.salaryStructure.findMany({
      where: { organizationId, employeeId: { in: employees.map((e) => e.id) } },
    });

    const byEmployee = new Map<string, typeof allStructures>();
    for (const s of allStructures) {
      const bucket = byEmployee.get(s.employeeId) ?? [];
      bucket.push(s);
      byEmployee.set(s.employeeId, bucket);
    }

    const month = currentMonth();

    return employees.map((e) => {
      const history = byEmployee.get(e.id) ?? [];
      const current = structureForMonth(history, month);
      return {
        employeeId: e.id,
        employeeName: `${e.firstName} ${e.lastName}`.trim(),
        avatarInitials: ((e.firstName[0] ?? '') + (e.lastName[0] ?? '')).toUpperCase() || '?',
        department: e.department,
        designation: e.jobTitle,
        current: current ? toPublicSalaryStructure(current) : null,
      };
    });
  }

  /** Full revision history for one employee, newest first. */
  async history(employeeId: string, organizationId: string, permissions: string[]): Promise<PublicSalaryStructure[]> {
    if (!canView(permissions)) {
      throw new ForbiddenException('You do not have permission to view salary data.');
    }
    await this.requireEmployeeAnyStatus(employeeId, organizationId);

    const records = await this.prisma.salaryStructure.findMany({
      where: { organizationId, employeeId },
      orderBy: { effectiveFrom: 'desc' },
    });
    return records.map(toPublicSalaryStructure);
  }

  /**
   * Adds a new revision. Same employee + same effectiveFrom overwrites (fixing a
   * typo before it's ever used) rather than erroring — enforced by the unique
   * index, not a manual lookup.
   */
  async upsert(
    employeeId: string,
    organizationId: string,
    userId: string,
    permissions: string[],
    dto: UpsertSalaryStructureDto,
  ): Promise<PublicSalaryStructure> {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage salary data.');
    }
    await this.requireActiveEmployee(employeeId, organizationId);

    if (dto.basic <= 0) {
      throw new BadRequestException('Basic salary must be greater than zero.');
    }

    const existing = await this.prisma.salaryStructure.findUnique({
      where: { employeeId_effectiveFrom: { employeeId, effectiveFrom: dto.effectiveFrom } },
    });

    const data = {
      basic: dto.basic,
      hra: dto.hra ?? 0,
      otherAllowance: dto.otherAllowance ?? 0,
    };

    const record = existing
      ? await this.prisma.salaryStructure.update({ where: { id: existing.id }, data })
      : await this.prisma.salaryStructure.create({
          data: {
            id: `sal-${randomUUID().slice(0, 8)}`,
            organizationId,
            employeeId,
            effectiveFrom: dto.effectiveFrom,
            createdByUserId: userId,
            ...data,
          },
        });

    return toPublicSalaryStructure(record);
  }
}
