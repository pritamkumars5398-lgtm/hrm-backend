import { BadRequestException, Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { PayCycleService } from './pay-cycle.service';
import { UpdatePayCycleDto } from './dto/update-pay-cycle.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';
import type { PublicPayCycle } from './pay-cycle.entity';

function requireMembership(membership: Membership | undefined): Membership {
  if (!membership) {
    throw new BadRequestException('X-Workspace-Id header is required.');
  }
  return membership;
}

@Controller('payroll/pay-cycle')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayCycleController {
  constructor(private readonly payCycleService: PayCycleService) {}

  @Get()
  async get(@CurrentMembership() m: Membership | undefined): Promise<PublicPayCycle> {
    const membership = requireMembership(m);
    return this.payCycleService.get(membership.organizationId, membership.permissions);
  }

  @Patch()
  async update(
    @CurrentMembership() m: Membership | undefined,
    @Body() dto: UpdatePayCycleDto,
  ): Promise<PublicPayCycle> {
    const membership = requireMembership(m);
    return this.payCycleService.update(membership.organizationId, membership.permissions, dto);
  }
}
