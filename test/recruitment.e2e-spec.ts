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

describe('Recruitment & Digital Onboarding (e2e)', () => {
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
    await prisma.jobRequisition.deleteMany({});
    await prisma.candidate.deleteMany({});
    await prisma.invite.deleteMany({});

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
          jobTitle: 'HR Manager',
          department: 'Human Resources',
          startDate: new Date('2024-01-15T00:00:00.000Z'),
          employmentType: 'Full-time',
          workLocation: 'Stockholm Office',
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

  describe('Recruitment / ATS and Onboarding Workflow', () => {
    let jobId: string;
    let candidateId: string;

    it('allows HR to create a new job requisition', async () => {
      const res = await request(server())
        .post('/recruitment/jobs')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          title: 'Senior Frontend Architect',
          department: 'Engineering',
          location: 'Bengaluru / Remote',
          headcount: 2,
          description: 'Build enterprise React/Nest apps',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe('Senior Frontend Architect');
      expect(res.body.status).toBe('OPEN');

      jobId = res.body.id;
    });

    it('allows HR to list job requisitions', async () => {
      const res = await request(server())
        .get('/recruitment/jobs')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].title).toBe('Senior Frontend Architect');
    });

    it('allows HR to add a new candidate', async () => {
      const res = await request(server())
        .post('/recruitment/candidates')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          name: 'Vikram Seth',
          email: 'vikram.seth@example.com',
          phone: '+919999999999',
          requisitionId: jobId,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Vikram Seth');
      expect(res.body.stage).toBe('APPLIED');

      candidateId = res.body.id;
    });

    it('allows HR to list candidates', async () => {
      const res = await request(server())
        .get('/recruitment/candidates')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('Vikram Seth');
    });

    it('supports advancing candidate through pipeline stages', async () => {
      // APPLIED -> SCREENED
      await request(server())
        .patch(`/recruitment/candidates/${candidateId}/stage`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ stage: 'SCREENED' })
        .expect(200);

      // SCREENED -> INTERVIEW
      await request(server())
        .patch(`/recruitment/candidates/${candidateId}/stage`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ stage: 'INTERVIEW' })
        .expect(200);

      // INTERVIEW -> OFFERED (Candidate Selected / Onboarding starts)
      const res = await request(server())
        .patch(`/recruitment/candidates/${candidateId}/stage`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ stage: 'OFFERED' })
        .expect(200);

      expect(res.body.stage).toBe('OFFERED');
    });

    it('creates employee and invite when candidate is HIRED, preventing duplicate creation', async () => {
      // 1. Move to HIRED (Verification and Employee Creation)
      const res = await request(server())
        .patch(`/recruitment/candidates/${candidateId}/stage`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ stage: 'HIRED' })
        .expect(200);

      expect(res.body.stage).toBe('HIRED');

      // 2. Verify that Invite record exists
      const invites = await prisma.invite.findMany({
        where: { organizationId: 'org-alderway', email: 'vikram.seth@example.com' },
      });
      expect(invites.length).toBe(1);
      expect(invites[0].status).toBe('PENDING');

      // 3. Verify that Employee record exists with correct job title & department (Active Employee / New Joiner)
      const employees = await prisma.employee.findMany({
        where: { organizationId: 'org-alderway', firstName: 'Vikram', lastName: 'Seth' },
      });
      expect(employees.length).toBe(1);
      expect(employees[0].jobTitle).toBe('Senior Frontend Architect');
      expect(employees[0].department).toBe('Engineering');
      expect(employees[0].deletedAt).toBeNull();

      // 4. Verify that duplicate hiring attempt is rejected with 409 Conflict
      await request(server())
        .patch(`/recruitment/candidates/${candidateId}/stage`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ stage: 'HIRED' })
        .expect(409);

      // Verify that duplicate invite attempt for same email is rejected with 409 Conflict even if stage transition is attempted on another candidate
      const secondCandidate = await request(server())
        .post('/recruitment/candidates')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          name: 'Vikram Seth Duplicate',
          email: 'vikram.seth@example.com', // same email
          requisitionId: jobId,
        })
        .expect(201);

      await request(server())
        .patch(`/recruitment/candidates/${secondCandidate.body.id}/stage`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ stage: 'HIRED' })
        .expect(409);
    });

    it('supports job requisition approval workflow and records audit logs', async () => {
      // 1. Create a draft job requisition
      const draftRes = await request(server())
        .post('/recruitment/jobs')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          title: 'Staff Security Engineer',
          department: 'Security',
          location: 'London',
          headcount: 1,
          status: 'DRAFT',
        })
        .expect(201);
      expect(draftRes.body.status).toBe('DRAFT');

      const draftJobId = draftRes.body.id;

      // 2. Submit it for approval
      await request(server())
        .post(`/recruitment/jobs/${draftJobId}/submit`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(201);

      // Verify status is PENDING
      const listRes = await request(server())
        .get('/recruitment/jobs')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
      const pendingJob = listRes.body.find((j: any) => j.id === draftJobId);
      expect(pendingJob.status).toBe('PENDING');

      // 3. Find the pending approval request
      const approvals = await prisma.approvalRequest.findMany({
        where: { organizationId: 'org-alderway', sourceModule: 'Recruitment', sourceRecordId: draftJobId }
      });
      expect(approvals.length).toBe(1);
      expect(approvals[0].status).toBe('PENDING');

      const approvalId = approvals[0].id;

      // 4. Decide on approval request (Approve it using Owner's cookie)
      await request(server())
        .patch(`/approvals/${approvalId}/decide`)
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ status: 'APPROVED' })
        .expect(200);

      // 5. Verify the JobRequisition status is now OPEN
      const openJob = await prisma.jobRequisition.findUnique({ where: { id: draftJobId } });
      expect(openJob?.status).toBe('OPEN');

      // 6. Verify audit logs are written
      const jobLogs = await prisma.auditLog.findMany({
        where: { organizationId: 'org-alderway', resource: 'JobRequisition' },
        orderBy: { timestamp: 'asc' },
      });
      expect(jobLogs.length).toBe(3);
      expect(JSON.parse(jobLogs[0].details!)).toEqual({ title: 'Senior Frontend Architect', department: 'Engineering' });
      expect(JSON.parse(jobLogs[1].details!)).toEqual({ title: 'Staff Security Engineer', department: 'Security' });
      expect(JSON.parse(jobLogs[2].details!)).toEqual({ status: 'PENDING' });

      // Verify audit logs for Candidate
      const candidateLogs = await prisma.auditLog.findMany({
        where: { organizationId: 'org-alderway', resource: 'Candidate' },
        orderBy: { timestamp: 'asc' },
      });
      expect(candidateLogs.length).toBe(6);
      expect(JSON.parse(candidateLogs[0].details!)).toEqual({ name: 'Vikram Seth', email: 'vikram.seth@example.com' });
      expect(JSON.parse(candidateLogs[4].details!)).toEqual({ stage: 'HIRED' });
      expect(JSON.parse(candidateLogs[5].details!)).toEqual({ name: 'Vikram Seth Duplicate', email: 'vikram.seth@example.com' });
    });
  });
});
