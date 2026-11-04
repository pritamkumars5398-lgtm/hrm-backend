import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { randomUUID } from 'node:crypto';

export type CreateEngagementPostDto = {
  content: string;
  type?: 'KUDOS' | 'ANNOUNCEMENT' | 'BIRTHDAY' | 'ANNIVERSARY';
  targetUser?: string;
  badge?: string;
};

@Injectable()
export class EngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getAll(organizationId: string) {

    const feed = await this.prisma.engagementPost.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const celebrations = [
      {
        id: 'cel-1',
        name: 'Vikram Mehta',
        type: 'BIRTHDAY',
        subtitle: 'Birthday Today 🎂',
        date: new Date().toISOString().split('T')[0],
      },
      {
        id: 'cel-2',
        name: 'Ananya Verma',
        type: 'ANNIVERSARY',
        subtitle: '2-Year Work Anniversary 🎈',
        date: new Date().toISOString().split('T')[0],
      },
      {
        id: 'cel-3',
        name: 'Suresh Raina',
        type: 'ANNIVERSARY',
        subtitle: '3-Year Work Anniversary 🎖️',
        date: new Date().toISOString().split('T')[0],
      },
    ];

    return {
      feed,
      celebrations,
    };
  }

  async create(
    organizationId: string,
    author: string,
    authorRole: string,
    dto: CreateEngagementPostDto,
  ) {
    const created = await this.prisma.engagementPost.create({
      data: {
        id: `f-${randomUUID().slice(0, 8)}`,
        organizationId,
        author: author || 'Team Member',
        role: authorRole || 'Employee',
        type: dto.type || (dto.targetUser ? 'KUDOS' : 'ANNOUNCEMENT'),
        content: dto.content,
        targetUser: dto.targetUser,
        badge: dto.badge || (dto.targetUser ? 'Team Player' : undefined),
        likes: 1,
        likedBy: [author],
      },
    });

    if (dto.targetUser) {
      try {
        await this.notifications.create({
          organizationId,
          userId: dto.targetUser,
          title: `Kudos Received! 🎉`,
          body: `${author} gave you a "${created.badge}" kudos badge: "${dto.content.slice(0, 60)}..."`,
          kind: 'KUDOS',
          link: '/dashboard/engagement',
        });
      } catch {
        // Notification failure is non-blocking
      }
    }

    return created;
  }

  async like(organizationId: string, id: string, userName: string) {
    const post = await this.prisma.engagementPost.findFirst({
      where: { id, organizationId },
    });
    if (!post) throw new NotFoundException('Post not found');

    const hasLiked = post.likedBy?.includes(userName);
    const updatedLikedBy = hasLiked
      ? post.likedBy.filter((u) => u !== userName)
      : [...(post.likedBy || []), userName];
    const updatedLikes = Math.max(0, post.likes + (hasLiked ? -1 : 1));

    return this.prisma.engagementPost.update({
      where: { id },
      data: {
        likes: updatedLikes,
        likedBy: updatedLikedBy,
      },
    });
  }

  async delete(organizationId: string, id: string) {
    const post = await this.prisma.engagementPost.findFirst({
      where: { id, organizationId },
    });
    if (!post) throw new NotFoundException('Post not found');

    await this.prisma.engagementPost.delete({ where: { id } });
    return { success: true };
  }
}
