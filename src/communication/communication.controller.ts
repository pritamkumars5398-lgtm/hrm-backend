import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CommunicationService,
  type CreateChatMessageDto,
  type SendWhatsAppDto,
} from './communication.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('communication')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CommunicationController {
  constructor(private readonly communicationService: CommunicationService) {}

  // -------------------------------------------------------------------------
  // Chat
  // -------------------------------------------------------------------------
  @Get('chat')
  getChat(
    @CurrentMembership() membership: Membership,
    @Query('channel') channel?: string,
  ) {
    return this.communicationService.getChatMessages(
      membership.organizationId,
      channel,
    );
  }

  @Post('chat')
  createChat(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateChatMessageDto,
  ) {
    const sender = membership.jobTitle
      ? `${membership.jobTitle} User`
      : 'Priya Sharma';
    const role = membership.jobTitle || 'HR Manager';
    return this.communicationService.createChatMessage(
      membership.organizationId,
      sender,
      role,
      dto,
    );
  }

  @Delete('chat/:id')
  deleteChat(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.communicationService.deleteChatMessage(
      membership.organizationId,
      id,
    );
  }

  // -------------------------------------------------------------------------
  // WhatsApp Bot
  // -------------------------------------------------------------------------
  @Get('whatsapp')
  getWhatsApp(@CurrentMembership() membership: Membership) {
    return this.communicationService.getWhatsAppMessages(
      membership.organizationId,
    );
  }

  @Post('whatsapp')
  sendWhatsApp(
    @CurrentMembership() membership: Membership,
    @Body() dto: SendWhatsAppDto,
  ) {
    return this.communicationService.sendWhatsAppMessage(
      membership.organizationId,
      'You (WhatsApp)',
      dto,
    );
  }

  @Delete('whatsapp/clear')
  clearWhatsApp(@CurrentMembership() membership: Membership) {
    return this.communicationService.clearWhatsApp(membership.organizationId);
  }
}
