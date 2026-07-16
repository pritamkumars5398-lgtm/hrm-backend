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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { memoryStorage } from 'multer';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/invite.dto';
import { toPublicInvite, type PublicInvite } from './invite.entity';
import { UsersService } from '../users/users.service';
import { EmployeesService } from '../employees/employees.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import { toPublicUser, type PublicUser, type Membership } from '../users/user.entity';
import { uploadEmployeePhoto } from '../common/cloudinary-upload';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

@Controller()
export class InvitesController {
  constructor(
    private readonly invitesService: InvitesService,
    private readonly usersService: UsersService,
    private readonly employeesService: EmployeesService,
    private readonly configService: ConfigService,
  ) {}

  // ---- Members -------------------------------------------------------------

  @Get('members')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('team.view')
  async members(@CurrentMembership() membership: Membership): Promise<PublicUser[]> {
    const users = await this.usersService.findAllByOrganization(membership.organizationId);
    // Build a real Membership-shaped object for each — NOT `u as any`. That cast
    // reused the raw user record (passwordHash included) as the membership
    // entry: `toPublicUser` only strips the hash from the top level, so it was
    // leaking straight through inside `memberships[0]`.
    return users.map((u) =>
      toPublicUser(u, [
        {
          id: u.membershipId,
          userId: u.id,
          organizationId: u.organizationId,
          jobTitle: u.jobTitle,
          permissions: u.permissions,
        },
      ]),
    );
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

    // Multi-org: remove access to THIS company only, never the account itself —
    // the same person may hold real access to other companies (§1.2). Their
    // Employee HR record for this org (if any) is soft-deactivated alongside it,
    // so a removed member can't still show up as active in the directory (§1.3).
    await this.usersService.removeMembership(id, organizationId);
    await this.employeesService.deactivateForUser(id, organizationId);
    return { ok: true };
  }

  // ---- Invites (Owner and HR — §10) ---------------------------------------

  /**
   * The employee photo picked in the Add Employee form. Proxied through this
   * server (never uploaded straight to Cloudinary from the browser — see
   * .env.example) so the JWT guard, permission check, and the size/type limits
   * below all sit in front of it. Same permission as creating the invite
   * itself: whoever can add this person can also set their photo.
   */
  @Post('invites/photo')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('team.invite')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_BYTES },
      fileFilter: (_req, file, cb) => {
        cb(null, file.mimetype.startsWith('image/'));
      },
    }),
  )
  async uploadPhoto(@UploadedFile() file?: Express.Multer.File): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException('Choose an image file under 5MB.');
    }
    const url = await uploadEmployeePhoto(this.configService, file.buffer);
    return { url };
  }

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
      photoUrl: dto.photoUrl,
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
