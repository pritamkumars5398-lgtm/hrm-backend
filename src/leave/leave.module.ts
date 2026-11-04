import { Module } from '@nestjs/common';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailerModule } from '../mailer/mailer.module';

@Module({
  imports: [AuthModule, NotificationsModule, MailerModule],
  controllers: [LeaveController],
  providers: [LeaveService],
})
export class LeaveModule {}
