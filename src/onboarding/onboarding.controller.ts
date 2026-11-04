import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  OnboardingService,
  type CreateOnboardingDto,
  type UpdateOnboardingDto,
} from './onboarding.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('onboarding')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get()
  getAll(
    @CurrentMembership() membership: Membership,
    @Query('status') status?: string,
  ) {
    return this.onboardingService.getAll(membership.organizationId, status);
  }

  @Get(':id')
  getById(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.onboardingService.getById(membership.organizationId, id);
  }

  @Post()
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateOnboardingDto,
  ) {
    return this.onboardingService.create(membership.organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body() dto: UpdateOnboardingDto,
  ) {
    return this.onboardingService.update(membership.organizationId, id, dto);
  }

  @Patch(':id/tasks/:taskId')
  toggleTask(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() body: { completed: boolean },
  ) {
    return this.onboardingService.toggleTask(
      membership.organizationId,
      id,
      taskId,
      body.completed,
    );
  }

  @Delete(':id')
  delete(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.onboardingService.delete(membership.organizationId, id);
  }
}
