import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';
import type { PublicEmployee } from './employee.entity';

const hasPermission = (permissions: string[], reqPerm: string) => {
  if (permissions.includes('*') || permissions.includes(reqPerm)) return true;
  const namespace = reqPerm.split('.')[0];
  return permissions.includes(`${namespace}.*`);
};

/**
 * Read-only directory over the Employee identity records created on invite.
 * Guarded by `employees.view` and scoped to the caller's active company via the
 * X-Workspace-Id membership — the same access-control spine every module uses.
 */
@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  @RequirePermission('employees.view')
  list(@CurrentMembership() membership: Membership): Promise<PublicEmployee[]> {
    return this.employeesService.findByOrganization(membership.organizationId);
  }

  @Get('former')
  @RequirePermission('employees.view')
  listFormer(@CurrentMembership() membership: Membership): Promise<PublicEmployee[]> {
    return this.employeesService.findFormer(membership.organizationId);
  }

  @Get('me')
  async getMe(@CurrentMembership() membership: Membership): Promise<PublicEmployee> {
    const employee = await this.employeesService.findSelf(membership.userId, membership.organizationId);
    if (!employee) {
      throw new NotFoundException('You do not have an employee profile in this organization.');
    }
    return this.employeesService.findOne(employee.id, membership.organizationId);
  }

  @Get(':id')
  async getOne(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ): Promise<PublicEmployee> {
    const canViewAll = hasPermission(membership.permissions, 'employees.view');
    if (!canViewAll) {
      const selfEmp = await this.employeesService.findSelf(membership.userId, membership.organizationId);
      if (!selfEmp || selfEmp.id !== id) {
        throw new ForbiddenException("You don't have access to this employee profile.");
      }
    }
    return this.employeesService.findOne(id, membership.organizationId);
  }

  @Patch(':id')
  async update(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<PublicEmployee> {
    const canManageAll = hasPermission(membership.permissions, 'employees.manage');
    if (!canManageAll) {
      const selfEmp = await this.employeesService.findSelf(membership.userId, membership.organizationId);
      if (!selfEmp || selfEmp.id !== id) {
        throw new ForbiddenException("You don't have access to edit this profile.");
      }

      // Restrict employee-self updates: only firstName, lastName, contactNumber, homeAddress are allowed
      const restrictedKeys: Array<keyof UpdateEmployeeDto> = [
        'employeeId', 'jobTitle', 'department', 'startDate', 'employmentType', 'workLocation', 'managerId'
      ];
      for (const key of restrictedKeys) {
        if (dto[key] !== undefined) {
          throw new ForbiddenException(`You are not allowed to change your own ${key}.`);
        }
      }
    }
    return this.employeesService.update(id, membership.organizationId, dto);
  }

  @Delete(':id')
  @RequirePermission('employees.manage')
  @HttpCode(200)
  async remove(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.employeesService.remove(id, membership.organizationId);
    return { ok: true };
  }
}
