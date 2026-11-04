import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ComplianceService,
  type CreateComplianceDto,
} from './compliance.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('compliance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get()
  getAll(@CurrentMembership() membership: Membership) {
    return this.complianceService.getAll(membership.organizationId);
  }

  @Post()
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateComplianceDto,
  ) {
    return this.complianceService.create(membership.organizationId, dto);
  }

  @Patch(':id/filed')
  markFiled(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body('acknowledgementNo') ackNo?: string,
  ) {
    return this.complianceService.markFiled(
      membership.organizationId,
      id,
      ackNo,
    );
  }

  @Get('export/ecr')
  exportEcr(@CurrentMembership() membership: Membership) {
    return this.complianceService.exportEcr(membership.organizationId);
  }

  @Delete(':id')
  delete(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.complianceService.delete(membership.organizationId, id);
  }
}
