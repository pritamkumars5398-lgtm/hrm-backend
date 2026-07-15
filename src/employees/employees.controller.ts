import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';
import type { PublicEmployee } from './employee.entity';

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

  @Get(':id')
  @RequirePermission('employees.view')
  getOne(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ): Promise<PublicEmployee> {
    return this.employeesService.findOne(id, membership.organizationId);
  }

  @Patch(':id')
  @RequirePermission('employees.manage')
  update(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<PublicEmployee> {
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
