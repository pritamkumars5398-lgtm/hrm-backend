import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ExpensesService, type CreateExpenseDto } from './expenses.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('expenses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  getAll(
    @CurrentMembership() membership: Membership,
    @Query('status') status?: string,
  ) {
    return this.expensesService.getAll(membership.organizationId, status);
  }

  @Post()
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.expensesService.create(
      membership.organizationId,
      membership.jobTitle || 'Employee',
      dto,
    );
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body('status') status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REIMBURSED',
  ) {
    return this.expensesService.updateStatus(
      membership.organizationId,
      id,
      status,
    );
  }

  @Delete(':id')
  delete(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.expensesService.delete(membership.organizationId, id);
  }
}
