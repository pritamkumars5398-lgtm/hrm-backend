import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicEmployee, type PublicEmployee } from './employee.entity';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every employee record in one company. Never crosses org boundaries (§1). */
  async findByOrganization(organizationId: string): Promise<PublicEmployee[]> {
    const employees = await this.prisma.employee.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });

    const emailById = await this.emailsFor(employees.map((e) => e.userId));

    return employees.map((e) => toPublicEmployee(e, emailById.get(e.userId) ?? ''));
  }

  async findOne(id: string, organizationId: string): Promise<PublicEmployee> {
    const employee = await this.prisma.employee.findUnique({ where: { id } });

    // Scope check folded into the lookup: another org's id reads as "not found".
    if (!employee || employee.organizationId !== organizationId) {
      throw new NotFoundException('That employee no longer exists.');
    }

    const emailById = await this.emailsFor([employee.userId]);
    return toPublicEmployee(employee, emailById.get(employee.userId) ?? '');
  }

  /** Edits an HR record. Org-scoped: you can only touch your own company's people. */
  async update(id: string, organizationId: string, patch: UpdateEmployeeDto): Promise<PublicEmployee> {
    const existing = await this.prisma.employee.findUnique({ where: { id } });
    if (!existing || existing.organizationId !== organizationId) {
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

    const updated = await this.prisma.employee.update({ where: { id }, data });

    const emailById = await this.emailsFor([updated.userId]);
    return toPublicEmployee(updated, emailById.get(updated.userId) ?? '');
  }

  /**
   * Deletes the HR record only. The person's login + Membership are access-control
   * and are managed separately in Team Members (§9) — deleting an Employee record
   * does not revoke portal access.
   */
  async remove(id: string, organizationId: string): Promise<void> {
    const existing = await this.prisma.employee.findUnique({ where: { id } });
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException('That employee no longer exists.');
    }

    await this.prisma.employee.delete({ where: { id } });
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
}
