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

describe('Centralized Approvals Module (e2e)', () => {
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

    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.membership.deleteMany({});
    await prisma.employee.deleteMany({});
    await prisma.leaveRequest.deleteMany({});
    await prisma.approvalRequest.deleteMany({});
    await prisma.notification.deleteMany({});

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
        { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['employees.*', 'leave.approve', 'approvals.manage'] },
        { id: 'mem-2', userId: 'usr-2', organizationId: 'org-alderway', jobTitle: 'Founder & CEO', permissions: ['*'] },
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

    ownerCookie = await signIn('owner@demo.com');
    hrCookie = await signIn('hr@demo.com');
    employeeCookie = await signIn('employee@demo.com');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Centralized Approvals Flow', () => {
    let leaveRequestId: string;
    let approvalRequestId: string;

    it('creates a leave request, which automatically registers a pending approval', async () => {
      // 1. Apply Leave
      const res = await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'ANNUAL',
          startDate: '2026-09-10',
          endDate: '2026-09-12',
          reason: 'Short family trip',
        })
        .expect(201);

      leaveRequestId = res.body.id;

      // 2. Fetch pending approvals as HR
      const approvalsRes = await request(server())
        .get('/approvals/pending')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(approvalsRes.body.length).toBe(1);
      expect(approvalsRes.body[0].sourceModule).toBe('Leave');
      expect(approvalsRes.body[0].sourceRecordId).toBe(leaveRequestId);
      expect(approvalsRes.body[0].status).toBe('PENDING');

      approvalRequestId = approvalsRes.body[0].id;
    });

    it('allows managers to decide on the approval, which updates original module', async () => {
      // 1. Approve centralized request
      const res = await request(server())
        .patch(`/approvals/${approvalRequestId}/decide`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          status: 'APPROVED',
        })
        .expect(200);

      expect(res.body.status).toBe('APPROVED');

      // 2. Verify original leave request status is APPROVED
      const leaveRes = await request(server())
        .get('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      const approvedReq = leaveRes.body.requests.find((r: any) => r.id === leaveRequestId);
      expect(approvedReq).toBeDefined();
      expect(approvedReq.status).toBe('APPROVED');
    });

    it('triggers a notification to the employee upon decision', async () => {
      const notifyRes = await request(server())
        .get('/notifications')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      const approvalNotification = notifyRes.body.notifications.find(
        (n: any) => n.kind === 'leave' && n.title.includes('Approved'),
      );
      expect(approvalNotification).toBeDefined();
    });
  });
});
