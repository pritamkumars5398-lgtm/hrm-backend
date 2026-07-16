import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { ApplyLeaveDto } from './dto/apply-leave.dto';
import { UpdateLeavePolicyDto } from './dto/update-leave-policy.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';
import type { PublicLeaveData, PublicLeavePolicy, PublicLeaveRequest } from './leave.entity';

function requireMembership(membership: Membership | undefined): Membership {
  if (!membership) {
    throw new BadRequestException('X-Workspace-Id header is required.');
  }
  return membership;
}

/**
 * No `@RequirePermission` on the controller — applying for leave and seeing your
 * own requests is a baseline every member gets, same as Attendance. `leave.approve`
 * only changes what `get` returns (company-wide + approvals vs. just you) —
 * decided server-side, never trusted from the client.
 */
@Controller('leave')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  @Get()
  async get(@CurrentMembership() m: Membership | undefined): Promise<PublicLeaveData> {
    const membership = requireMembership(m);
    return this.leaveService.get({
      userId: membership.userId,
      organizationId: membership.organizationId,
      permissions: membership.permissions,
    });
  }

  @Post()
  async apply(
    @CurrentMembership() m: Membership | undefined,
    @Body() dto: ApplyLeaveDto,
  ): Promise<PublicLeaveRequest> {
    const membership = requireMembership(m);
    return this.leaveService.apply(membership.userId, membership.organizationId, dto);
  }

  @Patch('policy')
  async updatePolicy(
    @CurrentMembership() m: Membership | undefined,
    @Body() dto: UpdateLeavePolicyDto,
  ): Promise<PublicLeavePolicy> {
    const membership = requireMembership(m);
    return this.leaveService.updatePolicy(membership.organizationId, membership.permissions, dto);
  }

  @Post(':id/decide')
  @HttpCode(200)
  async decide(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
    @Body('decision') decision: 'APPROVED' | 'REJECTED',
  ): Promise<PublicLeaveRequest> {
    const membership = requireMembership(m);
    return this.leaveService.decide(membership.userId, membership.organizationId, membership.permissions, id, decision);
  }
}
