import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicEmployee, type PublicEmployee } from './employee.entity';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';
import { writeAuditLog } from '../common/audit-log';
import { ModuleRef } from '@nestjs/core';
import { ComplianceService } from '../compliance/compliance.service';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private async triggerComplianceScan(employeeId: string, organizationId: string) {
    try {
      const complianceService = this.moduleRef.get(ComplianceService, { strict: false });
      await complianceService.evalApplicability(employeeId, organizationId);
    } catch (err) {
      console.error('Failed to trigger compliance scan:', err);
    }
  }

  /** Every employee record in one company. Never crosses org boundaries (§1). */
  async findByOrganization(organizationId: string, status?: 'ACTIVE' | 'INACTIVE' | 'ALL'): Promise<PublicEmployee[]> {
    const all = await this.prisma.employee.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });

    // Filter soft-deleted in code, not in the query: a `{ deletedAt: null }`
    // Mongo filter does NOT match documents created before the field existed,
    // which would silently hide the whole directory. On read a missing field
    // comes back as null, so `!e.deletedAt` correctly keeps active records.
    const employees = all.filter((e) => {
      const isInactive = !!e.deletedAt;
      if (status === 'INACTIVE') return isInactive;
      if (status === 'ALL') return true;
      return !isInactive; // Default to ACTIVE
    });

    const emailById = await this.emailsFor(employees.map((e) => e.userId));
    const managerNameById = await this.managerNamesFor(employees);

    // Fetch active approved leave requests for today
    const todayStr = new Date().toISOString().split('T')[0];
    const activeLeaves = await this.prisma.leaveRequest.findMany({
      where: {
        organizationId,
        status: 'APPROVED',
        startDate: { lte: todayStr },
        endDate: { gte: todayStr },
      },
      select: { employeeId: true },
    });
    const onLeaveEmployeeIds = new Set(activeLeaves.map((l) => l.employeeId));

    return employees.map((e) =>
      toPublicEmployee(
        e,
        emailById.get(e.userId) ?? '',
        managerNameById.get(e.id) ?? null,
        onLeaveEmployeeIds.has(e.id),
      ),
    );
  }

  async findOne(id: string, organizationId: string): Promise<PublicEmployee> {
    const employee = await this.prisma.employee.findUnique({ where: { id } });

    // Scope check folded into the lookup: another org's id reads as "not found".
    if (!employee || employee.organizationId !== organizationId) {
      throw new NotFoundException('That employee no longer exists.');
    }

    const emailById = await this.emailsFor([employee.userId]);
    const managerNameById = await this.managerNamesFor([employee]);

    // Check if on leave today
    const todayStr = new Date().toISOString().split('T')[0];
    const leave = await this.prisma.leaveRequest.findFirst({
      where: {
        organizationId,
        employeeId: employee.id,
        status: 'APPROVED',
        startDate: { lte: todayStr },
        endDate: { gte: todayStr },
      },
    });

    return toPublicEmployee(
      employee,
      emailById.get(employee.userId) ?? '',
      managerNameById.get(employee.id) ?? null,
      !!leave,
    );
  }

  async findByUserId(userId: string, organizationId: string): Promise<PublicEmployee> {
    let employee = await this.prisma.employee.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });

    if (employee && employee.deletedAt) {
      throw new NotFoundException('Employee profile is inactive.');
    }

    if (!employee) {
      // Auto-create a basic Employee record for this user
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      const membership = await this.prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
      });

      if (!user || !membership) {
        throw new NotFoundException('User profile or workspace membership not found.');
      }

      employee = await this.prisma.employee.create({
        data: {
          id: `emp-${randomUUID().slice(0, 8)}`,
          userId,
          organizationId,
          employeeId: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
          firstName: user.name.split(' ')[0] || '',
          lastName: user.name.split(' ').slice(1).join(' ') || '',
          jobTitle: membership.jobTitle || 'Employee',
          department: 'General Administration',
          startDate: new Date(),
          employmentType: 'Full-time',
          workLocation: 'Office-Default',
          contactNumber: '',
          homeAddress: '',
        },
      });
      await this.triggerComplianceScan(employee.id, organizationId);
    }

    const emailById = await this.emailsFor([employee.userId]);
    const managerNameById = await this.managerNamesFor([employee]);

    // Check if on leave today
    const todayStr = new Date().toISOString().split('T')[0];
    const leave = await this.prisma.leaveRequest.findFirst({
      where: {
        organizationId,
        employeeId: employee.id,
        status: 'APPROVED',
        startDate: { lte: todayStr },
        endDate: { gte: todayStr },
      },
    });

    return toPublicEmployee(
      employee,
      emailById.get(employee.userId) ?? '',
      managerNameById.get(employee.id) ?? null,
      !!leave,
    );
  }

  /** Edits an HR record. Org-scoped: you can only touch your own company's people. */
  async update(id: string, organizationId: string, patch: UpdateEmployeeDto, callerUserId: string): Promise<PublicEmployee> {
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
    if (patch.dob !== undefined) data.dob = patch.dob;
    if (patch.gender !== undefined) data.gender = patch.gender;
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
    await this.triggerComplianceScan(updated.id, organizationId);

    // Write Audit Log
    await writeAuditLog(this.prisma, {
      organizationId,
      userId: callerUserId,
      action: 'UPDATE',
      resource: 'Employee',
      resourceId: updated.id,
      result: 'ALLOW',
      details: { updatedFields: Object.keys(data) },
    });

    const emailById = await this.emailsFor([updated.userId]);
    const managerNameById = await this.managerNamesFor([updated]);

    const todayStr = new Date().toISOString().split('T')[0];
    const leave = await this.prisma.leaveRequest.findFirst({
      where: {
        organizationId,
        employeeId: updated.id,
        status: 'APPROVED',
        startDate: { lte: todayStr },
        endDate: { gte: todayStr },
      },
    });

    return toPublicEmployee(
      updated,
      emailById.get(updated.userId) ?? '',
      managerNameById.get(updated.id) ?? null,
      !!leave,
    );
  }

  /**
   * Deletes the HR record only. The person's login + Membership are access-control
   * and are managed separately in Team Members (§9) — deleting an Employee record
   * does not revoke portal access.
   */
  async remove(id: string, organizationId: string, callerUserId: string): Promise<void> {
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

    // Write Audit Log
    await writeAuditLog(this.prisma, {
      organizationId,
      userId: callerUserId,
      action: 'DELETE',
      resource: 'Employee',
      resourceId: id,
      result: 'ALLOW',
      details: { email: existing.contactNumber },
    });
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
