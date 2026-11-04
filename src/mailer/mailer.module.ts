import { Module } from '@nestjs/common';
import { MailerController } from './mailer.controller';
import { EmailService } from '../common/email.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MailerController],
  providers: [EmailService],
  exports: [EmailService],
})
export class MailerModule {}
