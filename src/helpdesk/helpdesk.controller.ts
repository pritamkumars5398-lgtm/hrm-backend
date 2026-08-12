import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { HelpdeskService } from './helpdesk.service';
import { CreateTicketDto, UpdateTicketStatusDto, AddCommentDto } from './dto/helpdesk.dto';
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

@Controller('helpdesk')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HelpdeskController {
  constructor(private readonly helpdeskService: HelpdeskService) {}

  @Post()
  async createTicket(
    @CurrentMembership() m: Membership | undefined,
    @Body() dto: CreateTicketDto,
  ) {
    const membership = requireMembership(m);
    return this.helpdeskService.createTicket(membership.organizationId, membership.userId, dto);
  }

  @Get()
  async listTickets(@CurrentMembership() m: Membership | undefined) {
    const membership = requireMembership(m);
    return this.helpdeskService.listTickets(membership.organizationId, membership.userId);
  }

  @Get('all')
  async listAllTickets(@CurrentMembership() m: Membership | undefined) {
    const membership = requireMembership(m);
    return this.helpdeskService.listAll(membership.organizationId, membership.permissions);
  }

  @Patch(':id/status')
  async updateTicketStatus(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateTicketStatusDto,
  ) {
    const membership = requireMembership(m);
    return this.helpdeskService.updateTicketStatus(id, membership.organizationId, membership.permissions, membership.userId, dto);
  }

  @Post(':id/comment')
  async addComment(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
  ) {
    const membership = requireMembership(m);
    return this.helpdeskService.addComment(id, membership.organizationId, membership.userId, dto);
  }
}
