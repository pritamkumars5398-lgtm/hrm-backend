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
import {
  RecruitmentService,
  type CreateJobDto,
  type SubmitApplicationDto,
} from './recruitment.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('recruitment')
export class RecruitmentController {
  constructor(private readonly recruitmentService: RecruitmentService) {}

  // ---------------------------------------------------------------------------
  // Public APIs for Candidate Career Portal
  // ---------------------------------------------------------------------------

  @Get('public/jobs')
  getPublicJobs(
    @Query('search') search?: string,
    @Query('department') department?: string,
  ) {
    return this.recruitmentService.getPublicJobs(search, department);
  }

  @Get('public/jobs/:id')
  getPublicJobById(@Param('id') id: string) {
    return this.recruitmentService.getPublicJobById(id);
  }

  @Post('public/apply')
  submitPublicApplication(@Body() payload: SubmitApplicationDto) {
    return this.recruitmentService.submitPublicApplication(payload);
  }

  // ---------------------------------------------------------------------------
  // Protected ATS & Requisition Management APIs
  // ---------------------------------------------------------------------------

  @Get('jobs')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  getJobs(@CurrentMembership() membership: Membership) {
    return this.recruitmentService.getJobs(membership.organizationId);
  }

  @Post('jobs')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  createJob(
    @CurrentMembership() membership: Membership,
    @Body() payload: CreateJobDto,
  ) {
    return this.recruitmentService.createJob(membership.organizationId, payload);
  }

  @Patch('jobs/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  updateJob(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body() payload: Partial<CreateJobDto>,
  ) {
    return this.recruitmentService.updateJob(membership.organizationId, id, payload);
  }

  @Delete('jobs/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  deleteJob(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.recruitmentService.deleteJob(membership.organizationId, id);
  }

  @Get('applications')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  getApplications(
    @CurrentMembership() membership: Membership,
    @Query('jobPostingId') jobPostingId?: string,
    @Query('status') status?: string,
  ) {
    return this.recruitmentService.getApplications(
      membership.organizationId,
      jobPostingId,
      status,
    );
  }

  @Patch('applications/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  updateApplication(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body() payload: any,
  ) {
    return this.recruitmentService.updateApplication(
      membership.organizationId,
      id,
      payload,
    );
  }

  @Post('applications/:id/convert')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  convertToEmployee(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.recruitmentService.convertToEmployee(
      membership.organizationId,
      id,
    );
  }
}
