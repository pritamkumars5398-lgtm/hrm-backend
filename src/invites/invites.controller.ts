import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { InvitesService } from './invites.service';
import { AcceptInviteDto, CreateInviteDto } from './dto/invite.dto';
import { toPublicInvite, type PublicInvite } from './invite.entity';
import { UsersService } from '../users/users.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/roles.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { setAuthCookie } from '../common/auth-cookie';
import type { JwtPayload } from '../common/jwt-payload';
import { toPublicUser, type PublicUser } from '../users/user.entity';

/** What the invitee is shown before accepting. No token, no internal ids. */
type InvitePreview = {
  email: string;
  role: string;
  organizationName: string;
  invitedByName: string;
};

@Controller()
export class InvitesController {
  constructor(
    private readonly invitesService: InvitesService,
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  /** The caller's org, taken from the verified JWT — never from the request. */
  private orgIdOf(payload: JwtPayload): string {
    if (!payload.organizationId) {
      throw new BadRequestException('You have not created a company yet.');
    }
    return payload.organizationId;
  }

  // ---- Members -------------------------------------------------------------

  @Get('members')
  @UseGuards(JwtAuthGuard)
  async members(@CurrentUser() payload: JwtPayload): Promise<PublicUser[]> {
    const users = await this.usersService.findAllByOrganization(this.orgIdOf(payload));
    return users.map(toPublicUser);
  }

  @Delete('members/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @HttpCode(200)
  async removeMember(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    const organizationId = this.orgIdOf(payload);

    if (id === payload.sub) {
      throw new BadRequestException('You cannot remove yourself.');
    }

    const target = await this.usersService.findById(id);
    // Scoped to the caller's company — you must not be able to delete a user
    // belonging to somebody else's org by guessing an id.
    if (!target || target.organizationId !== organizationId) {
      throw new NotFoundException('Member not found.');
    }
    if (target.role === 'OWNER') {
      throw new ForbiddenException('The owner cannot be removed.');
    }

    await this.usersService.remove(id);
    return { ok: true };
  }

  // ---- Invites (Owner and HR — §10) ---------------------------------------

  @Get('invites')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'HR')
  async list(@CurrentUser() payload: JwtPayload): Promise<PublicInvite[]> {
    const invites = await this.invitesService.listByOrganization(this.orgIdOf(payload));
    return invites.map(toPublicInvite);
  }

  /**
   * Returns the invite link alongside the record. There is no SMTP in this phase
   * (§11.3), so the UI surfaces the link for the inviter to copy. This is the one
   * place the token is legitimately exposed — to the person who just created it.
   */
  @Post('invites')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'HR')
  async create(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CreateInviteDto,
  ): Promise<{ invite: PublicInvite; inviteLink: string }> {
    const invite = await this.invitesService.create({
      organizationId: this.orgIdOf(payload),
      email: dto.email,
      role: dto.role,
      invitedBy: payload.sub,
    });

    return {
      invite: toPublicInvite(invite),
      inviteLink: this.linkFor(invite.token),
    };
  }

  @Post('invites/:id/resend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'HR')
  @HttpCode(200)
  async resend(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ invite: PublicInvite; inviteLink: string }> {
    const invite = await this.invitesService.resend(id, this.orgIdOf(payload));

    return {
      invite: toPublicInvite(invite),
      inviteLink: this.linkFor(invite.token),
    };
  }

  @Post('invites/:id/revoke')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'HR')
  @HttpCode(200)
  async revoke(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<PublicInvite> {
    return toPublicInvite(await this.invitesService.revoke(id, this.orgIdOf(payload)));
  }

  // ---- Accept (public — the invitee has no account yet) --------------------

  @Get('invites/preview')
  async preview(@Query('token') token: string): Promise<InvitePreview> {
    if (!token) throw new BadRequestException('This invite link is not valid.');

    const invite = await this.invitesService.findByToken(token);
    const organization = await this.organizationsService.findById(invite.organizationId);
    const inviter = await this.usersService.findById(invite.invitedBy);

    return {
      email: invite.email,
      role: invite.role,
      organizationName: organization?.name ?? 'the company',
      invitedByName: inviter?.name ?? 'An administrator',
    };
  }

  @Post('invites/accept')
  @HttpCode(200)
  async accept(
    @Body() dto: AcceptInviteDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUser> {
    const invite = await this.invitesService.findByToken(dto.token);

    // Role, email and organisation all come from the invite — never from the
    // body — or an invitee could sign up as an OWNER of any org they like.
    const user = await this.usersService.createFromInvite({
      email: invite.email,
      password: dto.password,
      name: dto.fullName,
      jobTitle: dto.jobTitle,
      role: invite.role,
      organizationId: invite.organizationId,
    });

    await this.invitesService.markAccepted(invite.id);

    const { token } = await this.authService.issueFor(user);
    setAuthCookie(res, token, this.configService.get<string>('NODE_ENV') === 'production');

    return toPublicUser(user);
  }

  private linkFor(token: string): string {
    const origin = (this.configService.get<string>('CORS_ORIGINS') ?? 'http://localhost:5173')
      .split(',')[0]
      .trim();

    return `${origin}/accept-invite?token=${token}`;
  }
}
