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
  AssetsService,
  type CreateAssetDto,
  type UpdateAssetDto,
} from './assets.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  getAll(
    @CurrentMembership() membership: Membership,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.assetsService.getAll(
      membership.organizationId,
      search,
      status,
    );
  }

  @Post()
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateAssetDto,
  ) {
    return this.assetsService.create(membership.organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body() dto: UpdateAssetDto,
  ) {
    return this.assetsService.update(membership.organizationId, id, dto);
  }

  @Delete(':id')
  delete(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.assetsService.delete(membership.organizationId, id);
  }
}
