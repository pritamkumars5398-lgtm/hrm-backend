import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { AddTaskDto, UpdateTaskDto } from './dto/onboarding.dto';
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

@Controller('onboarding')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get()
  async get(@CurrentMembership() m: Membership | undefined) {
    const membership = requireMembership(m);
    return this.onboardingService.get({
      userId: membership.userId,
      organizationId: membership.organizationId,
      permissions: membership.permissions,
    });
  }

  @Post(':employeeId/tasks')
  async addTask(
    @CurrentMembership() m: Membership | undefined,
    @Param('employeeId') employeeId: string,
    @Body() dto: AddTaskDto,
  ) {
    const membership = requireMembership(m);
    return this.onboardingService.addTask(
      membership.userId,
      membership.organizationId,
      membership.permissions,
      employeeId,
      dto,
    );
  }

  @Patch('tasks/:taskId')
  async updateTask(
    @CurrentMembership() m: Membership | undefined,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    const membership = requireMembership(m);
    await this.onboardingService.updateTask(
      membership.userId,
      membership.organizationId,
      membership.permissions,
      taskId,
      dto,
    );
    return { ok: true };
  }

  @Post(':employeeId/complete')
  async completeOnboarding(
    @CurrentMembership() m: Membership | undefined,
    @Param('employeeId') employeeId: string,
  ) {
    const membership = requireMembership(m);
    await this.onboardingService.completeOnboarding(
      membership.userId,
      membership.organizationId,
      membership.permissions,
      employeeId,
    );
    return { ok: true };
  }
}
