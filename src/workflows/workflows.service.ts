import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'node:crypto';

export type CreateWorkflowRuleDto = {
  name: string;
  trigger: string;
  condition?: string;
  action: string;
};

@Injectable()
export class WorkflowsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(organizationId: string) {
    return this.prisma.workflowRule.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(organizationId: string, dto: CreateWorkflowRuleDto) {
    return this.prisma.workflowRule.create({
      data: {
        id: `w-${randomUUID().slice(0, 8)}`,
        organizationId,
        name: dto.name,
        trigger: dto.trigger,
        condition: dto.condition || 'True',
        action: dto.action,
        status: 'ACTIVE',
        executedCount: 0,
      },
    });
  }

  async toggleStatus(organizationId: string, id: string) {
    const rule = await this.prisma.workflowRule.findFirst({
      where: { id, organizationId },
    });
    if (!rule) throw new NotFoundException('Workflow rule not found');

    const nextStatus = rule.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    return this.prisma.workflowRule.update({
      where: { id },
      data: { status: nextStatus },
    });
  }

  async testRun(organizationId: string, id: string) {
    const rule = await this.prisma.workflowRule.findFirst({
      where: { id, organizationId },
    });
    if (!rule) throw new NotFoundException('Workflow rule not found');

    return this.prisma.workflowRule.update({
      where: { id },
      data: {
        executedCount: rule.executedCount + 1,
        lastExecutedAt: new Date(),
      },
    });
  }

  async delete(organizationId: string, id: string) {
    const rule = await this.prisma.workflowRule.findFirst({
      where: { id, organizationId },
    });
    if (!rule) throw new NotFoundException('Workflow rule not found');

    await this.prisma.workflowRule.delete({ where: { id } });
    return { success: true };
  }
}
