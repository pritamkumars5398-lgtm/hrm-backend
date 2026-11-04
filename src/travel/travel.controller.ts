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
import { TravelService, type CreateTravelDto } from './travel.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('travel')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TravelController {
  constructor(private readonly travelService: TravelService) {}

  @Get()
  getAll(
    @CurrentMembership() membership: Membership,
    @Query('status') status?: string,
  ) {
    return this.travelService.getAll(membership.organizationId, status);
  }

  @Post()
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateTravelDto,
  ) {
    return this.travelService.create(
      membership.organizationId,
      membership.jobTitle || 'Employee',
      dto,
    );
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body('status') status: 'PENDING' | 'APPROVED' | 'BOOKED' | 'REJECTED',
  ) {
    return this.travelService.updateStatus(
      membership.organizationId,
      id,
      status,
    );
  }

  @Delete(':id')
  delete(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.travelService.delete(membership.organizationId, id);
  }
}
