import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AUTH_COOKIE } from './../src/common/jwt-payload';
import { PrismaService } from './../src/prisma/prisma.service';

function authCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return (raw ?? []).find((c) => c.startsWith(`${AUTH_COOKIE}=`)) ?? '';
}

describe('Forms Module (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let ownerCookie: string;
  let hrCookie: string;
  let employeeCookie: string;

  const server = () => app.getHttpServer();

  const signIn = async (email: string) => {
    const res = await request(server())
      .post('/auth/login')
      .send({ email, password: 'demo1234' })
      .expect(200);
    return authCookie(res);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Clean up test database
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.membership.deleteMany({});
    await prisma.employee.deleteMany({});
    await prisma.formDefinition.deleteMany({});
    await prisma.formResponse.deleteMany({});

    const passwordHash = '$2b$10$S/JdXTN6BjYEEZaW0FBE5OXgZZ/LGyayrkC6fTZN28BhqIXAXAriC';

    await prisma.user.createMany({
      data: [
        { id: 'usr-1', email: 'hr@demo.com', name: 'Marta Lindqvist', avatarInitials: 'ML', passwordHash },
        { id: 'usr-2', email: 'owner@demo.com', name: 'Priya Nair', avatarInitials: 'PN', passwordHash },
        { id: 'usr-4', email: 'employee@demo.com', name: 'Amit Patel', avatarInitials: 'AP', passwordHash },
      ],
    });

    await prisma.organization.create({
      data: {
        id: 'org-alderway',
        name: 'Alderway Labs',
        address: '4 Wharf Road, London',
        industry: 'Software & Technology',
        ownerId: 'usr-2',
      },
    });

    await prisma.membership.createMany({
      data: [
        { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['employees.*', 'forms.manage'] },
        { id: 'mem-2', userId: 'usr-2', organizationId: 'org-alderway', jobTitle: 'Founder & CEO', permissions: ['*'] },
        { id: 'mem-4', userId: 'usr-4', organizationId: 'org-alderway', jobTitle: 'Software Engineer', permissions: ['attendance.view', 'leave.view'] },
      ],
    });

    ownerCookie = await signIn('owner@demo.com');
    hrCookie = await signIn('hr@demo.com');
    employeeCookie = await signIn('employee@demo.com');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Form Definition and Submission Pipeline', () => {
    let formId: string;

    it('allows HR to create a new form definition with dynamic field types', async () => {
      const res = await request(server())
        .post('/forms')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          title: 'Q3 Product Feedback Survey',
          description: 'Help us improve our development tooling.',
          category: 'Survey',
          fields: [
            { id: 'f-1', label: 'Overall Tooling Satisfaction (1-5)', type: 'RATING', required: true },
            { id: 'f-2', label: 'Primary Development Environment', type: 'SELECT', required: true, options: ['VS Code', 'IntelliJ', 'Neovim'] },
            { id: 'f-3', label: 'Suggestions / Comments', type: 'TEXTAREA', required: false },
          ],
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe('Q3 Product Feedback Survey');
      expect(res.body.fields.length).toBe(3);
      expect(res.body.responses.length).toBe(0);

      formId = res.body.id;
    });

    it('allows anyone in the workspace to list forms', async () => {
      const res = await request(server())
        .get('/forms')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].title).toBe('Q3 Product Feedback Survey');
      expect(res.body[0].fields.length).toBe(3);
    });

    it('allows employees to submit form responses', async () => {
      const res = await request(server())
        .post(`/forms/${formId}/responses`)
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          respondentName: 'Amit Patel',
          answers: {
            'f-1': 5,
            'f-2': 'VS Code',
            'f-3': 'Please speed up the build pipeline.',
          },
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.respondentName).toBe('Amit Patel');
      expect(res.body.answers['f-1']).toBe(5);
    });

    it('allows managers to view submissions', async () => {
      const res = await request(server())
        .get(`/forms/${formId}/responses`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].respondentName).toBe('Amit Patel');
      expect(res.body[0].answers['f-3']).toBe('Please speed up the build pipeline.');
    });

    it('allows managers to delete form definitions (which also purges submissions)', async () => {
      await request(server())
        .delete(`/forms/${formId}`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      // Verify it is gone
      const res = await request(server())
        .get('/forms')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(0);

      // Verify responses are purged from database
      const dbResponses = await prisma.formResponse.findMany({
        where: { formId },
      });
      expect(dbResponses.length).toBe(0);
    });
  });
});
