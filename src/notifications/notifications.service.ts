import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { sendPushToTokens } from '../common/firebase-admin';
import { NotificationsGateway } from './notifications.gateway';
import { toPublicNotification, type PublicNotification } from './notification.entity';

type CreateParams = {
  userId: string;
  organizationId: string;
  title: string;
  body: string;
  kind: string;
  link?: string;
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly gateway: NotificationsGateway,
  ) {}

  /**
   * Persists one notification, emits it over the WebSocket gateway to any
   * open tab (the actual real-time channel), and best-effort pushes it to
   * the recipient's registered devices for when no tab is open. Neither the
   * socket emit nor the push failing ever rolls back the DB row — the in-app
   * bell is the source of truth; both delivery channels are bonuses on top.
   */
  async create(params: CreateParams): Promise<void> {
    const created = await this.prisma.notification.create({
      data: {
        id: `ntf-${randomUUID().slice(0, 8)}`,
        organizationId: params.organizationId,
        userId: params.userId,
        title: params.title,
        body: params.body,
        kind: params.kind,
        link: params.link ?? null,
      },
    });

    this.gateway.emitToUser(params.userId, toPublicNotification(created));

    const user = await this.prisma.user.findUnique({ where: { id: params.userId }, select: { fcmTokens: true } });
    if (user?.fcmTokens.length) {
      await sendPushToTokens(
        this.configService,
        user.fcmTokens,
        { title: params.title, body: params.body },
        params.link ? { link: params.link } : undefined,
      );
    }
  }

  /** Same event, many recipients — e.g. everyone who holds documents.view. */
  async createForMany(userIds: string[], params: Omit<CreateParams, 'userId'>): Promise<void> {
    await Promise.all(userIds.map((userId) => this.create({ ...params, userId })));
  }

  /**
   * Push-only, no DB row — used when the organization itself is about to be
   * deleted (§ Organizations.remove). A persisted Notification scoped to a
   * dying org would never be reachable again: the workspace switcher drops
   * the org from the recipient's list in the same moment, so there is no
   * "active org" context left under which the bell could ever show it.
   */
  async pushOnly(userIds: string[], notification: { title: string; body: string }): Promise<void> {
    if (userIds.length === 0) return;
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { fcmTokens: true } });
    const tokens = users.flatMap((u) => u.fcmTokens);
    await sendPushToTokens(this.configService, tokens, notification);
  }

  async list(userId: string, organizationId: string): Promise<{ notifications: PublicNotification[]; unreadCount: number }> {
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, organizationId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.notification.count({ where: { userId, organizationId, read: false } }),
    ]);

    return { notifications: rows.map(toPublicNotification), unreadCount };
  }

  async markRead(id: string, userId: string): Promise<void> {
    const existing = await this.prisma.notification.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Notification not found.');
    }
    if (existing.read) return;
    await this.prisma.notification.update({ where: { id }, data: { read: true } });
  }

  async markAllRead(userId: string, organizationId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, organizationId, read: false },
      data: { read: true },
    });
  }

  /** Idempotent — the same browser calling this again (e.g. on every login)
   *  must not pile up duplicate tokens. */
  async registerToken(userId: string, token: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fcmTokens: true } });
    if (!user || user.fcmTokens.includes(token)) return;

    await this.prisma.user.update({
      where: { id: userId },
      data: { fcmTokens: { push: token } },
    });
  }
}
