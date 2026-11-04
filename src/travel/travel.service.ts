import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { randomUUID } from 'node:crypto';

export type CreateTravelDto = {
  destination: string;
  startDate: string;
  endDate: string;
  purpose: string;
  estimatedCost: number;
  hotelDetails?: string;
};

@Injectable()
export class TravelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getAll(organizationId: string, status?: string) {

    const where: any = { organizationId };
    if (status && status !== 'ALL') {
      where.status = status;
    }

    const requests = await this.prisma.travelRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((r) => ({
      id: r.id,
      employee: r.employee || 'Employee',
      destination: r.destination,
      startDate: r.startDate,
      endDate: r.endDate,
      purpose: r.purpose,
      estimatedCost: r.estimatedCost,
      status: r.status as 'PENDING' | 'APPROVED' | 'BOOKED' | 'REJECTED',
      hotelDetails: r.hotelDetails || '',
      createdAt: r.createdAt.toISOString().slice(0, 10),
    }));
  }

  async create(organizationId: string, employeeName: string, dto: CreateTravelDto) {
    if (!dto.destination?.trim() || !dto.startDate || !dto.endDate) {
      throw new BadRequestException('Destination and travel dates are required.');
    }

    const created = await this.prisma.travelRequest.create({
      data: {
        id: `trv-${randomUUID().slice(0, 8)}`,
        organizationId,
        employee: employeeName || 'Employee',
        destination: dto.destination.trim(),
        startDate: dto.startDate,
        endDate: dto.endDate,
        purpose: dto.purpose?.trim() || 'Business Travel',
        estimatedCost: Number(dto.estimatedCost) || 0,
        status: 'PENDING',
        hotelDetails: dto.hotelDetails?.trim() || '',
      },
    });

    // Notify travel desk / managers
    const memberships = await this.prisma.membership.findMany({ where: { organizationId } });
    if (memberships.length > 0) {
      await this.notifications.createForMany(
        memberships.map((m) => m.userId),
        {
          organizationId,
          title: 'New Travel Request Submitted',
          body: `${employeeName} requested travel to ${created.destination} (₹${created.estimatedCost}).`,
          kind: 'travel',
          link: '/dashboard/travel',
        },
      );
    }

    return {
      id: created.id,
      employee: created.employee,
      destination: created.destination,
      startDate: created.startDate,
      endDate: created.endDate,
      purpose: created.purpose,
      estimatedCost: created.estimatedCost,
      status: created.status as 'PENDING' | 'APPROVED' | 'BOOKED' | 'REJECTED',
      hotelDetails: created.hotelDetails || '',
    };
  }

  async updateStatus(
    organizationId: string,
    id: string,
    status: 'PENDING' | 'APPROVED' | 'BOOKED' | 'REJECTED',
  ) {
    const existing = await this.prisma.travelRequest.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Travel request not found.');

    const updated = await this.prisma.travelRequest.update({
      where: { id },
      data: { status },
    });

    return {
      id: updated.id,
      employee: updated.employee,
      destination: updated.destination,
      startDate: updated.startDate,
      endDate: updated.endDate,
      purpose: updated.purpose,
      estimatedCost: updated.estimatedCost,
      status: updated.status as 'PENDING' | 'APPROVED' | 'BOOKED' | 'REJECTED',
      hotelDetails: updated.hotelDetails || '',
    };
  }

  async delete(organizationId: string, id: string) {
    const existing = await this.prisma.travelRequest.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Travel request not found.');

    await this.prisma.travelRequest.delete({ where: { id } });
    return { ok: true };
  }
}
