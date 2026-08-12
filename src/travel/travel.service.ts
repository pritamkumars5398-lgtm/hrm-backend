import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
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

    // Register centralized approval
    await this.approvals.createApproval(
      organizationId,
      employee.id,
      'Travel',
      travel.id,
      `Travel to ${dto.destination} - ${employee.firstName} ${employee.lastName}`,
      `Dates: ${dto.startDate} to ${dto.endDate} | Cost: $${dto.estimatedCost} | Purpose: ${dto.purpose}`,
    );

    return {
      ...travel,
      employeeName: `${employee.firstName} ${employee.lastName}`,
    };
  }

  async listTravel(organizationId: string, userId: string) {
    const employee = await this.getEmployee(userId, organizationId);

    const requests = await this.prisma.travelRequest.findMany({
      where: { employeeId: employee.id, organizationId },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((t) => ({
      ...t,
      employeeName: `${employee.firstName} ${employee.lastName}`,
    }));
  }

  async updateBooking(id: string, organizationId: string, permissions: string[], dto: UpdateTravelBookingDto) {
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

    return this.prisma.travelRequest.update({
      where: { id },
      data: {
        bookingDetails: dto.bookingDetails.trim(),
        status: 'BOOKED',
      },
    });
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

    return this.prisma.travelRequest.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancellationReason: dto.cancellationReason.trim(),
      },
    });
  }

  async listAll(organizationId: string, permissions: string[]) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to view all travel requests.');
    }

    const requests = await this.prisma.travelRequest.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const allEmployees = await this.prisma.employee.findMany({
      where: { organizationId },
    });
    const employees = allEmployees.filter((e) => !e.deletedAt);

    return requests.map((t) => {
      const emp = employees.find((e) => e.id === t.employeeId);
      const employeeName = emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown Employee';
      return {
        ...t,
        employeeName,
      };
    });
  }
}
