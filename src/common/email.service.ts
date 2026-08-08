import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    const host = this.configService.get<string>('SMTP_HOST') || 'smtp.gmail.com';
    const port = parseInt(this.configService.get<string>('SMTP_PORT') || '587', 10);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    if (!user || !pass) {
      this.logger.warn('SMTP_USER or SMTP_PASS not configured. Outbound emails will be disabled.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  async sendInvite(to: string, name: string, link: string, tempPassword?: string | null): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(`Email not sent to ${to} — SMTP not configured.`);
      return false;
    }

    const displayName = name || to.split('@')[0];
    const fromAddress = this.configService.get<string>('SMTP_FROM') || `Keystone HRM <${this.configService.get('SMTP_USER')}>`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're invited to Keystone</title>
</head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#1e3a2f;padding:32px 40px;">
              <p style="margin:0;color:#d4e8d8;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">Keystone HRM</p>
              <h1 style="margin:8px 0 0;color:#ffffff;font-size:24px;font-weight:600;letter-spacing:-0.01em;">
                You've been invited
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px 0;">
              <p style="margin:0 0 16px;font-size:15px;color:#3d3d3d;line-height:1.6;">
                Hi <strong>${displayName}</strong>,
              </p>
              <p style="margin:0 0 24px;font-size:15px;color:#3d3d3d;line-height:1.6;">
                You've been added to a workspace on <strong>Keystone</strong>. Use the temporary credentials below to sign in and set a new password.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f2;border:1px solid #c8dece;border-radius:10px;margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#5a8a6a;text-transform:uppercase;letter-spacing:0.08em;">Your login email</p>
                    <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#1e3a2f;">${to}</p>
                    ${tempPassword ? `
                    <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#5a8a6a;text-transform:uppercase;letter-spacing:0.08em;">Temporary password</p>
                    <p style="margin:0;font-size:22px;font-weight:700;color:#1e3a2f;letter-spacing:0.12em;font-family:monospace;">${tempPassword}</p>
                    ` : ''}
                  </td>
                </tr>
              </table>
              <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#1e3a2f;border-radius:8px;">
                    <a href="${link}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:-0.01em;">
                      Sign in to Keystone &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 28px;font-size:13px;color:#888;line-height:1.6;">
                You will be prompted to set a new password immediately after signing in. This temporary password expires once it's used.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px 32px;border-top:1px solid #efefef;">
              <p style="margin:0;font-size:12px;color:#aaa;line-height:1.7;">
                If you weren't expecting this invite, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

    try {
      await this.transporter.sendMail({
        from: fromAddress,
        to,
        subject: `You've been invited to Keystone HRM`,
        html: htmlContent,
        text: `Hi ${displayName},\n\nYou've been invited to Keystone HRM.\n\nEmail: ${to}${tempPassword ? `\nTemporary Password: ${tempPassword}` : ''}\n\nSign in here: ${link}`,
      });
      this.logger.log(`Invite email successfully sent to ${to}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send invite email to ${to}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
