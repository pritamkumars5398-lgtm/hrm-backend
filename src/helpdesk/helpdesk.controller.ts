import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { HelpdeskService, type CreateTicketDto } from './helpdesk.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('helpdesk')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HelpdeskController {
  constructor(private readonly helpdeskService: HelpdeskService) {}

  @Get()
  getAll(
    @CurrentMembership() membership: Membership,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.helpdeskService.getAll(membership.organizationId, search, status);
  }

  @Post()
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateTicketDto,
  ) {
    return this.helpdeskService.create(
      membership.organizationId,
      membership.jobTitle || 'Employee',
      dto,
    );
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body('status') status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED',
  ) {
    return this.helpdeskService.updateStatus(
      membership.organizationId,
      id,
      status,
    );
  }

  @Delete(':id')
  delete(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.helpdeskService.delete(membership.organizationId, id);
  }
}
