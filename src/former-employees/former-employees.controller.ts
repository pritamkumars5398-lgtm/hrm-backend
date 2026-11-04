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
import {
  FormerEmployeesService,
  type RecordExitDto,
} from './former-employees.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('former-employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FormerEmployeesController {
  constructor(
    private readonly formerEmployeesService: FormerEmployeesService,
  ) {}

  @Get()
  getAll(
    @CurrentMembership() membership: Membership,
    @Query('search') search?: string,
  ) {
    return this.formerEmployeesService.getAll(
      membership.organizationId,
      search,
    );
  }

  @Post()
  recordExit(
    @CurrentMembership() membership: Membership,
    @Body() dto: RecordExitDto,
  ) {
    return this.formerEmployeesService.recordExit(
      membership.organizationId,
      dto,
    );
  }

  @Patch(':id/fnf')
  updateFnf(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body('status') status: 'SETTLED' | 'IN_PROCESS',
    @Body('settledAmount') settledAmount?: number,
  ) {
    return this.formerEmployeesService.updateFnfStatus(
      membership.organizationId,
      id,
      status,
      settledAmount,
    );
  }

  @Get(':id/relieving-letter')
  getRelievingLetter(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.formerEmployeesService.getRelievingLetter(
      membership.organizationId,
      id,
    );
  }

  @Delete(':id')
  delete(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.formerEmployeesService.delete(
      membership.organizationId,
      id,
    );
  }
}
