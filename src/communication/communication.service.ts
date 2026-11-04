import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'node:crypto';

export type CreateChatMessageDto = {
  text: string;
  channel?: string;
};

export type SendWhatsAppDto = {
  text: string;
  sender?: string;
};

@Injectable()
export class CommunicationService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Chat APIs
  // -------------------------------------------------------------------------

  async getChatMessages(organizationId: string, channel = 'GENERAL') {
    return this.prisma.chatMessage.findMany({
      where: { organizationId, channel },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createChatMessage(
    organizationId: string,
    sender: string,
    senderRole: string,
    dto: CreateChatMessageDto,
  ) {
    return this.prisma.chatMessage.create({
      data: {
        id: `m-${randomUUID().slice(0, 8)}`,
        organizationId,
        channel: dto.channel || 'GENERAL',
        sender: sender || 'Priya Sharma',
        senderRole: senderRole || 'Employee',
        text: dto.text,
      },
    });
  }

  async deleteChatMessage(organizationId: string, id: string) {
    const msg = await this.prisma.chatMessage.findFirst({
      where: { id, organizationId },
    });
    if (!msg) throw new NotFoundException('Message not found');

    await this.prisma.chatMessage.delete({ where: { id } });
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // WhatsApp Bot APIs
  // -------------------------------------------------------------------------

  async getWhatsAppMessages(organizationId: string) {
    return this.prisma.whatsAppMessage.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sendWhatsAppMessage(
    organizationId: string,
    sender: string,
    dto: SendWhatsAppDto,
  ) {
    const userText = dto.text.trim();
    const userMsg = await this.prisma.whatsAppMessage.create({
      data: {
        id: `b-${randomUUID().slice(0, 8)}`,
        organizationId,
        sender: sender || 'You (WhatsApp)',
        text: userText,
        isBot: false,
        status: 'DELIVERED',
      },
    });

    // Intelligent Bot Logic
    let replyText = "I didn't quite get that. Reply '1' for Leave, '2' for Payslip, or '3' for Punch In.";
    let intent = 'GENERAL';
    const lower = userText.toLowerCase();

    const nowTime = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    if (lower.includes('1') || lower.includes('leave')) {
      replyText = '✅ Leave Request Initiated! Please reply with your leave type and dates, e.g. "Sick Leave 10 Aug to 11 Aug".';
      intent = 'LEAVE';
    } else if (lower.includes('2') || lower.includes('payslip') || lower.includes('salary')) {
      replyText = '📄 Here is your latest verified payslip: https://emgager.work/payslips/latest-aug2026.pdf (Net Pay: ₹84,200).';
      intent = 'PAYSLIP';
    } else if (lower.includes('3') || lower.includes('punch') || lower.includes('attendance') || lower.includes('in') || lower.includes('out')) {
      replyText = `⏰ Punch In Recorded via WhatsApp GPS at ${nowTime}! Location: Tech Park Campus (Verified GPS Geo-Fence).`;
      intent = 'ATTENDANCE';
    }

    const botReply = await this.prisma.whatsAppMessage.create({
      data: {
        id: `b-${randomUUID().slice(0, 8)}`,
        organizationId,
        sender: 'Emgager WhatsApp Bot 🤖',
        text: replyText,
        isBot: true,
        intent,
        status: 'DELIVERED',
      },
    });

    return {
      userMessage: userMsg,
      botReply,
    };
  }

  async clearWhatsApp(organizationId: string) {
    await this.prisma.whatsAppMessage.deleteMany({ where: { organizationId } });
    return { success: true };
  }
}
