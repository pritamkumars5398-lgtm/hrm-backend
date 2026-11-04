import { Module } from '@nestjs/common';
import { TimesheetsController } from './timesheets.controller';
import { TimesheetsService } from './timesheets.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [TimesheetsController],
  providers: [TimesheetsService],
  exports: [TimesheetsService],
})
export class TimesheetsModule {}
