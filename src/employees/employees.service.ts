import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicEmployee, type PublicEmployee } from './employee.entity';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every employee record in one company. Never crosses org boundaries (§1). */
  async findByOrganization(organizationId: string): Promise<PublicEmployee[]> {
    const all = await this.prisma.employee.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });

    // Filter soft-deleted in code, not in the query: a `{ deletedAt: null }`
    // Mongo filter does NOT match documents created before the field existed,
    // which would silently hide the whole directory. On read a missing field
    // comes back as null, so `!e.deletedAt` correctly keeps active records.
    const employees = all.filter((e) => !e.deletedAt);

    const emailById = await this.emailsFor(employees.map((e) => e.userId));
    const managerNameById = await this.managerNamesFor(employees);

    return employees.map((e) =>
      toPublicEmployee(e, emailById.get(e.userId) ?? '', managerNameById.get(e.id) ?? null),
    );
  }

  async findOne(id: string, organizationId: string): Promise<PublicEmployee> {
    const employee = await this.prisma.employee.findUnique({ where: { id } });

    // Scope check folded into the lookup: another org's id — or a soft-deleted
    // record — reads as "not found".
    if (!employee || employee.organizationId !== organizationId || employee.deletedAt) {
      throw new NotFoundException('That employee no longer exists.');
    }

    const emailById = await this.emailsFor([employee.userId]);
    const managerNameById = await this.managerNamesFor([employee]);
    return toPublicEmployee(employee, emailById.get(employee.userId) ?? '', managerNameById.get(employee.id) ?? null);
  }

  /** Edits an HR record. Org-scoped: you can only touch your own company's people. */
  async update(id: string, organizationId: string, patch: UpdateEmployeeDto): Promise<PublicEmployee> {
    const existing = await this.prisma.employee.findUnique({ where: { id } });
    if (!existing || existing.organizationId !== organizationId || existing.deletedAt) {
      throw new NotFoundException('That employee no longer exists.');
    }

    // Only forward fields the client actually sent, so an omitted field is left
    // untouched rather than overwritten with undefined/empty.
    const data: Record<string, unknown> = {};
    if (patch.firstName !== undefined) data.firstName = patch.firstName;
    if (patch.lastName !== undefined) data.lastName = patch.lastName;
    if (patch.employeeId !== undefined) data.employeeId = patch.employeeId;
    if (patch.contactNumber !== undefined) data.contactNumber = patch.contactNumber;
    if (patch.homeAddress !== undefined) data.homeAddress = patch.homeAddress;
    if (patch.jobTitle !== undefined) data.jobTitle = patch.jobTitle;
    if (patch.department !== undefined) data.department = patch.department;
    if (patch.employmentType !== undefined) data.employmentType = patch.employmentType;
    if (patch.workLocation !== undefined) data.workLocation = patch.workLocation;
    if (patch.startDate) data.startDate = new Date(patch.startDate);
    if (patch.managerId !== undefined) {
      // A manager must be a real, active employee in the same company — and
      // nobody can be their own manager.
      if (patch.managerId) {
        if (patch.managerId === id) {
          throw new BadRequestException('An employee cannot be their own manager.');
        }
        const manager = await this.prisma.employee.findUnique({ where: { id: patch.managerId } });
        if (!manager || manager.organizationId !== organizationId || manager.deletedAt) {
          throw new BadRequestException('That manager could not be found in this company.');
        }
      }
      data.managerId = patch.managerId || null;
    }

    const updated = await this.prisma.employee.update({ where: { id }, data });

    const emailById = await this.emailsFor([updated.userId]);
    const managerNameById = await this.managerNamesFor([updated]);
    return toPublicEmployee(updated, emailById.get(updated.userId) ?? '', managerNameById.get(updated.id) ?? null);
  }

  /**
   * Deletes the HR record only. The person's login + Membership are access-control
   * and are managed separately in Team Members (§9) — deleting an Employee record
   * does not revoke portal access.
   */
  async remove(id: string, organizationId: string): Promise<void> {
    const existing = await this.prisma.employee.findUnique({ where: { id } });
    if (!existing || existing.organizationId !== organizationId || existing.deletedAt) {
      throw new NotFoundException('That employee no longer exists.');
    }

    // Soft delete (§6): retain the row, stamp deletedAt. Reads filter it out.
    // Note: anyone who had this person as `managerId` keeps that pointer — it
    // now references a deleted record. Reassignment policy (skip-level? none?)
    // is a real product decision, deliberately left for the Attendance/Leave/
    // Performance "my reports" work that actually depends on it (Phase 3 §4).
    await this.prisma.employee.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Soft-deletes the Employee HR record for a user in one org, if one exists.
   * A no-op when there is none (a Team-Members-only invite never created one) —
   * called when removing someone's Membership, so offboarding retires both
   * their portal access and their HR record together (§1.3).
   */
  async deactivateForUser(userId: string, organizationId: string): Promise<void> {
    const existing = await this.prisma.employee.findFirst({ where: { userId, organizationId } });
    if (existing && !existing.deletedAt) {
      await this.prisma.employee.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    }
  }

  /** Employee records store userId, not email — email lives on the User. */
  private async emailsFor(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true },
    });

    return new Map(users.map((u) => [u.id, u.email]));
  }

  /** Batched lookup: employee.id -> their manager's display name, via managerId. */
  private async managerNamesFor(employees: Array<{ id: string; managerId: string | null }>): Promise<Map<string, string>> {
    const managerIds = [...new Set(employees.map((e) => e.managerId).filter((id): id is string => !!id))];
    if (managerIds.length === 0) return new Map();

    const managers = await this.prisma.employee.findMany({
      where: { id: { in: managerIds } },
      select: { id: true, firstName: true, lastName: true, deletedAt: true },
    });
    const nameByManagerId = new Map(
      managers.filter((m) => !m.deletedAt).map((m) => [m.id, `${m.firstName} ${m.lastName}`.trim()]),
    );

    const result = new Map<string, string>();
    for (const e of employees) {
      if (e.managerId && nameByManagerId.has(e.managerId)) {
        result.set(e.id, nameByManagerId.get(e.managerId)!);
      }
    }
    return result;
  }
}
