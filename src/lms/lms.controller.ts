import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { LmsService, type CreateCourseDto } from './lms.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

@Controller('lms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LmsController {
  constructor(private readonly lmsService: LmsService) {}

  @Get('courses')
  getCourses(@CurrentMembership() membership: Membership) {
    return this.lmsService.getCourses(membership.organizationId);
  }

  @Post('courses')
  createCourse(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateCourseDto,
  ) {
    return this.lmsService.createCourse(membership.organizationId, dto);
  }

  @Patch('courses/:id/progress')
  updateProgress(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
    @Body() body: { progressDelta?: number },
  ) {
    return this.lmsService.updateProgress(
      membership.organizationId,
      id,
      body.progressDelta,
    );
  }

  @Delete('courses/:id')
  deleteCourse(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.lmsService.deleteCourse(membership.organizationId, id);
  }
}
