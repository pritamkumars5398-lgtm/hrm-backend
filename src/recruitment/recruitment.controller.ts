import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RecruitmentService } from './recruitment.service';
import { CreateJobDto, CreateCandidateDto, UpdateCandidateStageDto } from './dto/recruitment.dto';
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

@Controller('recruitment')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RecruitmentController {
  constructor(private readonly recruitmentService: RecruitmentService) {}

  @Post('jobs')
  async createJob(
    @CurrentMembership() m: Membership | undefined,
    @Body() dto: CreateJobDto,
  ) {
    const membership = requireMembership(m);
    return this.recruitmentService.createJob(membership.organizationId, membership.userId, membership.permissions, dto);
  }

  @Post('jobs/:id/submit')
  async submitRequisition(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
  ) {
    const membership = requireMembership(m);
    return this.recruitmentService.submitRequisition(id, membership.organizationId, membership.userId, membership.permissions);
  }

  @Get('jobs')
  async listJobs(@CurrentMembership() m: Membership | undefined) {
    const membership = requireMembership(m);
    return this.recruitmentService.listJobs(membership.organizationId, membership.permissions);
  }

  @Post('candidates')
  async createCandidate(
    @CurrentMembership() m: Membership | undefined,
    @Body() dto: CreateCandidateDto,
  ) {
    const membership = requireMembership(m);
    return this.recruitmentService.createCandidate(membership.organizationId, membership.userId, membership.permissions, dto);
  }

  @Get('candidates')
  async listCandidates(@CurrentMembership() m: Membership | undefined) {
    const membership = requireMembership(m);
    return this.recruitmentService.listCandidates(membership.organizationId, membership.permissions);
  }

  @Patch('candidates/:id/stage')
  async updateCandidateStage(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateCandidateStageDto,
  ) {
    const membership = requireMembership(m);
    return this.recruitmentService.updateCandidateStage(
      id,
      membership.organizationId,
      membership.userId,
      membership.permissions,
      dto.stage,
    );
  }
}
