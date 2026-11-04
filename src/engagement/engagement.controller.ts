import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  EngagementService,
  type CreateEngagementPostDto,
} from './engagement.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('engagement')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EngagementController {
  constructor(private readonly engagementService: EngagementService) {}

  @Get()
  getAll(@CurrentMembership() membership: Membership) {
    return this.engagementService.getAll(membership.organizationId);
  }

  @Post()
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateEngagementPostDto,
  ) {
    return this.engagementService.create(
      membership.organizationId,
      membership.jobTitle ? `${membership.jobTitle} User` : 'Priya Sharma',
      membership.jobTitle || 'HR Manager',
      dto,
    );
  }

  @Post(':id/like')
  like(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.engagementService.like(
      membership.organizationId,
      id,
      membership.userId,
    );
  }

  @Delete(':id')
  delete(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.engagementService.delete(membership.organizationId, id);
  }
}
