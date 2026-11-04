import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'node:crypto';

@Injectable()
export class FormsService {
  constructor(private readonly prisma: PrismaService) {}

  async getForms(organizationId: string) {
    const forms = await this.prisma.formDefinition.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const formIds = forms.map((f) => f.id);
    const responses = await this.prisma.formResponse.findMany({
      where: { formId: { in: formIds } },
      orderBy: { submittedAt: 'desc' },
    });

    return forms.map((form) => {
      let fields: any[] = [];
      try {
        fields = JSON.parse(form.fieldsJson || '[]');
      } catch {
        fields = [];
      }

      const formResponses = responses
        .filter((r) => r.formId === form.id)
        .map((r) => {
          let answers: Record<string, any> = {};
          try {
            answers = JSON.parse(r.answersJson || '{}');
          } catch {
            answers = {};
          }
          return {
            id: r.id,
            formId: r.formId,
            respondentName: r.respondentName,
            submittedAt: r.submittedAt.toISOString().replace('T', ' ').slice(0, 16),
            answers,
          };
        });

      return {
        id: form.id,
        title: form.title,
        description: form.description || '',
        category: form.category,
        status: form.status,
        fields,
        responses: formResponses,
        createdAt: form.createdAt.toISOString().slice(0, 10),
      };
    });
  }

  async getFormById(id: string, organizationId: string) {
    const form = await this.prisma.formDefinition.findFirst({
      where: { id, organizationId },
    });

    if (!form) {
      throw new NotFoundException(`Form with id ${id} not found`);
    }

    const responses = await this.prisma.formResponse.findMany({
      where: { formId: id },
      orderBy: { submittedAt: 'desc' },
    });

    let fields: any[] = [];
    try {
      fields = JSON.parse(form.fieldsJson || '[]');
    } catch {
      fields = [];
    }

    const formResponses = responses.map((r) => {
      let answers: Record<string, any> = {};
      try {
        answers = JSON.parse(r.answersJson || '{}');
      } catch {
        answers = {};
      }
      return {
        id: r.id,
        formId: r.formId,
        respondentName: r.respondentName,
        submittedAt: r.submittedAt.toISOString().replace('T', ' ').slice(0, 16),
        answers,
      };
    });

    return {
      id: form.id,
      title: form.title,
      description: form.description || '',
      category: form.category,
      status: form.status,
      fields,
      responses: formResponses,
      createdAt: form.createdAt.toISOString().slice(0, 10),
    };
  }

  async createForm(
    organizationId: string,
    data: {
      title: string;
      description?: string;
      category?: string;
      fields: any[];
      status?: string;
    },
  ) {
    const id = `form-${Date.now()}`;
    const form = await this.prisma.formDefinition.create({
      data: {
        id,
        organizationId,
        title: data.title,
        description: data.description || '',
        category: data.category || 'Survey',
        fieldsJson: JSON.stringify(data.fields || []),
        status: data.status || 'PUBLISHED',
      },
    });

    return {
      id: form.id,
      title: form.title,
      description: form.description || '',
      category: form.category,
      status: form.status,
      fields: data.fields || [],
      responses: [],
      createdAt: form.createdAt.toISOString().slice(0, 10),
    };
  }

  async deleteForm(id: string, organizationId: string) {
    await this.prisma.formResponse.deleteMany({
      where: { formId: id, organizationId },
    });

    await this.prisma.formDefinition.deleteMany({
      where: { id, organizationId },
    });

    return { success: true };
  }

  async submitResponse(
    formId: string,
    organizationId: string,
    respondentName: string,
    answers: Record<string, any>,
  ) {
    const form = await this.prisma.formDefinition.findFirst({
      where: { id: formId, organizationId },
    });

    if (!form) {
      throw new NotFoundException(`Form with id ${formId} not found`);
    }

    const id = `resp-${Date.now()}`;
    const response = await this.prisma.formResponse.create({
      data: {
        id,
        formId,
        organizationId,
        respondentName: respondentName.trim(),
        answersJson: JSON.stringify(answers || {}),
      },
    });

    return {
      id: response.id,
      formId: response.formId,
      respondentName: response.respondentName,
      submittedAt: response.submittedAt.toISOString().replace('T', ' ').slice(0, 16),
      answers,
    };
  }
}
