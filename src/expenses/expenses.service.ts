import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { randomUUID } from 'node:crypto';

export type CreateExpenseDto = {
  title: string;
  category: 'Travel' | 'Food' | 'Fuel' | 'Hotel' | 'Client Dinner' | 'Misc';
  amount: number;
  date?: string;
  receiptName?: string;
  receiptUrl?: string;
};

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getAll(organizationId: string, status?: string) {

    const where: any = { organizationId };
    if (status && status !== 'ALL') {
      where.status = status;
    }

    const expenses = await this.prisma.expenseClaim.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return expenses.map((e) => ({
      id: e.id,
      title: e.title,
      category: e.category as 'Travel' | 'Food' | 'Fuel' | 'Hotel' | 'Client Dinner' | 'Misc',
      amount: e.amount,
      date: e.date || e.createdAt.toISOString().slice(0, 10),
      employee: e.employee || 'Employee',
      status: e.status as 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REIMBURSED',
      receiptName: e.receiptName || 'receipt.pdf',
      createdAt: e.createdAt.toISOString().slice(0, 10),
    }));
  }

  async create(organizationId: string, employeeName: string, dto: CreateExpenseDto) {
    if (!dto.title?.trim() || !dto.amount || dto.amount <= 0) {
      throw new BadRequestException('Expense title and positive amount are required.');
    }

    const created = await this.prisma.expenseClaim.create({
      data: {
        id: `exp-${randomUUID().slice(0, 8)}`,
        organizationId,
        title: dto.title.trim(),
        category: dto.category || 'Misc',
        amount: Number(dto.amount),
        date: dto.date || new Date().toISOString().slice(0, 10),
        employee: employeeName || 'Employee',
        status: 'SUBMITTED',
        receiptName: dto.receiptName || 'uploaded_receipt.pdf',
        receiptUrl: dto.receiptUrl || null,
      },
    });

    // Notify finance / managers
    const memberships = await this.prisma.membership.findMany({ where: { organizationId } });
    if (memberships.length > 0) {
      await this.notifications.createForMany(
        memberships.map((m) => m.userId),
        {
          organizationId,
          title: 'New Expense Claim Filed',
          body: `${employeeName} filed claim: ${created.title} (₹${created.amount}).`,
          kind: 'expenses',
          link: '/dashboard/expenses',
        },
      );
    }

    return {
      id: created.id,
      title: created.title,
      category: created.category as 'Travel' | 'Food' | 'Fuel' | 'Hotel' | 'Client Dinner' | 'Misc',
      amount: created.amount,
      date: created.date || created.createdAt.toISOString().slice(0, 10),
      employee: created.employee,
      status: created.status as 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REIMBURSED',
      receiptName: created.receiptName || 'receipt.pdf',
    };
  }

  async updateStatus(
    organizationId: string,
    id: string,
    status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REIMBURSED',
  ) {
    const existing = await this.prisma.expenseClaim.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Expense claim not found.');

    const updated = await this.prisma.expenseClaim.update({
      where: { id },
      data: { status },
    });

    return {
      id: updated.id,
      title: updated.title,
      category: updated.category as 'Travel' | 'Food' | 'Fuel' | 'Hotel' | 'Client Dinner' | 'Misc',
      amount: updated.amount,
      date: updated.date || updated.createdAt.toISOString().slice(0, 10),
      employee: updated.employee,
      status: updated.status as 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REIMBURSED',
      receiptName: updated.receiptName || 'receipt.pdf',
    };
  }

  async delete(organizationId: string, id: string) {
    const existing = await this.prisma.expenseClaim.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Expense claim not found.');

    await this.prisma.expenseClaim.delete({ where: { id } });
    return { ok: true };
  }
}
