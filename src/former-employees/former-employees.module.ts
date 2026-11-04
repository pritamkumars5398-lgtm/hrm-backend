import { Module } from '@nestjs/common';
import { FormerEmployeesController } from './former-employees.controller';
import { FormerEmployeesService } from './former-employees.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [FormerEmployeesController],
  providers: [FormerEmployeesService],
  exports: [FormerEmployeesService],
})
export class FormerEmployeesModule {}
