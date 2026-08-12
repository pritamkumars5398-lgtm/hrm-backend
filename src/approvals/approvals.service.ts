import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { DecideApprovalDto } from './dto/approvals.dto';

function canDecide(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('approvals.manage') || permissions.includes('employees.manage') || permissions.includes('reports.view');
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async createApproval(
    organizationId: string,
    requesterId: string,
    sourceModule: string,
    sourceRecordId: string,
    title: string,
    details: string,
  ) {
    const employee = await this.prisma.employee.findUnique({ where: { id: requesterId } });
    const requesterName = employee ? `${employee.firstName} ${employee.lastName}` : 'System';

    const created = await this.prisma.approvalRequest.create({
      data: {
        id: `apr-${randomUUID().slice(0, 8)}`,
        organizationId,
        requesterId,
        requesterName,
        sourceModule,
        sourceRecordId,
        title,
        details,
        status: 'PENDING',
      },
    });

    // Notify managers who can decide on approvals
    const memberships = await this.prisma.membership.findMany({ where: { organizationId } });
    const managerUserIds = memberships
      .filter((m) => canDecide(m.permissions) && m.userId !== employee?.userId)
      .map((m) => m.userId);

    if (managerUserIds.length) {
      await this.notifications.createForMany(managerUserIds, {
        organizationId,
        title: 'New approval request awaiting decision',
        body: `Approval required: ${title}`,
        kind: 'approval',
        link: '/dashboard/approvals',
      });
    }

    return created;
  }

  async listPending(organizationId: string, permissions: string[]) {
    if (!canDecide(permissions)) {
      throw new ForbiddenException('You do not have permission to view pending approvals.');
    }

    return this.prisma.approvalRequest.findMany({
      where: { organizationId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async decideApproval(
    id: string,
    organizationId: string,
    permissions: string[],
    userId: string,
    dto: DecideApprovalDto,
  ) {
    if (!canDecide(permissions)) {
      throw new ForbiddenException('You do not have permission to decide on approvals.');
    }

    const request = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!request || request.organizationId !== organizationId) {
      throw new NotFoundException('Approval request not found.');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('This request has already been decided.');
    }

    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: {
        status: dto.status,
        rejectionReason: dto.rejectionReason ?? null,
      },
    });

    // Notify requester
    const requesterEmployee = await this.prisma.employee.findUnique({ where: { id: request.requesterId } });
    if (requesterEmployee) {
      await this.notifications.create({
        userId: requesterEmployee.userId,
        organizationId,
        title: dto.status === 'APPROVED' ? `${request.sourceModule} Approved` : `${request.sourceModule} Rejected`,
        body: `Your request "${request.title}" has been ${dto.status.toLowerCase()}.`,
        kind: request.sourceModule.toLowerCase(),
        link: `/dashboard/${request.sourceModule.toLowerCase()}s`,
      });
    }

    // Dynamic update on source record
    const sourceRecordId = request.sourceRecordId;
    const sourceModule = request.sourceModule;

    try {
      if (sourceModule === 'Leave') {
        const leave = await this.prisma.leaveRequest.findUnique({ where: { id: sourceRecordId } });
        if (leave && leave.status === 'PENDING') {
          await this.prisma.leaveRequest.update({
            where: { id: sourceRecordId },
            data: {
              status: dto.status,
              decidedByUserId: userId,
              decidedAt: new Date(),
            },
          });
        }
      } else if (sourceModule === 'Expense') {
        const expense = await this.prisma.expenseClaim.findUnique({ where: { id: sourceRecordId } });
        if (expense && expense.status === 'PENDING') {
          const history = JSON.parse(expense.historyJson || '[]');
          history.push({
            action: dto.status,
            userId,
            reason: dto.rejectionReason,
            timestamp: new Date().toISOString(),
          });

          await this.prisma.expenseClaim.update({
            where: { id: sourceRecordId },
            data: {
              status: dto.status,
              rejectionReason: dto.rejectionReason ?? null,
              historyJson: JSON.stringify(history),
            },
          });
        }
      } else if (sourceModule === 'Travel') {
        const travel = await this.prisma.travelRequest.findUnique({ where: { id: sourceRecordId } });
        if (travel && travel.status === 'PENDING') {
          await this.prisma.travelRequest.update({
            where: { id: sourceRecordId },
            data: {
              status: dto.status,
            },
          });
        }
      } else if (sourceModule === 'Recruitment') {
        // Assume JobRequisition approval
        const job = await this.prisma.jobRequisition.findUnique({ where: { id: sourceRecordId } });
        if (job && job.status === 'PENDING') {
          await this.prisma.jobRequisition.update({
            where: { id: sourceRecordId },
            data: {
              status: dto.status === 'APPROVED' ? 'PUBLISHED' : 'CLOSED',
            },
          });
        }
      }
    } catch (err) {
      console.error(`Failed to update original source module for ${sourceModule} ${sourceRecordId}:`, err);
    }

    return updated;
  }
}
