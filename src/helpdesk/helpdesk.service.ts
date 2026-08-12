import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateTicketDto, UpdateTicketStatusDto, AddCommentDto } from './dto/helpdesk.dto';

function canManage(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('helpdesk.manage') || permissions.includes('reports.view');
}

@Injectable()
export class HelpdeskService {
  constructor(private readonly prisma: PrismaService) {}

  private async getEmployee(userId: string, organizationId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { userId, organizationId },
    });
    if (!employee || employee.deletedAt) {
      throw new NotFoundException('Employee profile not found.');
    }
    return employee;
  }

  async createTicket(organizationId: string, userId: string, dto: CreateTicketDto) {
    const employee = await this.getEmployee(userId, organizationId);

    const ticket = await this.prisma.helpdeskTicket.create({
      data: {
        id: `tkt-${randomUUID().slice(0, 8)}`,
        organizationId,
        employeeId: employee.id,
        subject: dto.subject.trim(),
        description: dto.description.trim(),
        category: dto.category,
        priority: dto.priority,
        status: 'OPEN',
        assignedToId: null,
        resolution: null,
        commentsJson: '[]',
        attachmentsJson: '[]',
      },
    });

    return {
      ...ticket,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      comments: [],
      attachments: [],
    };
  }

  async listTickets(organizationId: string, userId: string) {
    const employee = await this.getEmployee(userId, organizationId);

    const tickets = await this.prisma.helpdeskTicket.findMany({
      where: { employeeId: employee.id, organizationId },
      orderBy: { createdAt: 'desc' },
    });

    return tickets.map((t) => ({
      ...t,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      comments: JSON.parse(t.commentsJson || '[]'),
      attachments: JSON.parse(t.attachmentsJson || '[]'),
    }));
  }

  async updateTicketStatus(
    id: string,
    organizationId: string,
    permissions: string[],
    userId: string,
    dto: UpdateTicketStatusDto,
  ) {
    const ticket = await this.prisma.helpdeskTicket.findUnique({ where: { id } });
    if (!ticket || ticket.organizationId !== organizationId) {
      throw new NotFoundException('Ticket not found.');
    }

    // Only support updates by ticket manager or the ticket creator themselves
    const employee = await this.getEmployee(userId, organizationId);
    const isOwner = ticket.employeeId === employee.id;

    if (!isOwner && !canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage this ticket.');
    }

    if (dto.status === 'RESOLVED' && !dto.resolution) {
      throw new BadRequestException('Resolution detail is required when marking ticket resolved.');
    }

    let assignedToId = ticket.assignedToId;
    if (dto.assignedToId) {
      const targetEmp = await this.prisma.employee.findUnique({ where: { id: dto.assignedToId } });
      if (!targetEmp || targetEmp.organizationId !== organizationId || targetEmp.deletedAt) {
        throw new NotFoundException('Assigned employee not found.');
      }
      assignedToId = dto.assignedToId;
    }

    const updated = await this.prisma.helpdeskTicket.update({
      where: { id },
      data: {
        status: dto.status,
        assignedToId,
        resolution: dto.resolution || null,
      },
    });

    return {
      ...updated,
      comments: JSON.parse(updated.commentsJson || '[]'),
      attachments: JSON.parse(updated.attachmentsJson || '[]'),
    };
  }

  async addComment(id: string, organizationId: string, userId: string, dto: AddCommentDto) {
    const ticket = await this.prisma.helpdeskTicket.findUnique({ where: { id } });
    if (!ticket || ticket.organizationId !== organizationId) {
      throw new NotFoundException('Ticket not found.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const author = user?.name || 'User';

    const comments = JSON.parse(ticket.commentsJson || '[]');
    const newComment = {
      id: `cmt-${randomUUID().slice(0, 8)}`,
      author,
      comment: dto.comment.trim(),
      timestamp: new Date().toISOString(),
    };
    comments.push(newComment);

    const updated = await this.prisma.helpdeskTicket.update({
      where: { id },
      data: {
        commentsJson: JSON.stringify(comments),
      },
    });

    return JSON.parse(updated.commentsJson);
  }

  async listAll(organizationId: string, permissions: string[]) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to view all helpdesk tickets.');
    }

    const tickets = await this.prisma.helpdeskTicket.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const allEmployees = await this.prisma.employee.findMany({
      where: { organizationId },
    });
    const employees = allEmployees.filter((e) => !e.deletedAt);

    return tickets.map((t) => {
      const creator = employees.find((e) => e.id === t.employeeId);
      const employeeName = creator ? `${creator.firstName} ${creator.lastName}` : 'Unknown Employee';

      const assignee = employees.find((e) => e.id === t.assignedToId);
      const assignedToName = assignee ? `${assignee.firstName} ${assignee.lastName}` : 'Unassigned';

      return {
        ...t,
        employeeName,
        assignedToName,
        comments: JSON.parse(t.commentsJson || '[]'),
        attachments: JSON.parse(t.attachmentsJson || '[]'),
      };
    });
  }
}
