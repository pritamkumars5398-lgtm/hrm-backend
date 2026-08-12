import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import type { CreateExpenseClaimDto } from './dto/expenses.dto';

function canManage(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('expenses.manage') || permissions.includes('reports.view');
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
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

  async createExpense(organizationId: string, userId: string, dto: CreateExpenseClaimDto) {
    const employee = await this.getEmployee(userId, organizationId);

    const claim = await this.prisma.expenseClaim.create({
      data: {
        id: `exp-${randomUUID().slice(0, 8)}`,
        organizationId,
        employeeId: employee.id,
        title: dto.title.trim(),
        category: dto.category,
        amount: dto.amount,
        status: 'PENDING',
        receiptUrl: dto.receiptUrl || null,
        claimDate: dto.claimDate,
        rejectionReason: null,
        historyJson: JSON.stringify([{
          action: 'CREATED',
          userId,
          timestamp: new Date().toISOString(),
        }]),
      },
    });

    // Register centralized approval
    await this.approvals.createApproval(
      organizationId,
      employee.id,
      'Expense',
      claim.id,
      `Expense: ${dto.title} (${dto.category}) - ${employee.firstName} ${employee.lastName}`,
      `Amount: $${dto.amount} | Date: ${dto.claimDate} | Category: ${dto.category}`,
    );

    return {
      ...claim,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      history: JSON.parse(claim.historyJson),
    };
  }

  async listExpenses(organizationId: string, userId: string) {
    const employee = await this.getEmployee(userId, organizationId);

    const claims = await this.prisma.expenseClaim.findMany({
      where: { employeeId: employee.id, organizationId },
      orderBy: { createdAt: 'desc' },
    });

    return claims.map((c) => ({
      ...c,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      history: JSON.parse(c.historyJson || '[]'),
    }));
  }

  async listAll(organizationId: string, permissions: string[]) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to view all expense claims.');
    }

    const claims = await this.prisma.expenseClaim.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const allEmployees = await this.prisma.employee.findMany({
      where: { organizationId },
    });
    const employees = allEmployees.filter((e) => !e.deletedAt);

    return claims.map((c) => {
      const emp = employees.find((e) => e.id === c.employeeId);
      const employeeName = emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown Employee';
      return {
        ...c,
        employeeName,
        history: JSON.parse(c.historyJson || '[]'),
      };
    });
  }
}
