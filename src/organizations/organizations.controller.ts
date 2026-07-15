import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto, UpdateOrganizationDto } from './dto/create-organization.dto';
import { INDUSTRIES, type Organization } from './organization.entity';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { setAuthCookie } from '../common/auth-cookie';
import type { JwtPayload } from '../common/jwt-payload';
import { PermissionsGuard, RequirePermission } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import { toPublicUser, type PublicUser, type Membership } from '../users/user.entity';

@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  /** The industry dropdown on the Company Details step. */
  @Get('industries')
  industries(): readonly string[] {
    return INDUSTRIES;
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CreateOrganizationDto,
  ): Promise<{ organization: Organization; user: PublicUser }> {
    const { organization } = await this.organizationsService.create({
      userId: payload.sub,
      ...dto,
    });

    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new NotFoundException('Your account no longer exists.');
    
    const memberships = await this.usersService.getMemberships(user.id);
    return { organization, user: toPublicUser(user, memberships) };
  }

  /** Company profile edits (Settings). */
  @Patch('me')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('settings.manage')
  async update(
    @CurrentMembership() membership: Membership,
    @Body() dto: UpdateOrganizationDto,
  ): Promise<Organization> {
    return this.organizationsService.update(membership.organizationId, dto);
  }

  /** The active company the signed-in user belongs to, based on X-Workspace-Id. */
  @Get('me')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  async mine(@CurrentMembership() membership: Membership | undefined): Promise<Organization> {
    if (!membership) {
      throw new BadRequestException('X-Workspace-Id header is required.');
    }
    const organization = await this.organizationsService.findById(membership.organizationId);
    if (!organization) {
      throw new NotFoundException('Company not found.');
    }

    return organization;
  }
}
