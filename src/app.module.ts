import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { InvitesModule } from './invites/invites.module';
import { EmployeesModule } from './employees/employees.module';
import { AttendanceModule } from './attendance/attendance.module';
import { LeaveModule } from './leave/leave.module';
import { PayrollModule } from './payroll/payroll.module';
import { PerformanceModule } from './performance/performance.module';
import { DocumentsModule } from './documents/documents.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { FormsModule } from './forms/forms.module';
import { RecruitmentModule } from './recruitment/recruitment.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { TimesheetsModule } from './timesheets/timesheets.module';
import { LmsModule } from './lms/lms.module';
import { AssetsModule } from './assets/assets.module';
import { ExpensesModule } from './expenses/expenses.module';
import { TravelModule } from './travel/travel.module';
import { HelpdeskModule } from './helpdesk/helpdesk.module';
import { EngagementModule } from './engagement/engagement.module';
import { CommunicationModule } from './communication/communication.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { ComplianceModule } from './compliance/compliance.module';
import { AiModule } from './ai/ai.module';
import { FormerEmployeesModule } from './former-employees/former-employees.module';
import { MailerModule } from './mailer/mailer.module';
import { HealthController } from './health/health.controller';

/**
 * Modular monolith (§5). Auth, users, organisations and invites are the
 * access-control spine. Every HR business module — Employees, Attendance,
 * Leave, Payroll, Performance, Documents, Reports and now Dashboard — is real
 * (Phase 3), each scoped by organizationId and permission-checked server-side.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    UsersModule,
    AuthModule,
    OrganizationsModule,
    InvitesModule,
    EmployeesModule,
    AttendanceModule,
    LeaveModule,
    PayrollModule,
    PerformanceModule,
    DocumentsModule,
    ReportsModule,
    DashboardModule,
    NotificationsModule,
    FormsModule,
    RecruitmentModule,
    OnboardingModule,
    TimesheetsModule,
    LmsModule,
    AssetsModule,
    ExpensesModule,
    TravelModule,
    HelpdeskModule,
    EngagementModule,
    CommunicationModule,
    WorkflowsModule,
    ComplianceModule,
    AiModule,
    FormerEmployeesModule,
    MailerModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}


