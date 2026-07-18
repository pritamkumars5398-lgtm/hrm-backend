import { Module } from '@nestjs/common';
import { SalaryController } from './salary.controller';
import { SalaryService } from './salary.service';
import { PayslipController } from './payslip.controller';
import { PayslipService } from './payslip.service';
import { PayCycleController } from './pay-cycle.controller';
import { PayCycleService } from './pay-cycle.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [SalaryController, PayslipController, PayCycleController],
  providers: [SalaryService, PayslipService, PayCycleService],
})
export class PayrollModule {}
