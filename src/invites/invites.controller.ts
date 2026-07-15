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
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/invite.dto';
import { toPublicInvite, type PublicInvite } from './invite.entity';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import { toPublicUser, type PublicUser, type Membership } from '../users/user.entity';

@Controller()
export class InvitesController {
  constructor(
    private readonly invitesService: InvitesService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  // ---- Members -------------------------------------------------------------

  @Get('members')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('team.view')
  async members(@CurrentMembership() membership: Membership): Promise<PublicUser[]> {
    const users = await this.usersService.findAllByOrganization(membership.organizationId);
    // findAllByOrganization now returns the user objects with membership injected, 
    // but toPublicUser will strip passwordHash.
    return users.map(u => toPublicUser(u, [u as any]));
  }

  @Delete('members/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('team.managePermissions')
  @HttpCode(200)
  async removeMember(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    const organizationId = membership.organizationId;

    if (id === membership.userId) {
      throw new BadRequestException('You cannot remove yourself.');
    }

    // A real implementation would remove the Membership, not the User.
    // For now we will just delete the user.
    const target = await this.usersService.findById(id);
    if (!target) throw new NotFoundException('Member not found.');
    
    const targetMemberships = await this.usersService.getMemberships(id);
    const targetMem = targetMemberships.find(m => m.organizationId === organizationId);
    
    if (!targetMem) {
      throw new NotFoundException('Member not found in this company.');
    }

    if (targetMem.permissions.includes('*')) {
      throw new ForbiddenException('You cannot remove a member with full owner permissions.');
    }

    await this.usersService.remove(id); // TODO: Change to remove membership
    return { ok: true };
  }

  // ---- Invites (Owner and HR — §10) ---------------------------------------

  @Get('invites')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('team.view')
  async list(@CurrentMembership() membership: Membership): Promise<PublicInvite[]> {
    const invites = await this.invitesService.listByOrganization(membership.organizationId);
    return invites.map(toPublicInvite);
  }

  /**
   * Returns the invite link alongside the record. There is no SMTP in this phase
   * (§11.3), so the UI surfaces the link for the inviter to copy. This is the one
   * place the token is legitimately exposed — to the person who just created it.
   */
  @Post('invites')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('team.invite')
  async create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateInviteDto,
  ): Promise<{ invite: PublicInvite; inviteLink: string; tempPassword: string | null }> {
    const { invite, tempPassword } = await this.invitesService.create({
      organizationId: membership.organizationId,
      email: dto.email,
      permissions: dto.permissions,
      invitedBy: membership.userId,
      source: dto.source,
      firstName: dto.firstName,
      lastName: dto.lastName,
      jobTitle: dto.jobTitle,
      department: dto.department,
      startDate: dto.startDate,
      employmentType: dto.employmentType,
      workLocation: dto.workLocation,
      employeeId: dto.employeeId,
      contactNumber: dto.contactNumber,
      homeAddress: dto.homeAddress,
      financialDetails: dto.financialDetails,
      educationDetails: dto.educationDetails,
      familyDetails: dto.familyDetails,
    });

    return {
      invite: toPublicInvite(invite),
      inviteLink: this.linkFor(invite.token),
      tempPassword,
    };
  }

  @Post('invites/:id/resend')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('team.invite')
  @HttpCode(200)
  async resend(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ): Promise<{ invite: PublicInvite; inviteLink: string }> {
    const invite = await this.invitesService.resend(id, membership.organizationId);

    // If we wanted to reissue a temp password on resend, we'd do it here. 
    // But typically Forgot Password is the right flow for existing users.
    return {
      invite: toPublicInvite(invite),
      inviteLink: this.linkFor(invite.token),
    };
  }

  @Post('invites/:id/revoke')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('team.invite')
  @HttpCode(200)
  async revoke(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ): Promise<PublicInvite> {
    return toPublicInvite(await this.invitesService.revoke(id, membership.organizationId));
  }

  private linkFor(token: string): string {
    const origin = (this.configService.get<string>('CORS_ORIGINS') ?? 'http://localhost:5173')
      .split(',')[0]
      .trim();

    return `${origin}/login`;
  }
}
