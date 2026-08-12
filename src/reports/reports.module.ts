import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AuditLogsController } from './audit-logs.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController, AuditLogsController],
  providers: [ReportsService],
})
export class ReportsModule {}

