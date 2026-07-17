import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicPayCycle, type PublicPayCycle } from './pay-cycle.entity';
import type { UpdatePayCycleDto } from './dto/update-pay-cycle.dto';

const SELECT = {
  payCycleType: true,
  payCycleFixedDay: true,
  payCycleRangeStart: true,
  payCycleRangeEnd: true,
} as const;

/** payroll.manage implies view — mirrors PermissionsGuard's own '*'/wildcard matching. */
function canView(permissions: string[]): boolean {
  return (
    permissions.includes('*') ||
    permissions.includes('payroll.view') ||
    permissions.includes('payroll.manage') ||
    permissions.includes('payroll.*')
  );
}

function canManage(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('payroll.manage') || permissions.includes('payroll.*');
}

@Injectable()
export class PayCycleService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string, permissions: string[]): Promise<PublicPayCycle> {
    if (!canView(permissions)) {
      throw new ForbiddenException('You do not have permission to view payroll data.');
    }

    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: SELECT });
    if (!org) {
      throw new NotFoundException('That company no longer exists.');
    }
    return toPublicPayCycle(org);
  }

  async update(organizationId: string, permissions: string[], dto: UpdatePayCycleDto): Promise<PublicPayCycle> {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage payroll data.');
    }

    if (dto.type === 'FIXED') {
      if (dto.fixedDay == null) {
        throw new BadRequestException('Pick a day of the month for a fixed pay day.');
      }
    } else {
      if (dto.rangeStart == null || dto.rangeEnd == null) {
        throw new BadRequestException('Pick a start and end day for a date-range pay day.');
      }
      if (dto.rangeEnd < dto.rangeStart) {
        throw new BadRequestException('The range end must be on or after the range start.');
      }
    }

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        payCycleType: dto.type,
        payCycleFixedDay: dto.type === 'FIXED' ? dto.fixedDay! : null,
        payCycleRangeStart: dto.type === 'RANGE' ? dto.rangeStart! : null,
        payCycleRangeEnd: dto.type === 'RANGE' ? dto.rangeEnd! : null,
      },
      select: SELECT,
    });

    return toPublicPayCycle(updated);
  }
}
