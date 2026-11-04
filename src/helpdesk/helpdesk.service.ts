import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { randomUUID } from 'node:crypto';

export type CreateTicketDto = {
  subject: string;
  category: 'HR' | 'IT' | 'Finance' | 'Admin';
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  notes?: string;
};

@Injectable()
export class HelpdeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getAll(organizationId: string, search?: string, status?: string) {

    const where: any = { organizationId };
    if (status && status !== 'ALL') {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        { ticketNo: { contains: search, mode: 'insensitive' } },
        { requestedBy: { contains: search, mode: 'insensitive' } },
      ];
    }

    const tickets = await this.prisma.helpdeskTicket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return tickets.map((t) => ({
      id: t.id,
      ticketNo: t.ticketNo,
      subject: t.subject,
      category: t.category as 'HR' | 'IT' | 'Finance' | 'Admin',
      priority: t.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
      status: t.status as 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED',
      requestedBy: t.requestedBy || 'Employee',
      assignedTo: t.assignedTo || 'Support Desk',
      slaHoursLeft: t.slaHoursLeft,
      createdAt: t.createdAt.toISOString().slice(0, 10),
    }));
  }

  async create(organizationId: string, employeeName: string, dto: CreateTicketDto) {
    if (!dto.subject?.trim() || !dto.category) {
      throw new BadRequestException('Ticket subject and category are required.');
    }

    const priority = dto.priority || 'MEDIUM';
    const sla = priority === 'URGENT' ? 4 : priority === 'HIGH' ? 8 : 24;

    const ticket = await this.prisma.helpdeskTicket.create({
      data: {
        id: `t-${randomUUID().slice(0, 8)}`,
        organizationId,
        ticketNo: `HD-${Math.floor(1000 + Math.random() * 9000)}`,
        subject: dto.subject.trim(),
        category: dto.category,
        priority,
        status: 'OPEN',
        requestedBy: employeeName || 'Employee',
        assignedTo: `${dto.category} Desk Lead`,
        slaHoursLeft: sla,
        notes: dto.notes || '',
      },
    });

    // Notify support desk / department
    const memberships = await this.prisma.membership.findMany({ where: { organizationId } });
    if (memberships.length > 0) {
      await this.notifications.createForMany(
        memberships.map((m) => m.userId),
        {
          organizationId,
          title: `New ${ticket.category} Ticket: ${ticket.ticketNo}`,
          body: `${ticket.subject} (Priority: ${ticket.priority})`,
          kind: 'helpdesk',
          link: '/dashboard/helpdesk',
        },
      );
    }

    return {
      id: ticket.id,
      ticketNo: ticket.ticketNo,
      subject: ticket.subject,
      category: ticket.category as 'HR' | 'IT' | 'Finance' | 'Admin',
      priority: ticket.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
      status: ticket.status as 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED',
      requestedBy: ticket.requestedBy,
      assignedTo: ticket.assignedTo,
      slaHoursLeft: ticket.slaHoursLeft,
      createdAt: ticket.createdAt.toISOString().slice(0, 10),
    };
  }

  async updateStatus(
    organizationId: string,
    id: string,
    status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED',
  ) {
    const existing = await this.prisma.helpdeskTicket.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Helpdesk ticket not found.');

    const updated = await this.prisma.helpdeskTicket.update({
      where: { id },
      data: {
        status,
        slaHoursLeft: status === 'RESOLVED' || status === 'CLOSED' ? 0 : existing.slaHoursLeft,
      },
    });

    return {
      id: updated.id,
      ticketNo: updated.ticketNo,
      subject: updated.subject,
      category: updated.category as 'HR' | 'IT' | 'Finance' | 'Admin',
      priority: updated.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
      status: updated.status as 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED',
      requestedBy: updated.requestedBy,
      assignedTo: updated.assignedTo,
      slaHoursLeft: updated.slaHoursLeft,
      createdAt: updated.createdAt.toISOString().slice(0, 10),
    };
  }

  async delete(organizationId: string, id: string) {
    const existing = await this.prisma.helpdeskTicket.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Helpdesk ticket not found.');

    await this.prisma.helpdeskTicket.delete({ where: { id } });
    return { ok: true };
  }
}
