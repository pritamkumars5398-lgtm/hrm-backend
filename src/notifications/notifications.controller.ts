import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { RegisterTokenDto } from './dto/register-token.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { JwtPayload } from '../common/jwt-payload';
import type { Membership } from '../users/user.entity';
import type { PublicNotification } from './notification.entity';

function requireMembership(membership: Membership | undefined): Membership {
  if (!membership) {
    throw new BadRequestException('X-Workspace-Id header is required.');
  }
  return membership;
}

/**
 * No `@RequirePermission` — every signed-in member reads and manages their
 * own notifications, same baseline pattern as Leave/Dashboard. There is
 * nothing here to gate: a notification only ever belongs to the caller.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  get(@CurrentMembership() m: Membership | undefined): Promise<{ notifications: PublicNotification[]; unreadCount: number }> {
    const membership = requireMembership(m);
    return this.notificationsService.list(membership.userId, membership.organizationId);
  }

  @Post(':id/read')
  @HttpCode(200)
  async markRead(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<{ ok: true }> {
    await this.notificationsService.markRead(id, payload.sub);
    return { ok: true };
  }

  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@CurrentMembership() m: Membership | undefined): Promise<{ ok: true }> {
    const membership = requireMembership(m);
    await this.notificationsService.markAllRead(membership.userId, membership.organizationId);
    return { ok: true };
  }

  /** Not org-scoped — a device's push token belongs to the account, not any
   *  one company, so this is the one route here that doesn't need a
   *  membership at all, just a signed-in user. */
  @Post('register-token')
  @HttpCode(200)
  async registerToken(@CurrentUser() payload: JwtPayload, @Body() dto: RegisterTokenDto): Promise<{ ok: true }> {
    await this.notificationsService.registerToken(payload.sub, dto.token);
    return { ok: true };
  }
}
