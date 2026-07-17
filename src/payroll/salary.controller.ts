import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SalaryService, type CompanySalaryRow } from './salary.service';
import { UpsertSalaryStructureDto } from './dto/upsert-salary-structure.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';
import type { PublicSalaryStructure } from './salary.entity';

function requireMembership(membership: Membership | undefined): Membership {
  if (!membership) {
    throw new BadRequestException('X-Workspace-Id header is required.');
  }
  return membership;
}

/**
 * No `@RequirePermission` here — `payroll.manage` should also grant read access
 * (a manager can obviously see what they manage), which the declarative guard
 * can't express as "either of two permissions". Checked in the service instead,
 * same as Leave (§ leave.controller.ts).
 */
@Controller('payroll/salary')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalaryController {
  constructor(private readonly salaryService: SalaryService) {}

  @Get()
  async list(@CurrentMembership() m: Membership | undefined): Promise<CompanySalaryRow[]> {
    const membership = requireMembership(m);
    return this.salaryService.listCompany(membership.organizationId, membership.permissions);
  }

  @Get(':employeeId/history')
  async history(
    @CurrentMembership() m: Membership | undefined,
    @Param('employeeId') employeeId: string,
  ): Promise<PublicSalaryStructure[]> {
    const membership = requireMembership(m);
    return this.salaryService.history(employeeId, membership.organizationId, membership.permissions);
  }

  @Post(':employeeId')
  async upsert(
    @CurrentMembership() m: Membership | undefined,
    @Param('employeeId') employeeId: string,
    @Body() dto: UpsertSalaryStructureDto,
  ): Promise<PublicSalaryStructure> {
    const membership = requireMembership(m);
    return this.salaryService.upsert(employeeId, membership.organizationId, membership.userId, membership.permissions, dto);
  }
}
