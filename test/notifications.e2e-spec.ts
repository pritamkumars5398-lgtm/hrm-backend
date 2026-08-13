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

describe('Notifications Module (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

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

    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.membership.deleteMany({});
    await prisma.employee.deleteMany({});
    await prisma.notification.deleteMany({});

    const passwordHash = '$2b$10$S/JdXTN6BjYEEZaW0FBE5OXgZZ/LGyayrkC6fTZN28BhqIXAXAriC';

    await prisma.user.createMany({
      data: [
        { id: 'usr-1', email: 'hr@demo.com', name: 'Marta Lindqvist', avatarInitials: 'ML', passwordHash, fcmTokens: [] },
        { id: 'usr-4', email: 'employee@demo.com', name: 'Amit Patel', avatarInitials: 'AP', passwordHash, fcmTokens: [] },
      ],
    });

    await prisma.organization.create({
      data: {
        id: 'org-alderway',
        name: 'Alderway Labs',
        address: '4 Wharf Road, London',
        industry: 'Software & Technology',
        ownerId: 'usr-1',
      },
    });

    await prisma.membership.createMany({
      data: [
        { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['*'] },
        { id: 'mem-4', userId: 'usr-4', organizationId: 'org-alderway', jobTitle: 'Software Engineer', permissions: ['leave.view'] },
      ],
    });

    await prisma.employee.createMany({
      data: [
        {
          id: 'emp-1',
          userId: 'usr-1',
          organizationId: 'org-alderway',
          employeeId: 'EMP-2026-0001',
          firstName: 'Marta',
          lastName: 'Lindqvist',
          jobTitle: 'HR Manager',
          department: 'Human Resources',
          startDate: new Date('2024-01-15T00:00:00.000Z'),
          employmentType: 'Full-time',
          workLocation: 'Stockholm Office',
        },
        {
          id: 'emp-4',
          userId: 'usr-4',
          organizationId: 'org-alderway',
          employeeId: 'EMP-2026-0004',
          firstName: 'Amit',
          lastName: 'Patel',
          jobTitle: 'Software Engineer',
          department: 'Engineering',
          startDate: new Date('2024-06-15T00:00:00.000Z'),
          employmentType: 'Full-time',
          workLocation: 'London Office',
        },
      ],
    });

    // Seed test notifications
    await prisma.notification.createMany({
      data: [
        {
          id: 'ntf-emp-1',
          organizationId: 'org-alderway',
          userId: 'usr-4',
          title: 'Leave Request Approved',
          body: 'Your leave request for 2026-09-01 to 2026-09-03 has been approved.',
          kind: 'leave',
          link: '/dashboard/leave',
          read: false,
        },
        {
          id: 'ntf-emp-2',
          organizationId: 'org-alderway',
          userId: 'usr-4',
          title: 'Payslip Finalized',
          body: 'Your August 2026 payslip is now available.',
          kind: 'payroll',
          link: '/dashboard/payroll',
          read: false,
        },
        {
          id: 'ntf-hr-1',
          organizationId: 'org-alderway',
          userId: 'usr-1',
          title: 'New Leave Request',
          body: 'Amit Patel requested 3 days leave.',
          kind: 'leave',
          link: '/dashboard/leave',
          read: false,
        },
      ],
    });

    hrCookie = await signIn('hr@demo.com');
    employeeCookie = await signIn('employee@demo.com');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /notifications', () => {
    it('returns recipient-scoped notifications and unread count', async () => {
      const res = await request(server())
        .get('/notifications')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.unreadCount).toBe(2);
      expect(res.body.notifications.length).toBe(2);
      expect(res.body.notifications[0].title).toBeDefined();
    });
  });

  describe('POST /notifications/:id/read', () => {
    it('marks a notification as read for recipient', async () => {
      await request(server())
        .post('/notifications/ntf-emp-1/read')
        .set('Cookie', employeeCookie)
        .expect(200);

      const res = await request(server())
        .get('/notifications')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.unreadCount).toBe(1);
    });

    it('rejects attempt to mark another user notification as read', async () => {
      await request(server())
        .post('/notifications/ntf-hr-1/read')
        .set('Cookie', employeeCookie)
        .expect(404);
    });
  });

  describe('POST /notifications/read-all', () => {
    it('marks all recipient notifications as read', async () => {
      await request(server())
        .post('/notifications/read-all')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      const res = await request(server())
        .get('/notifications')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.unreadCount).toBe(0);
    });
  });

  describe('POST /notifications/register-token', () => {
    it('registers FCM push token idempotently', async () => {
      await request(server())
        .post('/notifications/register-token')
        .set('Cookie', employeeCookie)
        .send({ token: 'fcm-test-token-12345' })
        .expect(200);

      const user = await prisma.user.findUnique({ where: { id: 'usr-4' } });
      expect(user?.fcmTokens).toContain('fcm-test-token-12345');
    });
  });
});
