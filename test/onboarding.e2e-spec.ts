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

describe('Onboarding & Checklists (e2e)', () => {
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
    await prisma.invite.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.jobRequisition.deleteMany({});
    await prisma.candidate.deleteMany({});
    await prisma.onboarding.deleteMany({});
    await prisma.onboardingTask.deleteMany({});

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
        { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['employees.*', 'attendance.*', 'leave.*', 'documents.*', 'reports.view', 'team.invite', 'team.view', 'recruitment.manage'] },
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
          gender: 'FEMALE',
          jobTitle: 'HR Manager',
          department: 'Human Resources',
          startDate: new Date('2026-01-01T00:00:00Z'),
          employmentType: 'FULL_TIME',
          workLocation: 'London',
        },
        {
          id: 'emp-2',
          userId: 'usr-2',
          organizationId: 'org-alderway',
          employeeId: 'EMP-2026-0002',
          firstName: 'Priya',
          lastName: 'Nair',
          gender: 'FEMALE',
          jobTitle: 'CEO',
          department: 'Executive',
          startDate: new Date('2026-01-01T00:00:00Z'),
          employmentType: 'FULL_TIME',
          workLocation: 'London',
        },
        {
          id: 'emp-4',
          userId: 'usr-4',
          organizationId: 'org-alderway',
          employeeId: 'EMP-2026-0004',
          firstName: 'Amit',
          lastName: 'Patel',
          gender: 'MALE',
          jobTitle: 'Software Engineer',
          department: 'Engineering',
          startDate: new Date('2026-03-01T00:00:00Z'),
          employmentType: 'FULL_TIME',
          workLocation: 'London',
        },
      ],
    });

    ownerCookie = await signIn('owner@demo.com');
    hrCookie = await signIn('hr@demo.com');
    employeeCookie = await signIn('employee@demo.com');
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Recruitment to Onboarding Handoff Flow', () => {
    let jobId: string;
    let candidateId: string;
    let newEmployeeId: string;

    it('creates job and candidate, then transitions to HIRED to trigger onboarding', async () => {
      // 1. Create Job
      const jobRes = await request(server())
        .post('/recruitment/jobs')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          title: 'Infrastructure Architect',
          department: 'DevOps',
          location: 'Remote',
          headcount: 1,
        })
        .expect(201);
      jobId = jobRes.body.id;

      // 2. Create Candidate
      const candRes = await request(server())
        .post('/recruitment/candidates')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          name: 'Sarah Connor',
          email: 'sarah.connor@cyberdyne.com',
          requisitionId: jobId,
        })
        .expect(201);
      candidateId = candRes.body.id;

      // 3. Move candidate to HIRED
      await request(server())
        .patch(`/recruitment/candidates/${candidateId}/stage`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ stage: 'HIRED' })
        .expect(200);

      // 4. Verify that Employee was created
      const user = await prisma.user.findFirst({ where: { email: 'sarah.connor@cyberdyne.com' } });
      expect(user).toBeDefined();

      const employee = await prisma.employee.findFirst({
        where: { userId: user!.id, organizationId: 'org-alderway' },
      });
      expect(employee).toBeDefined();
      expect(employee!.jobTitle).toBe('Infrastructure Architect');
      expect(employee!.department).toBe('DevOps');
      newEmployeeId = employee!.id;

      // 5. Verify that Onboarding record exists with default tasks
      const onboarding = await prisma.onboarding.findUnique({
        where: { employeeId: newEmployeeId },
      });
      expect(onboarding).toBeDefined();
      expect(onboarding!.status).toBe('IN_PROGRESS');

      const tasks = await prisma.onboardingTask.findMany({
        where: { onboardingId: onboarding!.id },
      });
      expect(tasks.length).toBe(4);
      expect(tasks.map((t) => t.category).sort()).toEqual(['EMPLOYEE', 'HR', 'IT', 'MANAGER'].sort());
    });

    it('returns lists of onboarding checklists scoped by ABAC permissions', async () => {
      // HR view: should return all onboardings (scope: company)
      const hrRes = await request(server())
        .get('/onboarding')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
      expect(hrRes.body.scope).toBe('company');
      expect(hrRes.body.records.length).toBe(1);
      expect(hrRes.body.records[0].employeeName).toBe('Sarah Connor');
      expect(hrRes.body.records[0].tasks.length).toBe(4);

      // Employee view: should return empty or self (scope: me) since Amit has no onboarding
      const empRes = await request(server())
        .get('/onboarding')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
      expect(empRes.body.scope).toBe('me');
      expect(empRes.body.records.length).toBe(0);
    });

    it('allows HR to add a custom onboarding task', async () => {
      const res = await request(server())
        .post(`/onboarding/${newEmployeeId}/tasks`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          title: 'Attend Security Compliance Seminar',
          description: 'Attend the mandatory Monday DevOps security briefing.',
          category: 'IT',
          dueDate: '2026-08-20',
        })
        .expect(201);

      expect(res.body.title).toBe('Attend Security Compliance Seminar');
      expect(res.body.status).toBe('PENDING');

      // Verify task count is now 5
      const count = await prisma.onboardingTask.count({});
      expect(count).toBe(5);
    });

    it('blocks task update or completion from unauthorized memberships', async () => {
      const tasks = await prisma.onboardingTask.findMany({});
      const taskId = tasks[0].id;

      // Amit Patel should not be allowed to change Sarah Connor's tasks
      await request(server())
        .patch(`/onboarding/tasks/${taskId}`)
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ status: 'COMPLETED' })
        .expect(403);
    });

    it('allows HR to complete onboarding tasks and check checklist progress', async () => {
      const tasks = await prisma.onboardingTask.findMany({});
      
      // Mark 3 tasks completed
      for (let i = 0; i < 3; i++) {
        await request(server())
          .patch(`/onboarding/tasks/${tasks[i].id}`)
          .set('Cookie', hrCookie)
          .set('X-Workspace-Id', 'org-alderway')
          .send({ status: 'COMPLETED' })
          .expect(200);
      }

      const hrRes = await request(server())
        .get('/onboarding')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
      
      // Progress calculation: 3 out of 5 tasks completed = 60%
      expect(hrRes.body.records[0].checklistProgress).toBe(60);
    });

    it('denies onboarding finalization if pending tasks exist', async () => {
      await request(server())
        .post(`/onboarding/${newEmployeeId}/complete`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(400); // 400 Bad Request
    });

    it('finalizes onboarding once all tasks are completed', async () => {
      const pending = await prisma.onboardingTask.findMany({ where: { status: 'PENDING' } });
      for (const task of pending) {
        await request(server())
          .patch(`/onboarding/tasks/${task.id}`)
          .set('Cookie', hrCookie)
          .set('X-Workspace-Id', 'org-alderway')
          .send({ status: 'COMPLETED' })
          .expect(200);
      }

      await request(server())
        .post(`/onboarding/${newEmployeeId}/complete`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(201);

      // Verify onboarding status is COMPLETED
      const onboarding = await prisma.onboarding.findUnique({ where: { employeeId: newEmployeeId } });
      expect(onboarding!.status).toBe('COMPLETED');

      // Verify audit logs exist
      const logs = await prisma.auditLog.findMany({
        where: { resource: 'Onboarding' },
      });
      expect(logs.length).toBe(2); // One for CREATE, one for UPDATE to COMPLETED
    });
  });
});
