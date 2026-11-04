import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { randomUUID } from 'node:crypto';

export type CreateCourseDto = {
  title: string;
  category: 'Compliance' | 'Engineering' | 'Management' | 'Security';
  durationMins: number;
  isMandatory?: boolean;
  instructor?: string;
  description?: string;
};

@Injectable()
export class LmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getCourses(organizationId: string) {

    const courses = await this.prisma.course.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });

    return courses.map((c) => ({
      id: c.id,
      title: c.title,
      category: c.category as 'Compliance' | 'Engineering' | 'Management' | 'Security',
      durationMins: c.durationMins,
      progressPercent: c.progressPercent,
      isMandatory: c.isMandatory,
      instructor: c.instructor,
      description: c.description || '',
      createdAt: c.createdAt.toISOString().slice(0, 10),
    }));
  }

  async updateProgress(organizationId: string, courseId: string, progressDelta?: number) {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, organizationId },
    });
    if (!course) throw new NotFoundException('Course not found.');

    const delta = progressDelta ?? 25;
    const newProgress = Math.min(100, Math.max(0, course.progressPercent + delta));

    const updated = await this.prisma.course.update({
      where: { id: courseId },
      data: { progressPercent: newProgress },
    });

    if (newProgress === 100 && course.progressPercent < 100) {
      const memberships = await this.prisma.membership.findMany({ where: { organizationId } });
      if (memberships.length > 0) {
        await this.notifications.createForMany(
          memberships.map((m) => m.userId),
          {
            organizationId,
            title: 'Course Completed & Certified',
            body: `Completed "${course.title}". Verified digital certificate is now available.`,
            kind: 'lms',
            link: '/dashboard/lms',
          },
        );
      }
    }

    return {
      id: updated.id,
      title: updated.title,
      category: updated.category as 'Compliance' | 'Engineering' | 'Management' | 'Security',
      durationMins: updated.durationMins,
      progressPercent: updated.progressPercent,
      isMandatory: updated.isMandatory,
      instructor: updated.instructor,
      description: updated.description || '',
    };
  }

  async createCourse(organizationId: string, dto: CreateCourseDto) {
    if (!dto.title?.trim() || !dto.category) {
      throw new BadRequestException('Course title and category are required.');
    }

    const created = await this.prisma.course.create({
      data: {
        id: `c-${randomUUID().slice(0, 8)}`,
        organizationId,
        title: dto.title.trim(),
        category: dto.category,
        durationMins: dto.durationMins || 60,
        progressPercent: 0,
        isMandatory: dto.isMandatory ?? false,
        instructor: dto.instructor?.trim() || 'HR Training Desk',
        description: dto.description || '',
      },
    });

    return {
      id: created.id,
      title: created.title,
      category: created.category as 'Compliance' | 'Engineering' | 'Management' | 'Security',
      durationMins: created.durationMins,
      progressPercent: created.progressPercent,
      isMandatory: created.isMandatory,
      instructor: created.instructor,
      description: created.description || '',
    };
  }

  async deleteCourse(organizationId: string, id: string) {
    const existing = await this.prisma.course.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Course not found.');

    await this.prisma.course.delete({ where: { id } });
    return { ok: true };
  }
}
