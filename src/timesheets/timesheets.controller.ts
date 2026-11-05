import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  TimesheetsService,
  type SaveTimesheetDto,
} from './timesheets.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('timesheets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TimesheetsController {
  constructor(private readonly timesheetsService: TimesheetsService) {}

  @Get('current')
  getCurrent(@CurrentMembership() membership: Membership) {
    return this.timesheetsService.getCurrentTimesheet(
      membership.organizationId,
      membership.userId,
      membership.jobTitle,
    );
  }

  @Get()
  getAll(@CurrentMembership() membership: Membership) {
    return this.timesheetsService.getAll(membership.organizationId);
  }

  @Post()
  save(
    @CurrentMembership() membership: Membership,
    @Body() dto: SaveTimesheetDto,
  ) {
    return this.timesheetsService.saveTimesheet(
      membership.organizationId,
      membership.userId,
      membership.jobTitle,
      dto,
    );
  }

  @Patch(':id/submit')
  submit(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.timesheetsService.submitTimesheet(
      membership.organizationId,
      id,
      membership.jobTitle,
    );
  }

  @Patch(':id/reject')
  reject(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.timesheetsService.rejectTimesheet(
      membership.organizationId,
      id,
      membership.jobTitle || 'Manager',
      reason || 'Adjustments required',
    );
  }

  @Patch(':id/approve')
  approve(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.timesheetsService.approveTimesheet(
      membership.organizationId,
      id,
      membership.jobTitle || 'Manager',
    );
  }
}
