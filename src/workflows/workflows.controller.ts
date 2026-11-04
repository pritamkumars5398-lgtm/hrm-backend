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
  WorkflowsService,
  type CreateWorkflowRuleDto,
} from './workflows.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('workflows')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Get()
  getAll(@CurrentMembership() membership: Membership) {
    return this.workflowsService.getAll(membership.organizationId);
  }

  @Post()
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateWorkflowRuleDto,
  ) {
    return this.workflowsService.create(membership.organizationId, dto);
  }

  @Patch(':id/toggle')
  toggleStatus(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.workflowsService.toggleStatus(membership.organizationId, id);
  }

  @Post(':id/test-run')
  testRun(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.workflowsService.testRun(membership.organizationId, id);
  }

  @Delete(':id')
  delete(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.workflowsService.delete(membership.organizationId, id);
  }
}
