import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EmailService } from '../common/email.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';

@Controller('mailer')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MailerController {
  constructor(private readonly emailService: EmailService) {}

  @Get('status')
  getStatus() {
    return this.emailService.getStatus();
  }

  @Get('logs')
  getLogs(@Query('limit') limit?: string) {
    return this.emailService.getLogs(limit ? parseInt(limit, 10) : 20);
  }

  @Post('send-test')
  sendTest(@Body('to') to: string) {
    return this.emailService.sendTestEmail(to || 'test@example.com');
  }
}
