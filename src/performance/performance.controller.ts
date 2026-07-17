import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PerformanceService } from './performance.service';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalProgressDto } from './dto/update-goal-progress.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';
import type { PublicPerformanceData } from './performance.entity';

function requireMembership(membership: Membership | undefined): Membership {
  if (!membership) {
    throw new BadRequestException('X-Workspace-Id header is required.');
  }
  return membership;
}

/**
 * No `@RequirePermission` on the controller — `performance.view` alone only
 * changes what `get` returns (team/'me' vs. company), decided server-side from
 * `performance.manage`/`*` and the `managerId` graph, same pattern as Leave.
 * The sidebar still gates the module itself on `performance.view`/`.manage`
 * (frontend navigation.ts) — this guard only re-checks scope, never trusts it.
 */
@Controller('performance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PerformanceController {
  constructor(private readonly performanceService: PerformanceService) {}

  @Get()
  get(@CurrentMembership() m: Membership | undefined): Promise<PublicPerformanceData> {
    const membership = requireMembership(m);
    return this.performanceService.get({
      userId: membership.userId,
      organizationId: membership.organizationId,
      permissions: membership.permissions,
    });
  }

  @Post('reviews/:employeeId')
  @HttpCode(200)
  async submitReview(
    @CurrentMembership() m: Membership | undefined,
    @Param('employeeId') employeeId: string,
    @Body() dto: SubmitReviewDto,
  ): Promise<{ ok: true }> {
    const membership = requireMembership(m);
    await this.performanceService.submitReview(membership.userId, membership.organizationId, membership.permissions, employeeId, dto);
    return { ok: true };
  }

  @Post('goals/:employeeId')
  @HttpCode(200)
  async addGoal(
    @CurrentMembership() m: Membership | undefined,
    @Param('employeeId') employeeId: string,
    @Body() dto: CreateGoalDto,
  ): Promise<{ ok: true }> {
    const membership = requireMembership(m);
    await this.performanceService.addGoal(membership.userId, membership.organizationId, membership.permissions, employeeId, dto);
    return { ok: true };
  }

  @Patch('goals/:goalId')
  async updateGoalProgress(
    @CurrentMembership() m: Membership | undefined,
    @Param('goalId') goalId: string,
    @Body() dto: UpdateGoalProgressDto,
  ): Promise<{ ok: true }> {
    const membership = requireMembership(m);
    await this.performanceService.updateGoalProgress(membership.userId, membership.organizationId, membership.permissions, goalId, dto.progress);
    return { ok: true };
  }
}
