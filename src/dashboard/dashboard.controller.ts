import { BadRequestException, Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';
import type { DashboardData } from './dashboard.entity';

function requireMembership(membership: Membership | undefined): Membership {
  if (!membership) {
    throw new BadRequestException('X-Workspace-Id header is required.');
  }
  return membership;
}

/**
 * No dedicated permission (§4.7) — Dashboard is every role's landing page.
 * Each tile and activity row is individually gated inside the service by the
 * caller's real permissions for the module it summarises.
 */
@Controller('dashboard')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  get(@CurrentMembership() m: Membership | undefined): Promise<DashboardData> {
    const membership = requireMembership(m);
    return this.dashboardService.get(membership.organizationId, membership.userId, membership.permissions);
  }
}
