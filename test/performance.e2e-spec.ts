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

describe('Performance Module (e2e)', () => {
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
    await prisma.attendanceRecord.deleteMany({});
    await prisma.leaveRequest.deleteMany({});
    await prisma.payslip.deleteMany({});
    await prisma.salaryStructure.deleteMany({});
    await prisma.goal.deleteMany({});
    await prisma.review.deleteMany({});
    await prisma.document.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.appraisalCycle.deleteMany({});

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
        { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['employees.*', 'attendance.*', 'leave.*', 'documents.*', 'reports.view', 'team.invite', 'team.view', 'performance.manage'] },
        { id: 'mem-2', userId: 'usr-2', organizationId: 'org-alderway', jobTitle: 'Founder & CEO', permissions: ['*'] },
        { id: 'mem-4', userId: 'usr-4', organizationId: 'org-alderway', jobTitle: 'Software Engineer', permissions: ['attendance.view', 'leave.view', 'performance.view', 'documents.view'] },
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
          startDate: new Date('2025-01-10T00:00:00.000Z'),
          employmentType: 'Full-time',
          workLocation: 'London Headquarters',
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

  describe('Performance Access Control and Scope (ABAC)', () => {
    it('denies performance access when X-Workspace-Id header is missing', async () => {
      await request(server())
        .get('/performance')
        .set('Cookie', employeeCookie)
        .expect(400);
    });

    it('returns me-scope performance record for standard employee', async () => {
      const res = await request(server())
        .get('/performance')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.scope).toBe('me');
      expect(res.body.records.length).toBe(1);
      expect(res.body.records[0].employeeId).toBe('emp-4');
    });

    it('returns company-scope performance records for manager/HR', async () => {
      const res = await request(server())
        .get('/performance')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.scope).toBe('company');
      expect(res.body.records.length).toBe(2);
    });

    it('forbids standard employee from reviewing anyone or setting goals', async () => {
      // Standard employee tries to review HR manager emp-1
      await request(server())
        .post('/performance/reviews/emp-1')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ rating: 5, summary: 'Good manager' })
        .expect(403);

      // Standard employee tries to assign a goal to HR manager emp-1
      await request(server())
        .post('/performance/goals/emp-1')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ title: 'Finish tasks', dueOn: '2026-12-31' })
        .expect(403);
    });

    it('forbids manager/HR from reviewing themselves', async () => {
      await request(server())
        .post('/performance/reviews/emp-1')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ rating: 5, summary: 'Self appraisal' })
        .expect(403);
    });
  });

  describe('Goal Management and Progress Lifecycle', () => {
    let goalId: string;

    it('allows manager/HR to assign goals to employees', async () => {
      await request(server())
        .post('/performance/goals/emp-4')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          title: 'Master NestJS',
          dueOn: '2026-12-31',
        })
        .expect(200);

      // Verify the goal appears in performance records
      const res = await request(server())
        .get('/performance')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.records[0].goals.length).toBe(1);
      expect(res.body.records[0].goals[0].title).toBe('Master NestJS');
      expect(res.body.records[0].goals[0].progress).toBe(0);

      goalId = res.body.records[0].goals[0].id;

      // Verify audit log for goal creation
      const logs = await prisma.auditLog.findMany({ where: { organizationId: 'org-alderway', resource: 'Goal', action: 'CREATE' } });
      expect(logs.length).toBe(1);
      expect(JSON.parse(logs[0].details!)).toEqual({ title: 'Master NestJS' });
    });

    it('allows employees to update progress on their own goals', async () => {
      await request(server())
        .patch(`/performance/goals/${goalId}`)
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ progress: 75 })
        .expect(200);

      // Verify updated progress
      const res = await request(server())
        .get('/performance')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.records[0].goals[0].progress).toBe(75);

      // Verify audit log for progress update
      const updateLogs = await prisma.auditLog.findMany({ where: { organizationId: 'org-alderway', resource: 'Goal', action: 'UPDATE' } });
      expect(updateLogs.length).toBe(1);
      expect(JSON.parse(updateLogs[0].details!)).toEqual({ progress: 75 });
    });

    it('validates goal progress values', async () => {
      await request(server())
        .patch(`/performance/goals/${goalId}`)
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ progress: 120 })
        .expect(400);
    });
  });

  describe('Performance Review and Dashboard Synchronization', () => {
    it('allows manager/HR to submit reviews, calculates distribution, and syncs to Dashboard', async () => {
      // 1. Submit review
      await request(server())
        .post('/performance/reviews/emp-4')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          rating: 4,
          summary: 'Excellent technical capabilities',
        })
        .expect(200);

      // Verify review has been recorded
      const perfData = await request(server())
        .get('/performance')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(perfData.body.records[0].rating).toBe(4);
      expect(perfData.body.records[0].reviews.length).toBe(1);
      expect(perfData.body.records[0].reviews[0].rating).toBe(4);
      expect(perfData.body.records[0].reviews[0].summary).toBe('Excellent technical capabilities');
      expect(perfData.body.summary.avgRating).toBe(4.0);

      // Verify audit log for review submission
      const reviewLogs = await prisma.auditLog.findMany({ where: { organizationId: 'org-alderway', resource: 'Review', action: 'CREATE' } });
      expect(reviewLogs.length).toBe(1);
      expect(JSON.parse(reviewLogs[0].details!)).toEqual({ rating: 4 });

      // 2. Try submitting a duplicate review for the same cycle
      await request(server())
        .post('/performance/reviews/emp-4')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ rating: 5, summary: 'Duplicate review attempt' })
        .expect(409);

      // 3. Verify sync with Dashboard (Average performance stat updates)
      const dashboard = await request(server())
        .get('/dashboard')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      const perfStat = dashboard.body.stats.find((s: any) => s.id === 'st-performance');
      expect(perfStat).toBeDefined();
      expect(perfStat.value).toBe('4.0 / 5');
      expect(perfStat.delta).toBe('1 of 2 reviewed');
    });
  });
});
