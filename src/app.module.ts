import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { InvitesModule } from './invites/invites.module';
import { EmployeesModule } from './employees/employees.module';
import { AttendanceModule } from './attendance/attendance.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { HealthController } from './health/health.controller';

/**
 * Modular monolith (§5). Auth, users, organisations and invites are the
 * access-control spine. Employees and Attendance are real HR business modules
 * built on top of it (Phase 3) — each still scoped by organizationId and
 * permission-checked server-side. Payroll, Performance, Documents, Reports and
 * Dashboard remain mock-only until their own turn.
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
