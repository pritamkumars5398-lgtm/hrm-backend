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

describe('Payroll and Payslips Module (e2e)', () => {
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
        { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['employees.*', 'attendance.*', 'leave.*', 'documents.*', 'reports.view', 'team.invite', 'team.view', 'payroll.manage'] },
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

  describe('Payroll Access Control (ABAC)', () => {
    it('forbids standard employee from listing company-wide salaries and payslips', async () => {
      await request(server())
        .get('/payroll/salary')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(403);

      // Payslips endpoint falls back to returning only the caller's own
      // finalized payslips (200 OK with []) when the caller has no payroll permissions.
      const res = await request(server())
        .get('/payroll/payslips?month=2026-08')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('permits HR/Admin to list company-wide salaries and payslips', async () => {
      await request(server())
        .get('/payroll/salary')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      await request(server())
        .get('/payroll/payslips?month=2026-08')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
    });

    it('allows standard employee to view only their own finalized payslips', async () => {
      // Initially, no finalized payslip exists
      const res = await request(server())
        .get('/payroll/payslips?month=2026-08&scope=me')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  describe('Salary Structure and Payslip Generation Lifecycle', () => {
    it('fails to submit payslip for approval when no salary structure is defined', async () => {
      await request(server())
        .post('/payroll/payslips/emp-4/submit-approval?month=2026-08')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(400);
    });

    it('allows HR to save and retrieve employee salary structure', async () => {
      const res = await request(server())
        .post('/payroll/salary/emp-4')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          basic: 50000,
          hra: 20000,
          otherAllowance: 10000,
          effectiveFrom: '2026-08-01',
        })
        .expect(201);

      expect(res.body.basic).toBe(50000);
      expect(res.body.hra).toBe(20000);
      expect(res.body.otherAllowance).toBe(10000);

      const history = await request(server())
        .get('/payroll/salary/emp-4/history')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(history.body.length).toBe(1);
      expect(history.body[0].basic).toBe(50000);
    });

    it('allows saving and updating draft payslips with calculations', async () => {
      const res = await request(server())
        .post('/payroll/payslips/emp-4?month=2026-08')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          bonus: 5000,
          incentive: 2000,
          incomeTax: 4000,
          notes: 'Draft salary draft notes',
        })
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
      expect(res.body.basic).toBe(50000);
      expect(res.body.hra).toBe(20000);
      expect(res.body.otherAllowance).toBe(10000);
      expect(res.body.bonus).toBe(5000);
      expect(res.body.incentive).toBe(2000);
      expect(res.body.incomeTax).toBe(4000);
      expect(res.body.grossEarnings).toBe(87000); // 50000 + 20000 + 10000 + 5000 + 2000
    });

    it('allows submitting payslip for approval, rejecting it, editing it, and then approving it', async () => {
      // 1. Submit for approval
      const submitRes = await request(server())
        .post('/payroll/payslips/emp-4/submit-approval?month=2026-08')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(submitRes.body.status).toBe('PENDING_APPROVAL');

      const approval = await prisma.approvalRequest.findFirst({
        where: { organizationId: 'org-alderway', sourceModule: 'Payroll', sourceRecordId: submitRes.body.id, status: 'PENDING' },
      });
      expect(approval).toBeDefined();

      // Verify that duplicate submit-approval and draft updates are blocked while pending
      await request(server())
        .post('/payroll/payslips/emp-4/submit-approval?month=2026-08')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(400);

      await request(server())
        .post('/payroll/payslips/emp-4?month=2026-08')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ bonus: 1000 })
        .expect(400);

      // 2. Reject it via approvals module
      await request(server())
        .patch(`/approvals/${approval?.id}/decide`)
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ status: 'REJECTED', rejectionReason: 'Incorrect bonus calculations' })
        .expect(200);

      // Verify status is back to DRAFT and notes contain rejection message
      const rejectedPayslip = await prisma.payslip.findUnique({ where: { id: submitRes.body.id } });
      expect(rejectedPayslip?.status).toBe('DRAFT');
      expect(rejectedPayslip?.notes).toContain('Rejected: Incorrect bonus calculations');

      // 3. Edit draft
      const editRes = await request(server())
        .post('/payroll/payslips/emp-4?month=2026-08')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ bonus: 1000 })
        .expect(201);
      expect(editRes.body.bonus).toBe(1000);

      // 4. Re-submit for approval
      const submitRes2 = await request(server())
        .post('/payroll/payslips/emp-4/submit-approval?month=2026-08')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
      expect(submitRes2.body.status).toBe('PENDING_APPROVAL');

      const approval2 = await prisma.approvalRequest.findFirst({
        where: { organizationId: 'org-alderway', sourceModule: 'Payroll', sourceRecordId: submitRes.body.id, status: 'PENDING' },
      });
      expect(approval2).toBeDefined();

      // 5. Approve it via approvals module
      await request(server())
        .patch(`/approvals/${approval2?.id}/decide`)
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ status: 'APPROVED' })
        .expect(200);

      // Verify status is FINALIZED and snapshot values are populated
      const finalizedPayslip = await prisma.payslip.findUnique({ where: { id: submitRes.body.id } });
      expect(finalizedPayslip?.status).toBe('FINALIZED');
      expect(finalizedPayslip?.snapshot).toBeDefined();
      expect(finalizedPayslip?.snapshot?.basic).toBe(50000);
      expect(finalizedPayslip?.snapshot?.lopDeduction).toBeDefined();
      expect(finalizedPayslip?.snapshot?.netSalary).toBeCloseTo(
        finalizedPayslip!.snapshot!.grossEarnings - finalizedPayslip!.snapshot!.totalDeductions,
        2,
      );

      // Verify that draft updates are blocked after finalization
      await request(server())
        .post('/payroll/payslips/emp-4?month=2026-08')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ bonus: 1000 })
        .expect(400);
    });

    it('syncs to employee dashboard view (My Payslip)', async () => {
      const res = await request(server())
        .get('/payroll/payslips?month=2026-08&scope=me')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].status).toBe('FINALIZED');
      expect(res.body[0].employeeId).toBe('emp-4');
      expect(res.body[0].basic).toBe(50000);
      expect(res.body[0].netSalary).toBeDefined();
    });
  });
});
