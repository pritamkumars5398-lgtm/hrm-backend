import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { toCsv } from './reports.entity';
import type { ReportsData } from './reports.entity';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @RequirePermission('reports.view')
  get(@CurrentMembership() membership: Membership): Promise<ReportsData> {
    return this.reportsService.get(membership.organizationId, membership.permissions);
  }

  @Get('export')
  @RequirePermission('reports.view')
  async export(@CurrentMembership() membership: Membership, @Res({ passthrough: true }) res: Response): Promise<string> {
    const data = await this.reportsService.get(membership.organizationId, membership.permissions);
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', 'attachment; filename="reports.csv"');
    return toCsv(data);
  }
}
