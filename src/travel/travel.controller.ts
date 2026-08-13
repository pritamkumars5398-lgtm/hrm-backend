import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { TravelService } from './travel.service';
import { CreateTravelRequestDto, UpdateTravelBookingDto, CancelTravelDto } from './dto/travel.dto';
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

@Controller('travel')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TravelController {
  constructor(private readonly travelService: TravelService) {}

  @Post()
  async createTravel(
    @CurrentMembership() m: Membership | undefined,
    @Body() dto: CreateTravelRequestDto,
  ) {
    const membership = requireMembership(m);
    return this.travelService.createTravel(membership.organizationId, membership.userId, dto);
  }

  @Get()
  async listTravel(@CurrentMembership() m: Membership | undefined) {
    const membership = requireMembership(m);
    return this.travelService.listTravel(membership.organizationId, membership.userId);
  }

  @Get('all')
  async listAllTravel(@CurrentMembership() m: Membership | undefined) {
    const membership = requireMembership(m);
    return this.travelService.listAll(membership.organizationId, membership.permissions);
  }

  @Patch(':id/booking')
  async updateBooking(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateTravelBookingDto,
  ) {
    const membership = requireMembership(m);
    return this.travelService.updateBooking(id, membership.organizationId, membership.userId, membership.permissions, dto);
  }

  @Patch(':id/cancel')
  async cancelTravel(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
    @Body() dto: CancelTravelDto,
  ) {
    const membership = requireMembership(m);
    return this.travelService.cancelTravel(id, membership.organizationId, membership.userId, dto);
  }
}
