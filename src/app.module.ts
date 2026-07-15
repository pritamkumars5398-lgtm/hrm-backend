import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { InvitesModule } from './invites/invites.module';
import { EmployeesModule } from './employees/employees.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { HealthController } from './health/health.controller';

/**
 * Modular monolith (§5). Auth, users, organisations and invites are the
 * access-control spine. EmployeesModule is a deliberate, read-only extension:
 * it serves the Employee *identity* records created on invite (§11.4) so the
 * directory shows real people, not mock rows. It exposes NO attendance, payroll
 * or performance data — those remain mock-only until Phase 2 (§11.6).
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
