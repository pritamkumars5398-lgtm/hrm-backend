import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

/**
 * Read-only audit log viewer. Requires `settings.manage` — only Owners and
 * admins can see this. Logs themselves are written by PermissionsGuard and
 * writeAuditLog() and are NEVER exposed for mutation via any API route.
 */
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('settings.manage')
  async list(
    @CurrentMembership() membership: Membership,
    @Query('resource') resource?: string,
    @Query('result') result?: string,
    @Query('userEmail') userEmail?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(parseInt(limit ?? '100', 10), 500);

    const where: any = { organizationId: membership.organizationId };

    if (resource) where.resource = { contains: resource, mode: 'insensitive' };
    if (result && (result === 'ALLOW' || result === 'DENY')) where.result = result;
    if (userEmail) where.userEmail = { contains: userEmail, mode: 'insensitive' };
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = new Date(from);
      if (to) where.timestamp.lte = new Date(to);
    }

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take,
      select: {
        id: true,
        userEmail: true,
        action: true,
        resource: true,
        resourceId: true,
        result: true,
        timestamp: true,
        // details excluded from list view — can be verbose; only shown in detail
      },
    });

    return { logs, total: logs.length };
  }
}
