import { Controller, Get, Post, Body, Patch, Param, Req, UseGuards, Query, NotFoundException } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';
import {
  CreateFrameworkDto,
  CreateRequirementDto,
  CreateExceptionDto,
  UpdateViolationDto,
  CreateRiskDto,
  AcknowledgePolicyDto,
  UpdateCourseProgressDto,
  CreateComplianceTaskDto,
  UpdateComplianceTaskStatusDto,
} from './dto/compliance.dto';

@Controller('compliance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  // ==========================================
  // 1. DASHBOARD OVERVIEW
  // ==========================================

  @Get('dashboard')
  @RequirePermission('compliance.view')
  getDashboard(@CurrentMembership() membership: Membership) {
    return this.complianceService.getDashboard(membership.organizationId);
  }

  // ==========================================
  // 2. FRAMEWORKS
  // ==========================================

  @Get('frameworks')
  @RequirePermission('compliance.view')
  listFrameworks(@CurrentMembership() membership: Membership) {
    return this.complianceService.listFrameworks(membership.organizationId);
  }

  @Post('frameworks')
  @RequirePermission('compliance.manage')
  createFramework(@CurrentMembership() membership: Membership, @Body() dto: CreateFrameworkDto) {
    return this.complianceService.createFramework(membership.organizationId, dto);
  }

  // ==========================================
  // 3. REQUIREMENTS
  // ==========================================

  @Get('requirements')
  @RequirePermission('compliance.view')
  listRequirements(@CurrentMembership() membership: Membership) {
    return this.complianceService.listRequirements(membership.organizationId);
  }

  @Post('requirements')
  @RequirePermission('compliance.manage')
  createRequirement(@CurrentMembership() membership: Membership, @Body() dto: CreateRequirementDto) {
    return this.complianceService.createRequirement(membership.organizationId, dto);
  }

  // ==========================================
  // 4. OBLIGATIONS
  // ==========================================

  @Get('obligations')
  @RequirePermission('compliance.view')
  listObligations(@CurrentMembership() membership: Membership) {
    return this.complianceService.prisma.complianceObligation.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: { lastEvaluatedAt: 'desc' },
    });
  }

  @Get('obligations/my-obligations')
  @RequirePermission('compliance.view')
  async listMyObligations(@CurrentMembership() membership: Membership) {
    const employee = await this.complianceService.prisma.employee.findFirst({
      where: { organizationId: membership.organizationId, userId: membership.userId },
    });
    if (!employee) return [];

    return this.complianceService.prisma.complianceObligation.findMany({
      where: { organizationId: membership.organizationId, targetType: 'EMPLOYEE', targetId: employee.id },
      orderBy: { dueDate: 'asc' },
    });
  }

  // ==========================================
  // 5. VIOLATIONS
  // ==========================================

  @Get('violations')
  @RequirePermission('compliance.view')
  listViolations(@CurrentMembership() membership: Membership) {
    return this.complianceService.listViolations(membership.organizationId);
  }

  @Patch('violations/:id')
  @RequirePermission('compliance.manage')
  updateViolation(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body() dto: UpdateViolationDto,
  ) {
    return this.complianceService.updateViolation(id, membership.organizationId, membership.userId, dto);
  }

  // ==========================================
  // 6. EXCEPTIONS / WAIVERS
  // ==========================================

  @Get('exceptions')
  @RequirePermission('compliance.view')
  listExceptions(@CurrentMembership() membership: Membership) {
    return this.complianceService.listExceptions(membership.organizationId);
  }

  @Post('exceptions')
  @RequirePermission('compliance.view')
  requestException(@CurrentMembership() membership: Membership, @Body() dto: CreateExceptionDto) {
    return this.complianceService.requestException(membership.organizationId, membership.userId, dto);
  }

  // ==========================================
  // 7. TASKS
  // ==========================================

  @Get('tasks')
  @RequirePermission('compliance.view')
  listTasks(@CurrentMembership() membership: Membership) {
    return this.complianceService.listTasks(membership.organizationId);
  }

  @Post('tasks')
  @RequirePermission('compliance.manage')
  createTask(@CurrentMembership() membership: Membership, @Body() dto: CreateComplianceTaskDto) {
    return this.complianceService.createTask(
      membership.organizationId,
      dto.obligationId ?? null,
      dto.assignedToId,
      dto.title,
      dto.description ?? '',
      dto.priority,
      dto.dueDate,
    );
  }

  @Patch('tasks/:id')
  @RequirePermission('compliance.view')
  updateTaskStatus(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body() dto: UpdateComplianceTaskStatusDto,
  ) {
    return this.complianceService.updateTaskStatus(id, membership.organizationId, dto.status, dto.evidenceUrl);
  }

  // ==========================================
  // 8. RISKS
  // ==========================================

  @Get('risks')
  @RequirePermission('compliance.view')
  listRisks(@CurrentMembership() membership: Membership) {
    return this.complianceService.listRisks(membership.organizationId);
  }

  @Post('risks')
  @RequirePermission('compliance.manage')
  createRisk(@CurrentMembership() membership: Membership, @Body() dto: CreateRiskDto) {
    return this.complianceService.createRisk(membership.organizationId, dto);
  }

  // ==========================================
  // 9. LMS TRAINING PROGRESS
  // ==========================================

  @Get('courses/my-courses')
  @RequirePermission('compliance.view')
  async listMyCourses(@CurrentMembership() membership: Membership) {
    const employee = await this.complianceService.prisma.employee.findFirst({
      where: { organizationId: membership.organizationId, userId: membership.userId },
    });
    if (!employee) return [];

    return this.complianceService.listMyCourses(membership.organizationId, employee.id);
  }

  @Post('courses/:id/progress')
  @RequirePermission('compliance.view')
  async updateCourseProgress(
    @CurrentMembership() membership: Membership,
    @Param('id') courseId: string,
    @Body() dto: UpdateCourseProgressDto,
  ) {
    const employee = await this.complianceService.prisma.employee.findFirst({
      where: { organizationId: membership.organizationId, userId: membership.userId },
    });
    if (!employee) {
      throw new NotFoundException('Employee profile not found.');
    }

    return this.complianceService.updateCourseProgress(membership.organizationId, employee.id, courseId, dto);
  }

  // ==========================================
  // 10. POLICY ACKNOWLEDGEMENT
  // ==========================================

  @Post('policies/acknowledge')
  @RequirePermission('compliance.view')
  async acknowledgePolicy(@CurrentMembership() membership: Membership, @Body() dto: AcknowledgePolicyDto) {
    const employee = await this.complianceService.prisma.employee.findFirst({
      where: { organizationId: membership.organizationId, userId: membership.userId },
    });
    if (!employee) {
      throw new NotFoundException('Employee profile not found.');
    }

    return this.complianceService.acknowledgePolicy(membership.organizationId, employee.id, dto);
  }
}
