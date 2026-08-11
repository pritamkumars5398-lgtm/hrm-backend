import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  UseGuards,
  Headers,
  BadRequestException,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { JwtPayload } from '../common/jwt-payload';
import type { Membership } from '../users/user.entity';
import type { PublicEmployee } from './employee.entity';

/**
 * Read-only directory over the Employee identity records created on invite.
 * Guarded by `employees.view` and scoped to the caller's active company via the
 * X-Workspace-Id membership — the same access-control spine every module uses.
 */
@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(
    @CurrentUser() user: JwtPayload,
    @Headers('x-workspace-id') organizationId?: string,
  ): Promise<PublicEmployee> {
    if (!organizationId) {
      throw new BadRequestException('X-Workspace-Id header is required.');
    }
    return this.employeesService.findByUserId(user.sub, organizationId);
  }

  @Get()
  @RequirePermission('employees.view')
  list(
    @CurrentMembership() membership: Membership,
    @Query('status') status?: 'ACTIVE' | 'INACTIVE' | 'ALL',
  ): Promise<PublicEmployee[]> {
    return this.employeesService.findByOrganization(membership.organizationId, status);
  }

  @Get(':id')
  @RequirePermission('employees.view')
  getOne(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ): Promise<PublicEmployee> {
    return this.employeesService.findOne(id, membership.organizationId);
  }

  @Patch(':id')
  @RequirePermission('employees.manage')
  update(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<PublicEmployee> {
    return this.employeesService.update(id, membership.organizationId, dto, membership.userId);
  }

  @Delete(':id')
  @RequirePermission('employees.manage')
  @HttpCode(200)
  async remove(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.employeesService.remove(id, membership.organizationId, membership.userId);
    return { ok: true };
  }

  @Get(':id/attendance')
  @RequirePermission('employees.view')
  async getAttendance(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.prisma.attendanceRecord.findMany({
      where: { employeeId: id, organizationId: membership.organizationId },
      orderBy: { date: 'desc' },
    });
  }

  @Get(':id/leave')
  @RequirePermission('employees.view')
  async getLeave(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.prisma.leaveRequest.findMany({
      where: { employeeId: id, organizationId: membership.organizationId },
      orderBy: { startDate: 'desc' },
    });
  }

  @Get(':id/payroll')
  @RequirePermission('employees.view')
  async getPayroll(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.prisma.payslip.findMany({
      where: { employeeId: id, organizationId: membership.organizationId },
      orderBy: { month: 'desc' },
    });
  }

  @Get(':id/performance')
  @RequirePermission('employees.view')
  async getPerformance(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    const [goals, reviews] = await Promise.all([
      this.prisma.goal.findMany({
        where: { employeeId: id, organizationId: membership.organizationId },
        orderBy: { dueOn: 'desc' },
      }),
      this.prisma.review.findMany({
        where: { employeeId: id, organizationId: membership.organizationId },
        orderBy: { cycleId: 'desc' },
      }),
    ]);
    return { goals, reviews };
  }

  @Get(':id/documents')
  @RequirePermission('employees.view')
  async getDocuments(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.prisma.document.findMany({
      where: { employeeId: id, organizationId: membership.organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id/history')
  @RequirePermission('employees.view')
  async getHistory(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee || employee.organizationId !== membership.organizationId) {
      throw new NotFoundException('That employee could not be found.');
    }

    const auditLogs = await this.prisma.auditLog.findMany({
      where: {
        organizationId: membership.organizationId,
        OR: [
          { resourceId: id },
          { userId: employee.userId },
        ],
      },
      orderBy: { timestamp: 'desc' },
    });

    const joinedAt = employee.startDate.toISOString();

    return {
      employmentHistory: [
        {
          id: `${employee.id}-joined`,
          date: joinedAt,
          title: 'Joined the company',
          detail: employee.jobTitle ? `Started as ${employee.jobTitle}.` : 'Joined the company.',
        },
      ],
      auditLogs,
    };
  }
}
