import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { CreateExpenseClaimDto } from './dto/expenses.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

function requireMembership(membership: Membership | undefined): Membership {
  if (!membership) {
    throw new BadRequestException('X-Workspace-Id header is required.');
  }
  return membership;
}

@Controller('expenses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  async createExpense(
    @CurrentMembership() m: Membership | undefined,
    @Body() dto: CreateExpenseClaimDto,
  ) {
    const membership = requireMembership(m);
    return this.expensesService.createExpense(membership.organizationId, membership.userId, dto);
  }

  @Get()
  async listExpenses(@CurrentMembership() m: Membership | undefined) {
    const membership = requireMembership(m);
    return this.expensesService.listExpenses(membership.organizationId, membership.userId);
  }

  @Get('all')
  async listAllExpenses(@CurrentMembership() m: Membership | undefined) {
    const membership = requireMembership(m);
    return this.expensesService.listAll(membership.organizationId, membership.permissions);
  }

  @Patch(':id/reimburse')
  async reimburseExpense(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
  ) {
    const membership = requireMembership(m);
    return this.expensesService.reimburseExpense(id, membership.organizationId, membership.userId, membership.permissions);
  }
}
