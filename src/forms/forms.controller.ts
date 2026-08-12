import { BadRequestException, Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { FormsService } from './forms.service';
import { CreateFormDto, SubmitResponseDto } from './dto/forms.dto';
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

@Controller('forms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  @Post()
  async createForm(
    @CurrentMembership() m: Membership | undefined,
    @Body() dto: CreateFormDto,
  ) {
    const membership = requireMembership(m);
    return this.formsService.createForm(membership.organizationId, membership.permissions, dto);
  }

  @Get()
  async listForms(@CurrentMembership() m: Membership | undefined) {
    const membership = requireMembership(m);
    return this.formsService.listForms(membership.organizationId, membership.permissions);
  }

  @Delete(':id')
  async deleteForm(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
  ) {
    const membership = requireMembership(m);
    return this.formsService.deleteForm(id, membership.organizationId, membership.permissions);
  }

  @Post(':id/responses')
  async submitResponse(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
    @Body() dto: SubmitResponseDto,
  ) {
    const membership = requireMembership(m);
    return this.formsService.submitResponse(id, membership.organizationId, dto);
  }

  @Get(':id/responses')
  async listResponses(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
  ) {
    const membership = requireMembership(m);
    return this.formsService.listResponses(id, membership.organizationId, membership.permissions);
  }
}
