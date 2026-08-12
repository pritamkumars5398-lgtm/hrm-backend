import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateAssetDto, UpdateAssetStatusDto } from './dto/assets.dto';

function canManage(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('assets.manage') || permissions.includes('employees.manage');
}

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async createAsset(organizationId: string, permissions: string[], dto: CreateAssetDto) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage assets.');
    }

    const tag = dto.assetTag?.trim() || `AST-${dto.category.slice(0, 3).toUpperCase()}-${Math.floor(10 + Math.random() * 90)}`;
    const serial = dto.serialNumber?.trim() || `SN${Math.floor(100000 + Math.random() * 900000)}`;

    return this.prisma.asset.create({
      data: {
        id: `ast-${randomUUID().slice(0, 8)}`,
        organizationId,
        name: dto.name.trim(),
        assetTag: tag,
        category: dto.category,
        status: 'AVAILABLE',
        serialNumber: serial,
        assignedToId: null,
      },
    });
  }

  async listAssets(organizationId: string, permissions: string[]) {
    const assets = await this.prisma.asset.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const allEmployees = await this.prisma.employee.findMany({
      where: { organizationId },
    });
    const employees = allEmployees.filter((e) => !e.deletedAt);

    return assets.map((asset) => {
      const emp = employees.find((e) => e.id === asset.assignedToId);
      const assignedTo = emp ? `${emp.firstName} ${emp.lastName}` : 'Unassigned';
      return {
        id: asset.id,
        assetTag: asset.assetTag,
        name: asset.name,
        category: asset.category,
        status: asset.status,
        serialNumber: asset.serialNumber,
        assignedToId: asset.assignedToId,
        assignedTo,
      };
    });
  }

  async updateAssetStatus(id: string, organizationId: string, permissions: string[], dto: UpdateAssetStatusDto) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage assets.');
    }

    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset || asset.organizationId !== organizationId) {
      throw new NotFoundException('Asset not found.');
    }

    let assignedToId = asset.assignedToId;

    if (dto.status === 'ASSIGNED') {
      if (!dto.assignedToId) {
        throw new NotFoundException('assignedToId is required when status is ASSIGNED.');
      }
      const employee = await this.prisma.employee.findUnique({ where: { id: dto.assignedToId } });
      if (!employee || employee.organizationId !== organizationId || employee.deletedAt) {
        throw new NotFoundException('Employee not found.');
      }
      assignedToId = dto.assignedToId;
    } else {
      assignedToId = null;
    }

    return this.prisma.asset.update({
      where: { id },
      data: {
        status: dto.status,
        assignedToId,
      },
    });
  }

  async deleteAsset(id: string, organizationId: string, permissions: string[]) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage assets.');
    }

    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset || asset.organizationId !== organizationId) {
      throw new NotFoundException('Asset not found.');
    }

    await this.prisma.asset.delete({ where: { id } });

    return { success: true };
  }
}
