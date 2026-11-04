import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { randomUUID } from 'node:crypto';

export type CreateAssetDto = {
  name: string;
  category: 'Laptop' | 'Desktop' | 'Mobile' | 'SIM' | 'Accessory' | 'License';
  assetTag?: string;
  serialNumber?: string;
  assignedTo?: string;
  status?: 'AVAILABLE' | 'ASSIGNED' | 'REPAIR' | 'RETIRED';
  purchaseDate?: string;
  conditionNotes?: string;
};

export type UpdateAssetDto = {
  name?: string;
  category?: 'Laptop' | 'Desktop' | 'Mobile' | 'SIM' | 'Accessory' | 'License';
  assignedTo?: string;
  status?: 'AVAILABLE' | 'ASSIGNED' | 'REPAIR' | 'RETIRED';
  conditionNotes?: string;
};

@Injectable()
export class AssetsService {
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
        { name: { contains: search, mode: 'insensitive' } },
        { assetTag: { contains: search, mode: 'insensitive' } },
        { assignedTo: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const assets = await this.prisma.asset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return assets.map((a) => ({
      id: a.id,
      assetTag: a.assetTag,
      name: a.name,
      category: a.category as 'Laptop' | 'Desktop' | 'Mobile' | 'SIM' | 'Accessory' | 'License',
      assignedTo: a.assignedTo || 'Unassigned',
      status: a.status as 'AVAILABLE' | 'ASSIGNED' | 'REPAIR' | 'RETIRED',
      serialNumber: a.serialNumber || 'N/A',
      purchaseDate: a.purchaseDate || a.createdAt.toISOString().slice(0, 10),
      createdAt: a.createdAt.toISOString().slice(0, 10),
    }));
  }

  async create(organizationId: string, dto: CreateAssetDto) {
    if (!dto.name?.trim() || !dto.category) {
      throw new BadRequestException('Asset name and category are required.');
    }

    const categoryPrefix = dto.category.slice(0, 3).toUpperCase();
    const tag =
      dto.assetTag?.trim() ||
      `AST-${categoryPrefix}-${Math.floor(10 + Math.random() * 90)}`;
    const serial = dto.serialNumber?.trim() || `SN${Math.floor(100000 + Math.random() * 900000)}`;

    const asset = await this.prisma.asset.create({
      data: {
        id: `ast-${randomUUID().slice(0, 8)}`,
        organizationId,
        assetTag: tag,
        name: dto.name.trim(),
        category: dto.category,
        assignedTo: dto.assignedTo?.trim() || 'Unassigned',
        status: dto.status || (dto.assignedTo && dto.assignedTo !== 'Unassigned' ? 'ASSIGNED' : 'AVAILABLE'),
        serialNumber: serial,
        purchaseDate: dto.purchaseDate || new Date().toISOString().slice(0, 10),
        conditionNotes: dto.conditionNotes || '',
      },
    });

    return {
      id: asset.id,
      assetTag: asset.assetTag,
      name: asset.name,
      category: asset.category as 'Laptop' | 'Desktop' | 'Mobile' | 'SIM' | 'Accessory' | 'License',
      assignedTo: asset.assignedTo || 'Unassigned',
      status: asset.status as 'AVAILABLE' | 'ASSIGNED' | 'REPAIR' | 'RETIRED',
      serialNumber: asset.serialNumber || 'N/A',
      purchaseDate: asset.purchaseDate || asset.createdAt.toISOString().slice(0, 10),
    };
  }

  async update(organizationId: string, id: string, dto: UpdateAssetDto) {
    const existing = await this.prisma.asset.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Asset not found.');

    const updated = await this.prisma.asset.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        category: dto.category,
        assignedTo: dto.assignedTo !== undefined ? dto.assignedTo.trim() : undefined,
        status: dto.status,
        conditionNotes: dto.conditionNotes,
      },
    });

    return {
      id: updated.id,
      assetTag: updated.assetTag,
      name: updated.name,
      category: updated.category as 'Laptop' | 'Desktop' | 'Mobile' | 'SIM' | 'Accessory' | 'License',
      assignedTo: updated.assignedTo || 'Unassigned',
      status: updated.status as 'AVAILABLE' | 'ASSIGNED' | 'REPAIR' | 'RETIRED',
      serialNumber: updated.serialNumber || 'N/A',
      purchaseDate: updated.purchaseDate || updated.createdAt.toISOString().slice(0, 10),
    };
  }

  async delete(organizationId: string, id: string) {
    const existing = await this.prisma.asset.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Asset not found.');

    await this.prisma.asset.delete({ where: { id } });
    return { ok: true };
  }
}
