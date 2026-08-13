import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TimesheetsService } from './timesheets.service';
import { SaveTimesheetDto, UpdateTimesheetStatusDto } from './dto/timesheets.dto';
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

@Controller('timesheets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TimesheetsController {
  constructor(private readonly timesheetsService: TimesheetsService) {}

  @Post()
  async saveTimesheet(
    @CurrentMembership() m: Membership | undefined,
    @Body() dto: SaveTimesheetDto,
  ) {
    const membership = requireMembership(m);
    return this.timesheetsService.saveTimesheet(membership.organizationId, membership.userId, dto);
  }

  @Get()
  async getTimesheet(
    @CurrentMembership() m: Membership | undefined,
    @Query('weekStartDate') weekStartDate: string,
  ) {
    const membership = requireMembership(m);
    if (!weekStartDate) {
      throw new BadRequestException('weekStartDate query parameter is required.');
    }
    return this.timesheetsService.getTimesheet(membership.organizationId, membership.userId, weekStartDate);
  }

  @Patch(':id/status')
  async updateTimesheetStatus(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateTimesheetStatusDto,
  ) {
    const membership = requireMembership(m);
    return this.timesheetsService.updateStatus(id, membership.organizationId, membership.userId, membership.permissions, dto.status);
  }

  @Get('all')
  async listAllTimesheets(@CurrentMembership() m: Membership | undefined) {
    const membership = requireMembership(m);
    return this.timesheetsService.listAll(membership.organizationId, membership.permissions);
  }
}
