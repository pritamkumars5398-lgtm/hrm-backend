import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateFormDto, SubmitResponseDto } from './dto/forms.dto';

function canManage(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('forms.manage') || permissions.includes('forms.*');
}

@Injectable()
export class FormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async createForm(organizationId: string, permissions: string[], dto: CreateFormDto) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage forms.');
    }

    const form = await this.prisma.formDefinition.create({
      data: {
        id: `form-${randomUUID().slice(0, 8)}`,
        organizationId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        category: dto.category,
        fieldsJson: JSON.stringify(dto.fields),
        status: 'PUBLISHED',
      },
    });

    return {
      id: form.id,
      title: form.title,
      description: form.description,
      category: form.category,
      fields: dto.fields,
      responses: [],
      createdAt: form.createdAt.toISOString().slice(0, 10),
    };
  }

  async listForms(organizationId: string, permissions: string[]) {
    // All members can read forms so they can fill them out.
    const forms = await this.prisma.formDefinition.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const responses = await this.prisma.formResponse.findMany({
      where: { organizationId },
    });

    return forms.map((form) => {
      let fields = [];
      try {
        fields = JSON.parse(form.fieldsJson);
      } catch (err) {
        console.error(`Failed to parse fields for form ${form.id}`, err);
      }

      const formResponses = responses
        .filter((r) => r.formId === form.id)
        .map((r) => {
          let answers = {};
          try {
            answers = JSON.parse(r.answersJson);
          } catch (err) {
            console.error(`Failed to parse answers for response ${r.id}`, err);
          }
          return {
            id: r.id,
            formId: r.formId,
            respondentName: r.respondentName,
            submittedAt: r.submittedAt.toISOString().slice(0, 19).replace('T', ' '),
            answers,
          };
        });

      return {
        id: form.id,
        title: form.title,
        description: form.description,
        category: form.category,
        fields,
        responses: formResponses,
        createdAt: form.createdAt.toISOString().slice(0, 10),
      };
    });
  }

  async deleteForm(id: string, organizationId: string, permissions: string[]) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage forms.');
    }

    const form = await this.prisma.formDefinition.findUnique({ where: { id } });
    if (!form || form.organizationId !== organizationId) {
      throw new NotFoundException('Form not found.');
    }

    // Delete form responses first
    await this.prisma.formResponse.deleteMany({
      where: { formId: id, organizationId },
    });

    // Delete form definition
    await this.prisma.formDefinition.delete({ where: { id } });

    return { success: true };
  }

  async submitResponse(formId: string, organizationId: string, dto: SubmitResponseDto) {
    const form = await this.prisma.formDefinition.findUnique({ where: { id: formId } });
    if (!form || form.organizationId !== organizationId) {
      throw new NotFoundException('Form not found.');
    }

    const response = await this.prisma.formResponse.create({
      data: {
        id: `resp-${randomUUID().slice(0, 8)}`,
        organizationId,
        formId,
        respondentName: dto.respondentName.trim(),
        answersJson: JSON.stringify(dto.answers),
      },
    });

    return {
      id: response.id,
      formId: response.formId,
      respondentName: response.respondentName,
      submittedAt: response.submittedAt.toISOString().slice(0, 19).replace('T', ' '),
      answers: dto.answers,
    };
  }

  async listResponses(formId: string, organizationId: string, permissions: string[]) {
    const form = await this.prisma.formDefinition.findUnique({ where: { id: formId } });
    if (!form || form.organizationId !== organizationId) {
      throw new NotFoundException('Form not found.');
    }

    const responses = await this.prisma.formResponse.findMany({
      where: { formId, organizationId },
      orderBy: { submittedAt: 'desc' },
    });

    return responses.map((r) => {
      let answers = {};
      try {
        answers = JSON.parse(r.answersJson);
      } catch (err) {
        console.error(`Failed to parse answers for response ${r.id}`, err);
      }
      return {
        id: r.id,
        formId: r.formId,
        respondentName: r.respondentName,
        submittedAt: r.submittedAt.toISOString().slice(0, 19).replace('T', ' '),
        answers,
      };
    });
  }

  async assignForm(id: string, organizationId: string, permissions: string[], employeeId: string) {
    if (!canManage(permissions)) {
      throw new ForbiddenException('You do not have permission to manage forms.');
    }

    const form = await this.prisma.formDefinition.findUnique({ where: { id } });
    if (!form || form.organizationId !== organizationId) {
      throw new NotFoundException('Form not found.');
    }

    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee || employee.organizationId !== organizationId || employee.deletedAt) {
      throw new NotFoundException('Employee not found.');
    }

    await this.notifications.create({
      userId: employee.userId,
      organizationId,
      title: 'New form assigned',
      body: `Please fill out the form: "${form.title}"`,
      kind: 'form',
      link: '/dashboard/forms/my-forms',
    });

    return { success: true };
  }
}
