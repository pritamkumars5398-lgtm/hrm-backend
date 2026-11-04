import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'node:crypto';

export type RecordExitDto = {
  name: string;
  jobTitle: string;
  department: string;
  exitDate: string;
  fnfStatus?: 'SETTLED' | 'IN_PROCESS';
  exitReason?: string;
  settledAmount?: number;
};

@Injectable()
export class FormerEmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(organizationId: string, search?: string) {

    const where: any = { organizationId };
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { department: { contains: search.trim(), mode: 'insensitive' } },
        { jobTitle: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    return this.prisma.formerEmployee.findMany({
      where,
      orderBy: { exitDate: 'desc' },
    });
  }

  async recordExit(organizationId: string, dto: RecordExitDto) {
    return this.prisma.formerEmployee.create({
      data: {
        id: `f-${randomUUID().slice(0, 8)}`,
        organizationId,
        name: dto.name,
        jobTitle: dto.jobTitle,
        department: dto.department,
        exitDate: dto.exitDate,
        fnfStatus: dto.fnfStatus || 'IN_PROCESS',
        exitReason: dto.exitReason || 'Resignation',
        settledAmount: dto.settledAmount,
        handoverComplete: true,
        relievingLetterUrl: `relieving_${dto.name.toLowerCase().replace(/\s+/g, '_')}.pdf`,
      },
    });
  }

  async updateFnfStatus(
    organizationId: string,
    id: string,
    fnfStatus: 'SETTLED' | 'IN_PROCESS',
    settledAmount?: number,
  ) {
    const record = await this.prisma.formerEmployee.findFirst({
      where: { id, organizationId },
    });
    if (!record) throw new NotFoundException('Former employee record not found');

    return this.prisma.formerEmployee.update({
      where: { id },
      data: {
        fnfStatus,
        settledDate: fnfStatus === 'SETTLED' ? new Date().toISOString().split('T')[0] : null,
        ...(settledAmount ? { settledAmount } : {}),
      },
    });
  }

  async getRelievingLetter(organizationId: string, id: string) {
    const record = await this.prisma.formerEmployee.findFirst({
      where: { id, organizationId },
    });
    if (!record) throw new NotFoundException('Former employee record not found');

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    const orgName = org?.name || 'Keystone Technologies Private Limited';

    const letterContent = `
RELIEVING & SERVICE CERTIFICATE
Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}

To Whom It May Concern,

This is to certify that ${record.name} was employed with ${orgName} as ${record.jobTitle} in the ${record.department} Department until ${record.exitDate}.

During their tenure with us, ${record.name} was found to be hardworking, diligent, and professional. All company assets and departmental handovers have been completed satisfactorily, and Full & Final (F&F) settlement status is ${record.fnfStatus}.

${record.name} stands relieved of all duties effective close of business hours on ${record.exitDate}. We wish them every success in all future professional endeavors.

Sincerely,
Authorized Signatory
Human Resources Department
${orgName}
    `.trim();

    return {
      id: record.id,
      name: record.name,
      fileName: `Relieving_Letter_${record.name.replace(/\s+/g, '_')}.txt`,
      content: letterContent,
    };
  }

  async delete(organizationId: string, id: string) {
    const record = await this.prisma.formerEmployee.findFirst({
      where: { id, organizationId },
    });
    if (!record) throw new NotFoundException('Former employee record not found');

    await this.prisma.formerEmployee.delete({ where: { id } });
    return { success: true };
  }
}
