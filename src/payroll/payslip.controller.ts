import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PayslipService } from './payslip.service';
import { SavePayslipDraftDto } from './dto/save-payslip-draft.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';
import type { PublicPayslip } from './payslip.entity';

function requireMembership(membership: Membership | undefined): Membership {
  if (!membership) {
    throw new BadRequestException('X-Workspace-Id header is required.');
  }
  return membership;
}

/**
 * No `@RequirePermission` — same reasoning as Salary (payroll.manage implies
 * view, checked in the service instead of the declarative guard).
 */
@Controller('payroll/payslips')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayslipController {
  constructor(private readonly payslipService: PayslipService) {}

  @Get()
  async list(
    @CurrentMembership() m: Membership | undefined,
    @Query('month') month: string,
  ): Promise<PublicPayslip[]> {
    const membership = requireMembership(m);
    return this.payslipService.list(membership.organizationId, membership.permissions, month);
  }

  @Post(':employeeId')
  async saveDraft(
    @CurrentMembership() m: Membership | undefined,
    @Param('employeeId') employeeId: string,
    @Query('month') month: string,
    @Body() dto: SavePayslipDraftDto,
  ): Promise<PublicPayslip> {
    const membership = requireMembership(m);
    return this.payslipService.saveDraft(employeeId, membership.organizationId, membership.permissions, month, dto);
  }

  @Post(':employeeId/finalize')
  @HttpCode(200)
  async finalize(
    @CurrentMembership() m: Membership | undefined,
    @Param('employeeId') employeeId: string,
    @Query('month') month: string,
  ): Promise<PublicPayslip> {
    const membership = requireMembership(m);
    return this.payslipService.finalize(employeeId, membership.organizationId, membership.userId, membership.permissions, month);
  }
}
