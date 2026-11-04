import { BadRequestException, Body, Controller, Get, HttpCode, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';
import type { PublicAttendanceMonth } from './attendance.entity';
import type { PublicAttendanceSettings } from './attendance-settings.entity';
import { PunchDto, UpdateAttendanceSettingsDto } from './dto/attendance-settings.dto';

/** No `@RequirePermission` on this controller's endpoints means the guard never
 *  requires `request.membership` to be set — same gap `organizations.controller.ts`
 *  already guards against. Do the same check by hand here. */
function requireMembership(membership: Membership | undefined): Membership {
  if (!membership) {
    throw new BadRequestException('X-Workspace-Id header is required.');
  }
  return membership;
}

/**
 * Deliberately NOT permission-gated with `@RequirePermission` — attendance
 * self-service (check in/out, see your own history) is a baseline every member
 * gets, same as Dashboard. `attendance.manage` only changes what `getMonth`
 * returns (company-wide vs. just you) — decided server-side in the service,
 * never trusted from the client.
 */
@Controller('attendance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('check-in')
  @HttpCode(200)
  async checkIn(@CurrentMembership() m: Membership | undefined, @Body() punch: PunchDto): Promise<{ ok: true }> {
    const membership = requireMembership(m);
    await this.attendanceService.checkIn(membership.userId, membership.organizationId, punch);
    return { ok: true };
  }

  @Post('check-out')
  @HttpCode(200)
  async checkOut(@CurrentMembership() m: Membership | undefined, @Body() punch: PunchDto): Promise<{ ok: true }> {
    const membership = requireMembership(m);
    await this.attendanceService.checkOut(membership.userId, membership.organizationId, punch);
    return { ok: true };
  }

  @Get('settings')
  async getSettings(@CurrentMembership() m: Membership | undefined): Promise<PublicAttendanceSettings> {
    const membership = requireMembership(m);
    return this.attendanceService.getSettings(membership.organizationId);
  }

  @Patch('settings')
  async updateSettings(
    @CurrentMembership() m: Membership | undefined,
    @Body() dto: UpdateAttendanceSettingsDto,
  ): Promise<PublicAttendanceSettings> {
    const membership = requireMembership(m);
    return this.attendanceService.updateSettings(membership.organizationId, membership.permissions, dto);
  }

  @Get('month')
  async getMonth(
    @CurrentMembership() m: Membership | undefined,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('selectedDate') selectedDate?: string,
    @Query('employeeId') employeeId?: string,
  ): Promise<PublicAttendanceMonth> {
    const membership = requireMembership(m);
    return this.attendanceService.getMonth({
      userId: membership.userId,
      organizationId: membership.organizationId,
      permissions: membership.permissions,
      year: Number(year),
      month: Number(month),
      selectedDate,
      employeeId,
    });
  }
}
