import { BadRequestException, Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { DecideApprovalDto } from './dto/approvals.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

function requireMembership(membership: Membership | undefined): Membership {
  if (!membership) {
    throw new BadRequestException('X-Workspace-Id header is required.');
  }
  return membership;
}

@Controller('approvals')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Get('pending')
  async listPending(@CurrentMembership() m: Membership | undefined) {
    const membership = requireMembership(m);
    return this.approvalsService.listPending(membership.organizationId, membership.permissions);
  }

  @Patch(':id/decide')
  async decideApproval(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
    @Body() dto: DecideApprovalDto,
  ) {
    const membership = requireMembership(m);
    return this.approvalsService.decideApproval(id, membership.organizationId, membership.permissions, membership.userId, dto);
  }
}
