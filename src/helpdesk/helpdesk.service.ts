import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { writeAuditLog } from '../common/audit-log';
import type { CreateTicketDto, UpdateTicketStatusDto, AddCommentDto } from './dto/helpdesk.dto';

function canManage(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('helpdesk.manage') || permissions.includes('reports.view');
}

@Injectable()
export class HelpdeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

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
    const count = await this.prisma.helpdeskTicket.count({ where: { organizationId } });
    const ticketNo = `HD-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

    const ticket = await this.prisma.helpdeskTicket.create({
      data: {
        id: `tkt-${randomUUID().slice(0, 8)}`,
        organizationId,
        employeeId: employee.id,
        ticketNo,
        subject: dto.subject.trim(),
        description: dto.description?.trim() ?? '',
        category: dto.category,
        priority: dto.priority,
        status: 'OPEN',
        assignedToId: null,
        resolution: null,
        commentsJson: '[]',
        attachmentsJson: '[]',
      },
    });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'CREATE',
      resource: 'HelpdeskTicket',
      resourceId: ticket.id,
      result: 'ALLOW',
      details: { ticketNo, subject: dto.subject, category: dto.category, priority: dto.priority },
    });

    // Notify helpdesk managers
    const memberships = await this.prisma.membership.findMany({ where: { organizationId } });
    const managerUserIds = memberships
      .filter((m) => canManage(m.permissions) && m.userId !== userId)
      .map((m) => m.userId);

    if (managerUserIds.length) {
      await this.notifications.createForMany(managerUserIds, {
        organizationId,
        title: `New ${dto.priority} Helpdesk Ticket (${ticketNo})`,
        body: `${employee.firstName} ${employee.lastName} raised: "${dto.subject}"`,
        kind: 'employee',
        link: '/dashboard/helpdesk',
      });
    }

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
      ticketNo: t.ticketNo ?? `HD-${new Date(t.createdAt).getFullYear()}-${t.id.slice(-4).toUpperCase()}`,
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

    const employee = await this.getEmployee(userId, organizationId);
    const isOwner = ticket.employeeId === employee.id;

    if (!isOwner && !canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage this ticket.');
    }

    // Status state transition validations
    if (ticket.status === 'CLOSED' && dto.status !== 'CLOSED' && dto.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Closed tickets can only be reopened into IN_PROGRESS status.');
    }

    if (dto.status === 'RESOLVED' && !dto.resolution && !ticket.resolution) {
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
        resolution: dto.resolution || ticket.resolution || null,
      },
    });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'UPDATE',
      resource: 'HelpdeskTicket',
      resourceId: id,
      result: 'ALLOW',
      details: { status: dto.status, resolution: dto.resolution },
    });

    // Notify ticket creator when status changes
    const creator = await this.prisma.employee.findUnique({ where: { id: ticket.employeeId } });
    if (creator?.userId && creator.userId !== userId) {
      await this.notifications.create({
        userId: creator.userId,
        organizationId,
        title: `Ticket ${dto.status === 'RESOLVED' ? 'Resolved' : 'Updated'}: ${ticket.subject}`,
        body: dto.status === 'RESOLVED'
          ? `Your ticket has been resolved: ${dto.resolution || ticket.resolution}`
          : `Your ticket status changed to ${dto.status.replace('_', ' ')}.`,
        kind: 'employee',
        link: '/dashboard/helpdesk',
      });
    }

    return {
      ...updated,
      ticketNo: updated.ticketNo ?? `HD-${new Date(updated.createdAt).getFullYear()}-${updated.id.slice(-4).toUpperCase()}`,
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
      data: { commentsJson: JSON.stringify(comments) },
    });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'UPDATE',
      resource: 'HelpdeskTicket',
      resourceId: id,
      result: 'ALLOW',
      details: { action: 'ADD_COMMENT', commentSnippet: dto.comment.slice(0, 40) },
    });

    // Notify the ticket creator if someone else comments
    const creator = await this.prisma.employee.findUnique({ where: { id: ticket.employeeId } });
    if (creator?.userId && creator.userId !== userId) {
      await this.notifications.create({
        userId: creator.userId,
        organizationId,
        title: 'New comment on your ticket',
        body: `${author} commented on "${ticket.subject}": ${dto.comment.slice(0, 80)}`,
        kind: 'employee',
        link: '/dashboard/helpdesk',
      });
    }

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

    const allEmployees = await this.prisma.employee.findMany({ where: { organizationId } });
    const employees = allEmployees.filter((e) => !e.deletedAt);

    return tickets.map((t) => {
      const creator = employees.find((e) => e.id === t.employeeId);
      const assignee = employees.find((e) => e.id === t.assignedToId);
      return {
        ...t,
        ticketNo: t.ticketNo ?? `HD-${new Date(t.createdAt).getFullYear()}-${t.id.slice(-4).toUpperCase()}`,
        employeeName: creator ? `${creator.firstName} ${creator.lastName}` : 'Unknown Employee',
        assignedToName: assignee ? `${assignee.firstName} ${assignee.lastName}` : 'Unassigned',
        comments: JSON.parse(t.commentsJson || '[]'),
        attachments: JSON.parse(t.attachmentsJson || '[]'),
      };
    });
  }
}
