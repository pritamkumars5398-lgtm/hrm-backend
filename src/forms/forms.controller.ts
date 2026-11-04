import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { FormsService } from './forms.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('forms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  @Get()
  async getForms(@CurrentMembership() membership: Membership) {
    return this.formsService.getForms(membership.organizationId);
  }

  @Get(':id')
  async getFormById(
    @Param('id') id: string,
    @CurrentMembership() membership: Membership,
  ) {
    return this.formsService.getFormById(id, membership.organizationId);
  }

  @Post()
  async createForm(
    @CurrentMembership() membership: Membership,
    @Body()
    body: {
      title: string;
      description?: string;
      category?: string;
      fields: any[];
      status?: string;
    },
  ) {
    return this.formsService.createForm(membership.organizationId, body);
  }

  @Delete(':id')
  async deleteForm(
    @Param('id') id: string,
    @CurrentMembership() membership: Membership,
  ) {
    return this.formsService.deleteForm(id, membership.organizationId);
  }

  @Post(':id/submit')
  async submitResponse(
    @Param('id') id: string,
    @CurrentMembership() membership: Membership,
    @Body()
    body: {
      respondentName: string;
      answers: Record<string, any>;
    },
  ) {
    return this.formsService.submitResponse(
      id,
      membership.organizationId,
      body.respondentName,
      body.answers,
    );
  }
}
