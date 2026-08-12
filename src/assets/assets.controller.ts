import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { CreateAssetDto, UpdateAssetStatusDto } from './dto/assets.dto';
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

@Controller('assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  async createAsset(
    @CurrentMembership() m: Membership | undefined,
    @Body() dto: CreateAssetDto,
  ) {
    const membership = requireMembership(m);
    return this.assetsService.createAsset(membership.organizationId, membership.permissions, dto);
  }

  @Get()
  async listAssets(@CurrentMembership() m: Membership | undefined) {
    const membership = requireMembership(m);
    return this.assetsService.listAssets(membership.organizationId, membership.permissions);
  }

  @Patch(':id/status')
  async updateAssetStatus(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateAssetStatusDto,
  ) {
    const membership = requireMembership(m);
    return this.assetsService.updateAssetStatus(id, membership.organizationId, membership.permissions, dto);
  }

  @Delete(':id')
  async deleteAsset(
    @CurrentMembership() m: Membership | undefined,
    @Param('id') id: string,
  ) {
    const membership = requireMembership(m);
    return this.assetsService.deleteAsset(id, membership.organizationId, membership.permissions);
  }
}
