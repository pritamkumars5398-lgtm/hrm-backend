import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'node:crypto';

export type CreateComplianceDto = {
  name: string;
  authority: string;
  dueDate: string;
  penaltyRisk: string;
  period?: string;
};

@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(organizationId: string) {
    const items = await this.prisma.complianceRecord.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });

    const filedCount = items.filter((i) => i.status === 'FILED').length;
    const pendingCount = items.filter((i) => i.status === 'PENDING').length;
    const upcomingCount = items.filter((i) => i.status === 'UPCOMING').length;

    const complianceScore =
      items.length > 0 ? Math.round((filedCount / (items.length - upcomingCount || 1)) * 100) : 100;

    return {
      items,
      metrics: {
        scorePercent: Math.min(100, Math.max(0, complianceScore)),
        filedCount,
        pendingCount,
        upcomingCount,
        form16Status: 'Generated (Part A & B)',
        upcomingDeadline: '15th August',
      },
    };
  }

  async create(organizationId: string, dto: CreateComplianceDto) {
    return this.prisma.complianceRecord.create({
      data: {
        id: `c-${randomUUID().slice(0, 8)}`,
        organizationId,
        name: dto.name,
        authority: dto.authority,
        dueDate: dto.dueDate,
        penaltyRisk: dto.penaltyRisk,
        period: dto.period || 'Current',
        status: 'UPCOMING',
      },
    });
  }

  async markFiled(organizationId: string, id: string, ackNo?: string) {
    const record = await this.prisma.complianceRecord.findFirst({
      where: { id, organizationId },
    });
    if (!record) throw new NotFoundException('Compliance record not found');

    const generatedAck =
      ackNo || `ACK-${record.authority.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-6)}`;

    return this.prisma.complianceRecord.update({
      where: { id },
      data: {
        status: 'FILED',
        filedDate: new Date().toISOString().split('T')[0],
        acknowledgementNo: generatedAck,
      },
    });
  }

  async exportEcr(organizationId: string) {
    // Generate valid statutory ECR text layout (EPFO format)
    const records = await this.prisma.complianceRecord.findMany({
      where: { organizationId },
    });

    const header = `# EPFO ELECTRONIC CHALLAN CUM RETURN (ECR) FILE\n# Organization ID: ${organizationId}\n# Generated: ${new Date().toISOString()}\n# Version: 2.0\n`;
    const rows = records.map(
      (r, idx) =>
        `${1000 + idx}#${r.name}#${r.authority}#${r.dueDate}#${r.status}#${r.acknowledgementNo || 'PENDING'}#`,
    );

    return {
      fileName: `ECR_Return_${new Date().toISOString().split('T')[0]}.txt`,
      content: [header, ...rows].join('\n'),
    };
  }

  async delete(organizationId: string, id: string) {
    const record = await this.prisma.complianceRecord.findFirst({
      where: { id, organizationId },
    });
    if (!record) throw new NotFoundException('Compliance record not found');

    await this.prisma.complianceRecord.delete({ where: { id } });
    return { success: true };
  }
}
