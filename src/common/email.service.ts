import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'node:crypto';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    const host = this.configService.get<string>('SMTP_HOST') || 'smtp.gmail.com';
    const port = parseInt(this.configService.get<string>('SMTP_PORT') || '587', 10);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    if (!user || !pass) {
      this.logger.warn('SMTP_USER or SMTP_PASS not configured. Outbound emails will run in SIMULATED mode with full DB audit logging.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  getStatus() {
    const user = this.configService.get<string>('SMTP_USER');
    const host = this.configService.get<string>('SMTP_HOST') || 'smtp.gmail.com';
    const port = parseInt(this.configService.get<string>('SMTP_PORT') || '587', 10);
    return {
      configured: Boolean(this.transporter),
      mode: this.transporter ? 'LIVE_SMTP' : 'SIMULATED_LOGGING',
      host,
      port,
      fromAddress: this.configService.get<string>('SMTP_FROM') || (user ? `Keystone HRM <${user}>` : 'Keystone HRM <notifications@keystone.local>'),
    };
  }

  private async recordLog(
    to: string,
    subject: string,
    template: string,
    status: 'SENT' | 'FAILED' | 'SIMULATED',
    error?: string,
  ) {
    try {
      await this.prisma.emailLog.create({
        data: {
          id: `mail-${randomUUID().slice(0, 8)}`,
          to,
          subject,
          template,
          status,
          error,
        },
      });
    } catch {
      // Non-blocking log persistence
    }
  }

  async getLogs(limit = 20) {
    return this.prisma.emailLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async sendInvite(to: string, name: string, link: string, tempPassword?: string | null): Promise<boolean> {
    const displayName = name || to.split('@')[0];
    const subject = `You've been invited to Keystone HRM`;

    if (!this.transporter) {
      this.logger.log(`[SIMULATED EMAIL] Invite to ${to} (${displayName}) with link: ${link}`);
      await this.recordLog(to, subject, 'INVITE', 'SIMULATED');
      return true;
    }

    const fromAddress = this.configService.get<string>('SMTP_FROM') || `Keystone HRM <${this.configService.get('SMTP_USER')}>`;

    try {
      await this.transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        html: `<p>Hi <b>${displayName}</b>, you've been invited to Keystone. Sign in at <a href="${link}">${link}</a>${tempPassword ? `<br>Temporary Password: <b>${tempPassword}</b>` : ''}</p>`,
      });
      this.logger.log(`Invite email successfully sent to ${to}`);
      await this.recordLog(to, subject, 'INVITE', 'SENT');
      return true;
    } catch (error) {
      const errStr = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send invite email to ${to}: ${errStr}`);
      await this.recordLog(to, subject, 'INVITE', 'FAILED', errStr);
      return false;
    }
  }

  async sendLeaveNotification(
    to: string,
    employeeName: string,
    leaveType: string,
    startDate: string,
    endDate: string,
    reason: string,
    status: string,
  ): Promise<boolean> {
    const subject = `Leave Request ${status}: ${employeeName} (${leaveType})`;

    if (!this.transporter) {
      this.logger.log(`[SIMULATED EMAIL] Leave update sent to ${to} for ${employeeName}: ${leaveType} ${startDate} to ${endDate}`);
      await this.recordLog(to, subject, 'LEAVE_NOTIFICATION', 'SIMULATED');
      return true;
    }

    const fromAddress = this.configService.get<string>('SMTP_FROM') || `Keystone HRM <${this.configService.get('SMTP_USER')}>`;
    try {
      await this.transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        html: `
          <h3>Leave Request Update</h3>
          <p>Employee: <b>${employeeName}</b></p>
          <p>Type: <b>${leaveType}</b></p>
          <p>Dates: <b>${startDate} to ${endDate}</b></p>
          <p>Reason: <i>${reason}</i></p>
          <p>Status: <b style="color: ${status === 'APPROVED' ? 'green' : 'orange'};">${status}</b></p>
        `,
      });
      await this.recordLog(to, subject, 'LEAVE_NOTIFICATION', 'SENT');
      return true;
    } catch (error) {
      const errStr = error instanceof Error ? error.message : String(error);
      await this.recordLog(to, subject, 'LEAVE_NOTIFICATION', 'FAILED', errStr);
      return false;
    }
  }

  async sendKudosNotification(
    to: string,
    recipientName: string,
    senderName: string,
    badge: string,
    message: string,
  ): Promise<boolean> {
    const subject = `🎉 You received a Kudos Badge from ${senderName}!`;

    if (!this.transporter) {
      this.logger.log(`[SIMULATED EMAIL] Kudos sent to ${to} (${recipientName}): ${badge} - "${message}"`);
      await this.recordLog(to, subject, 'KUDOS', 'SIMULATED');
      return true;
    }

    const fromAddress = this.configService.get<string>('SMTP_FROM') || `Keystone HRM <${this.configService.get('SMTP_USER')}>`;
    try {
      await this.transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        html: `
          <h2>🎉 Congratulations ${recipientName}!</h2>
          <p><b>${senderName}</b> recognized you with the <b>${badge}</b> badge:</p>
          <blockquote style="background:#f4f4f4;padding:12px;border-left:4px solid #ec4899;">"${message}"</blockquote>
        `,
      });
      await this.recordLog(to, subject, 'KUDOS', 'SENT');
      return true;
    } catch (error) {
      const errStr = error instanceof Error ? error.message : String(error);
      await this.recordLog(to, subject, 'KUDOS', 'FAILED', errStr);
      return false;
    }
  }

  async sendTestEmail(to: string): Promise<{ success: boolean; message: string; mode: string }> {
    const subject = `Keystone HRM - Test Verification Email`;

    if (!this.transporter) {
      await this.recordLog(to, subject, 'TEST', 'SIMULATED');
      return {
        success: true,
        mode: 'SIMULATED_LOGGING',
        message: `SMTP not configured in .env. Test email simulated and logged in database audit logs for ${to}.`,
      };
    }

    const fromAddress = this.configService.get<string>('SMTP_FROM') || `Keystone HRM <${this.configService.get('SMTP_USER')}>`;
    try {
      await this.transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        html: `<h3>Keystone HRM Mailer Test</h3><p>Your SMTP email configuration is active and working perfectly!</p>`,
      });
      await this.recordLog(to, subject, 'TEST', 'SENT');
      return {
        success: true,
        mode: 'LIVE_SMTP',
        message: `Test email successfully dispatched to ${to} via ${this.configService.get('SMTP_HOST') || 'SMTP'}.`,
      };
    } catch (error) {
      const errStr = error instanceof Error ? error.message : String(error);
      await this.recordLog(to, subject, 'TEST', 'FAILED', errStr);
      return {
        success: false,
        mode: 'LIVE_SMTP',
        message: `SMTP Error: ${errStr}`,
      };
    }
  }
}
