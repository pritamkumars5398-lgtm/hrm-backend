import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { writeAuditLog } from '../common/audit-log';
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

    // Duplicate detection check
    const existingDuplicate = await this.prisma.expenseClaim.findFirst({
      where: {
        organizationId,
        employeeId: employee.id,
        title: dto.title.trim(),
        amount: dto.amount,
        claimDate: dto.claimDate,
        status: { not: 'REJECTED' },
      },
    });
    if (existingDuplicate) {
      throw new ConflictException('A claim with the same title, amount, and date is already pending or processed.');
    }

    const claim = await this.prisma.expenseClaim.create({
      data: {
        id: `exp-${randomUUID().slice(0, 8)}`,
        organizationId,
        employeeId: employee.id,
        title: dto.title.trim(),
        category: dto.category,
        amount: dto.amount,
        approvedAmount: null,
        reimbursedAmount: null,
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
      `Amount: ₹${dto.amount} | Date: ${dto.claimDate} | Category: ${dto.category}`,
    );

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'CREATE',
      resource: 'ExpenseClaim',
      resourceId: claim.id,
      result: 'ALLOW',
      details: { title: dto.title, amount: dto.amount, category: dto.category },
    });

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

  /** HR/Finance marks an approved expense as REIMBURSED (paid out). */
  async reimburseExpense(id: string, organizationId: string, userId: string, permissions: string[]) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to reimburse expense claims.');
    }

    const claim = await this.prisma.expenseClaim.findUnique({ where: { id } });
    if (!claim || claim.organizationId !== organizationId) {
      throw new NotFoundException('Expense claim not found.');
    }
    if (claim.status !== 'APPROVED') {
      throw new ForbiddenException('Only APPROVED claims can be marked as reimbursed.');
    }

    const approvedAmount = claim.approvedAmount ?? claim.amount;
    const reimbursedAmount = approvedAmount;

    // Enforce invariant: Claimed Amount >= Approved Amount >= Reimbursed Amount
    if (reimbursedAmount > approvedAmount || approvedAmount > claim.amount) {
      throw new ForbiddenException('Financial invariant violation: Reimbursed amount cannot exceed approved amount, which cannot exceed claimed amount.');
    }

    const history = JSON.parse(claim.historyJson || '[]');
    history.push({
      action: 'REIMBURSED',
      userId,
      reimbursedAmount,
      timestamp: new Date().toISOString(),
    });

    const updated = await this.prisma.expenseClaim.update({
      where: { id },
      data: {
        status: 'REIMBURSED',
        approvedAmount,
        reimbursedAmount,
        historyJson: JSON.stringify(history),
      },
    });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'UPDATE',
      resource: 'ExpenseClaim',
      resourceId: id,
      result: 'ALLOW',
      details: { status: 'REIMBURSED', reimbursedAmount },
    });

    // Notify employee
    const emp = await this.prisma.employee.findUnique({ where: { id: claim.employeeId } });
    if (emp?.userId) {
      await this.prisma.notification.create({
        data: {
          id: `ntf-${randomUUID().slice(0, 8)}`,
          organizationId,
          userId: emp.userId,
          title: 'Expense Reimbursed',
          body: `Your expense claim "${claim.title}" of ₹${reimbursedAmount} has been reimbursed.`,
          kind: 'employee',
          link: '/dashboard/expenses',
          read: false,
        },
      });
    }

    return { ...updated, history };
  }
}
