import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AiService, type AskAiDto } from './ai.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('ai-copilot')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('metrics')
  getMetrics(@CurrentMembership() membership: Membership) {
    return this.aiService.getMetrics(membership.organizationId);
  }

  @Get('history')
  getHistory(@CurrentMembership() membership: Membership) {
    return this.aiService.getHistory(
      membership.organizationId,
      membership.userId,
    );
  }

  @Post('ask')
  ask(
    @CurrentMembership() membership: Membership,
    @Body() dto: AskAiDto,
  ) {
    return this.aiService.ask(
      membership.organizationId,
      membership.userId,
      dto,
    );
  }

  @Delete('history')
  clearHistory(@CurrentMembership() membership: Membership) {
    return this.aiService.clearHistory(
      membership.organizationId,
      membership.userId,
    );
  }
}
