import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { InvitesModule } from './invites/invites.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { UsersModule } from './users/users.module';

/**
 * Modular monolith (§5). Only auth, users, organisations and invites exist — all
 * four are access-control concerns. There are deliberately NO modules for
 * employees, attendance, payroll, leave, performance or reports: that is HR
 * business data and stays mock-only until Phase 2 (§11.4).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    UsersModule,
    AuthModule,
    OrganizationsModule,
    InvitesModule,
  ],
})
export class AppModule {}
