import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { INDUSTRIES, type Organization } from './organization.entity';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { setAuthCookie } from '../common/auth-cookie';
import type { JwtPayload } from '../common/jwt-payload';
import { toPublicUser, type PublicUser } from '../users/user.entity';

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
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ organization: Organization; user: PublicUser }> {
    const { organization } = this.organizationsService.create({
      userId: payload.sub,
      ...dto,
    });

    // The user's organizationId just changed, so the old JWT is stale — it still
    // claims organizationId: null. Re-issue it, or every later request looks
    // like the user has no company.
    const user = this.usersService.findById(payload.sub);
    if (!user) throw new NotFoundException('Your account no longer exists.');

    const { token } = await this.authService.issueFor(user);
    setAuthCookie(res, token, this.configService.get<string>('NODE_ENV') === 'production');

    return { organization, user: toPublicUser(user) };
  }

  /** The company the signed-in user belongs to. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() payload: JwtPayload): Organization {
    if (!payload.organizationId) {
      throw new NotFoundException('You have not created a company yet.');
    }

    const organization = this.organizationsService.findById(payload.organizationId);
    if (!organization) {
      throw new NotFoundException('Company not found.');
    }

    return organization;
  }
}
