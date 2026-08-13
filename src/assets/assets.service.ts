import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { writeAuditLog } from '../common/audit-log';
import type { CreateAssetDto, UpdateAssetStatusDto } from './dto/assets.dto';

function canManage(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('assets.manage') || permissions.includes('employees.manage');
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async createAsset(organizationId: string, userId: string, permissions: string[], dto: CreateAssetDto) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage assets.');
    }

    const tag = dto.assetTag?.trim() || `AST-${dto.category.slice(0, 3).toUpperCase()}-${Math.floor(10 + Math.random() * 90)}`;
    const serial = dto.serialNumber?.trim() || `SN${Math.floor(100000 + Math.random() * 900000)}`;

    const existingTag = await this.prisma.asset.findFirst({
      where: { organizationId, assetTag: tag },
    });
    if (existingTag) {
      throw new ConflictException(`An asset with Tag "${tag}" already exists in this workspace.`);
    }

    if (dto.serialNumber?.trim()) {
      const existingSerial = await this.prisma.asset.findFirst({
        where: { organizationId, serialNumber: dto.serialNumber.trim() },
      });
      if (existingSerial) {
        throw new ConflictException(`An asset with Serial Number "${dto.serialNumber.trim()}" already exists in this workspace.`);
      }
    }

    const asset = await this.prisma.asset.create({
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

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'CREATE',
      resource: 'Asset',
      resourceId: asset.id,
      result: 'ALLOW',
      details: { name: asset.name, category: asset.category, assetTag: asset.assetTag },
    });

    return asset;
  }

  async listAssets(organizationId: string) {
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

  async listMyAssets(organizationId: string, userId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { userId, organizationId },
    });

    if (!employee || employee.deletedAt) {
      return [];
    }

    const assets = await this.prisma.asset.findMany({
      where: { organizationId, assignedToId: employee.id },
      orderBy: { createdAt: 'desc' },
    });

    return assets.map((asset) => ({
      id: asset.id,
      assetTag: asset.assetTag,
      name: asset.name,
      category: asset.category,
      status: asset.status,
      serialNumber: asset.serialNumber,
      assignedToId: asset.assignedToId,
      assignedTo: `${employee.firstName} ${employee.lastName}`,
    }));
  }

  async updateAssetStatus(
    id: string,
    organizationId: string,
    userId: string,
    permissions: string[],
    dto: UpdateAssetStatusDto,
  ) {
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

    const updated = await this.prisma.asset.update({
      where: { id },
      data: { status: dto.status, assignedToId },
    });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'UPDATE',
      resource: 'Asset',
      resourceId: id,
      result: 'ALLOW',
      details: { status: dto.status, assignedToId },
    });

    // Notify the assigned employee
    if (dto.status === 'ASSIGNED' && assignedToId) {
      const emp = await this.prisma.employee.findUnique({ where: { id: assignedToId } });
      if (emp?.userId) {
        await this.notifications.create({
          userId: emp.userId,
          organizationId,
          title: 'Asset Assigned to You',
          body: `${asset.name} (${asset.assetTag}) has been assigned to you.`,
          kind: 'employee',
          link: '/dashboard/assets',
        });
      }
    }

    return updated;
  }

  async deleteAsset(id: string, organizationId: string, userId: string, permissions: string[]) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage assets.');
    }

    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset || asset.organizationId !== organizationId) {
      throw new NotFoundException('Asset not found.');
    }

    await this.prisma.asset.delete({ where: { id } });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'DELETE',
      resource: 'Asset',
      resourceId: id,
      result: 'ALLOW',
      details: { name: asset.name, assetTag: asset.assetTag },
    });

    return { success: true };
  }
}
