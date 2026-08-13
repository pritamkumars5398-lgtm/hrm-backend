import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { writeAuditLog } from '../common/audit-log';
import type { CreateTravelRequestDto, UpdateTravelBookingDto, CancelTravelDto } from './dto/travel.dto';

function canManage(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('travel.manage') || permissions.includes('reports.view');
}

@Injectable()
export class TravelService {
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

  async createTravel(organizationId: string, userId: string, dto: CreateTravelRequestDto) {
    const employee = await this.getEmployee(userId, organizationId);

    const travel = await this.prisma.travelRequest.create({
      data: {
        id: `trv-${randomUUID().slice(0, 8)}`,
        organizationId,
        employeeId: employee.id,
        destination: dto.destination.trim(),
        startDate: dto.startDate,
        endDate: dto.endDate,
        purpose: dto.purpose.trim(),
        estimatedCost: dto.estimatedCost,
        status: 'PENDING',
        bookingDetails: null,
        expenseId: null,
        cancellationReason: null,
      },
    });

    await this.approvals.createApproval(
      organizationId,
      employee.id,
      'Travel',
      travel.id,
      `Travel to ${dto.destination} - ${employee.firstName} ${employee.lastName}`,
      `Dates: ${dto.startDate} to ${dto.endDate} | Cost: ₹${dto.estimatedCost ?? 0} | Purpose: ${dto.purpose}`,
    );

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'CREATE',
      resource: 'TravelRequest',
      resourceId: travel.id,
      result: 'ALLOW',
      details: { destination: dto.destination, startDate: dto.startDate, endDate: dto.endDate },
    });

    return { ...travel, employeeName: `${employee.firstName} ${employee.lastName}` };
  }

  async listTravel(organizationId: string, userId: string) {
    const employee = await this.getEmployee(userId, organizationId);

    const requests = await this.prisma.travelRequest.findMany({
      where: { employeeId: employee.id, organizationId },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((t) => ({ ...t, employeeName: `${employee.firstName} ${employee.lastName}` }));
  }

  async updateBooking(id: string, organizationId: string, userId: string, permissions: string[], dto: UpdateTravelBookingDto) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('Only travel managers can update booking details.');
    }

    const travel = await this.prisma.travelRequest.findUnique({ where: { id } });
    if (!travel || travel.organizationId !== organizationId) {
      throw new NotFoundException('Travel request not found.');
    }

    if (travel.status !== 'APPROVED') {
      throw new BadRequestException('Travel request must be APPROVED before booking flights/hotels.');
    }

    const updated = await this.prisma.travelRequest.update({
      where: { id },
      data: { bookingDetails: dto.bookingDetails.trim(), status: 'BOOKED' },
    });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'UPDATE',
      resource: 'TravelRequest',
      resourceId: id,
      result: 'ALLOW',
      details: { status: 'BOOKED', bookingDetails: dto.bookingDetails },
    });

    // Notify employee of confirmed booking
    const emp = await this.prisma.employee.findUnique({ where: { id: travel.employeeId } });
    if (emp?.userId) {
      await this.prisma.notification.create({
        data: {
          id: `ntf-${randomUUID().slice(0, 8)}`,
          organizationId,
          userId: emp.userId,
          title: 'Travel Booking Confirmed',
          body: `Your trip to ${travel.destination} has been booked: ${dto.bookingDetails}`,
          kind: 'employee',
          link: '/dashboard/travel',
          read: false,
        },
      });
    }

    return updated;
  }

  async cancelTravel(id: string, organizationId: string, userId: string, dto: CancelTravelDto) {
    const travel = await this.prisma.travelRequest.findUnique({ where: { id } });
    if (!travel || travel.organizationId !== organizationId) {
      throw new NotFoundException('Travel request not found.');
    }

    const employee = await this.getEmployee(userId, organizationId);
    if (travel.employeeId !== employee.id) {
      throw new ForbiddenException('You can only cancel your own travel requests.');
    }

    if (travel.status === 'CANCELLED' || travel.status === 'REJECTED') {
      throw new BadRequestException('Travel request is already cancelled or rejected.');
    }

    const updated = await this.prisma.travelRequest.update({
      where: { id },
      data: { status: 'CANCELLED', cancellationReason: dto.cancellationReason.trim() },
    });

    await writeAuditLog(this.prisma, {
      organizationId,
      userId,
      action: 'UPDATE',
      resource: 'TravelRequest',
      resourceId: id,
      result: 'ALLOW',
      details: { status: 'CANCELLED', reason: dto.cancellationReason },
    });

    return updated;
  }

  async listAll(organizationId: string, permissions: string[]) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to view all travel requests.');
    }

    const requests = await this.prisma.travelRequest.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const allEmployees = await this.prisma.employee.findMany({ where: { organizationId } });
    const employees = allEmployees.filter((e) => !e.deletedAt);

    return requests.map((t) => {
      const emp = employees.find((e) => e.id === t.employeeId);
      return { ...t, employeeName: emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown Employee' };
    });
  }
}
