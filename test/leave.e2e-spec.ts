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

describe('Leave Module (e2e)', () => {
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
        leaveAnnualDays: 25,
        leaveSickDays: 10,
        leavePersonalDays: 5,
      },
    });

    await prisma.membership.createMany({
      data: [
        { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['employees.*', 'attendance.*', 'leave.*', 'documents.*', 'reports.view', 'team.invite', 'team.view'] },
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

  describe('Leave Request Lifecycle and Validations', () => {
    it('denies leave request when X-Workspace-Id header is missing', async () => {
      await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .send({
          type: 'ANNUAL',
          startDate: '2026-09-01',
          endDate: '2026-09-05',
          reason: 'Summer vacation',
        })
        .expect(400);
    });

    it('validates start and end dates', async () => {
      // End date before start date
      await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'ANNUAL',
          startDate: '2026-09-05',
          endDate: '2026-09-01',
          reason: 'Time travel',
        })
        .expect(400);
    });

    it('enforces leave balance limits', async () => {
      // Entitled to 5 PERSONAL days, try to apply for 10 days
      await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'PERSONAL',
          startDate: '2026-09-01',
          endDate: '2026-09-10', // 10 days
          reason: 'Extended personal time',
        })
        .expect(400);
    });

    it('allows applying for leave successfully', async () => {
      const res = await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'ANNUAL',
          startDate: '2026-09-01',
          endDate: '2026-09-02', // 2 days
          reason: 'Vacation',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('PENDING');
      expect(res.body.days).toBe(2);
      expect(res.body.type).toBe('ANNUAL');
    });

    it('prevents overlapping leave requests', async () => {
      // Try to apply overlapping the previous request (2026-09-01 to 2026-09-02)
      await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'SICK',
          startDate: '2026-09-02',
          endDate: '2026-09-03',
          reason: 'Dental appointment',
        })
        .expect(409);
    });

    it('forbids approving your own leave request', async () => {
      // HR Marta Lindqvist usr-1 applies for leave
      const hrLeave = await request(server())
        .post('/leave')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'SICK',
          startDate: '2026-10-01',
          endDate: '2026-10-01',
          reason: 'Flu',
        })
        .expect(201);

      // HR Marta tries to approve her own request
      await request(server())
        .post(`/leave/${hrLeave.body.id}/decide`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ decision: 'APPROVED' })
        .expect(403);
    });
  });

  describe('Leave Approval and Synchronization', () => {
    let leaveRequestId: string;
    const todayISO = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    beforeAll(async () => {
      // Amit Patel usr-4 applies for a 1-day SICK leave for today
      const today = todayISO();
      const res = await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'SICK',
          startDate: today,
          endDate: today,
          reason: 'Fever today',
        })
        .expect(201);
      
      leaveRequestId = res.body.id;
    });

    it('manager/HR approves the leave request and verifies sync across components', async () => {
      // 1. Get initial dashboard stats
      const initialDashboard = await request(server())
        .get('/dashboard')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
      const initialOnLeaveStat = initialDashboard.body.stats.find((s: any) => s.id === 'st-leave');
      const initialOnLeaveCount = initialOnLeaveStat ? Number(initialOnLeaveStat.value) : 0;

      // 2. Get initial reports data
      const initialReports = await request(server())
        .get('/reports')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
      const initialLeaveDaysTaken = initialReports.body.leaveDaysTaken;

      // 3. Approve leave request
      await request(server())
        .post(`/leave/${leaveRequestId}/decide`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ decision: 'APPROVED' })
        .expect(200);

      // 4. Verification of sync:
      // A) Leave Planner balance: used sick days should be 1
      const leaveData = await request(server())
        .get('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      const sickBalance = leaveData.body.balances.find((b: any) => b.type === 'SICK');
      expect(sickBalance?.used).toBe(1);

      // B) Employee Profile: /employees/emp-4/leave should show approved leave
      const employeeLeave = await request(server())
        .get('/employees/emp-4/leave')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      const approvedReq = employeeLeave.body.find((r: any) => r.id === leaveRequestId);
      expect(approvedReq).toBeDefined();
      expect(approvedReq.status).toBe('APPROVED');

      // C) Attendance: monthly view shows employee status as LEAVE today
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const attendance = await request(server())
        .get(`/attendance/month?year=${currentYear}&month=${currentMonth}`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      const todayRecord = attendance.body.today.find((r: any) => r.employeeId === 'emp-4');
      expect(todayRecord).toBeDefined();
      expect(todayRecord.status).toBe('LEAVE');

      // D) Dashboard: On leave count increases by 1
      const updatedDashboard = await request(server())
        .get('/dashboard')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
      const updatedOnLeaveStat = updatedDashboard.body.stats.find((s: any) => s.id === 'st-leave');
      const updatedOnLeaveCount = updatedOnLeaveStat ? Number(updatedOnLeaveStat.value) : 0;
      expect(updatedOnLeaveCount).toBe(initialOnLeaveCount + 1);

      // E) Reports: total leave days taken increases by 1
      const updatedReports = await request(server())
        .get('/reports')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
      expect(updatedReports.body.leaveDaysTaken).toBe(initialLeaveDaysTaken + 1);
    });
  });

  describe('Leave Hardening and Half-Day / Cancellation Integration', () => {
    it('calculates working days duration correctly by excluding weekends and holidays', async () => {
      // Setup a public holiday on 2026-09-07 (Monday)
      await prisma.organization.update({
        where: { id: 'org-alderway' },
        data: {
          attendanceHolidays: ['2026-09-07'],
        },
      });

      // Apply for leave from 2026-09-04 (Friday) to 2026-09-08 (Tuesday)
      // Calendar days: Friday, Saturday, Sunday, Monday, Tuesday (5 days)
      // Working days: Friday, Tuesday (2 days) because Sat/Sun are weekends, Monday is a holiday!
      const res = await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'ANNUAL',
          startDate: '2026-09-04',
          endDate: '2026-09-08',
          reason: 'Trip spanning holiday weekend',
        })
        .expect(201);

      expect(res.body.days).toBe(2);
    });

    it('allows concurrent half-day requests for different periods on the same day', async () => {
      // Request first half
      await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'PERSONAL',
          startDate: '2026-09-15',
          endDate: '2026-09-15',
          isHalfDay: true,
          halfDayPeriod: 'FIRST_HALF',
          reason: 'Dentist appointment',
        })
        .expect(201);

      // Request second half on same day - should succeed!
      await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'SICK',
          startDate: '2026-09-15',
          endDate: '2026-09-15',
          isHalfDay: true,
          halfDayPeriod: 'SECOND_HALF',
          reason: 'Doctor checkup',
        })
        .expect(201);

      // Request another first half on same day - should conflict (409)!
      await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'ANNUAL',
          startDate: '2026-09-15',
          endDate: '2026-09-15',
          isHalfDay: true,
          halfDayPeriod: 'FIRST_HALF',
          reason: 'Double book morning',
        })
        .expect(409);
    });

    it('supports self-service cancellation and restores balances dynamically', async () => {
      // Amit Patel usr-4 applies for a 1-day SICK leave
      const res = await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'PERSONAL',
          startDate: '2026-09-22',
          endDate: '2026-09-22',
          reason: 'Personal errand',
        })
        .expect(201);

      const leaveId = res.body.id;

      // Cancel it
      await request(server())
        .post(`/leave/${leaveId}/cancel`)
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      // Verify status is CANCELLED
      const check = await prisma.leaveRequest.findUnique({ where: { id: leaveId } });
      expect(check?.status).toBe('CANCELLED');
    });

    it('syncs direct leave decisions with approvals module', async () => {
      // 1. Employee Amit Patel (usr-4) requests leave
      const leaveRes = await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'ANNUAL',
          startDate: '2026-11-10',
          endDate: '2026-11-10',
          reason: 'Direct decide sync test',
        })
        .expect(201);
      
      const leaveId = leaveRes.body.id;

      // Verify that a PENDING ApprovalRequest is created in the approvals module
      const approvalPending = await prisma.approvalRequest.findFirst({
        where: { organizationId: 'org-alderway', sourceModule: 'Leave', sourceRecordId: leaveId },
      });
      expect(approvalPending).toBeDefined();
      expect(approvalPending?.status).toBe('PENDING');

      // 2. Manager Marta (hrCookie) decides (APPROVED) the request directly
      await request(server())
        .post(`/leave/${leaveId}/decide`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ decision: 'APPROVED' })
        .expect(200);

      // Verify that the ApprovalRequest status is updated to APPROVED automatically
      const approvalApproved = await prisma.approvalRequest.findFirst({
        where: { id: approvalPending?.id },
      });
      expect(approvalApproved?.status).toBe('APPROVED');
    });

    it('correctly calculates unpaid days in payroll excluding holidays and handling half-day leaves', async () => {
      // Set up holiday on 2026-07-06 (Monday), halfDayThreshold: 5
      await prisma.organization.update({
        where: { id: 'org-alderway' },
        data: {
          attendanceHolidays: ['2026-07-06'],
          attendanceHalfDayThreshold: 5.0,
        },
      });

      // Create an approved unpaid half-day leave for emp-4 on 2026-07-07 (Tuesday)
      const leaveRes1 = await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'UNPAID',
          startDate: '2026-07-07',
          endDate: '2026-07-07',
          isHalfDay: true,
          halfDayPeriod: 'FIRST_HALF',
          reason: 'Half-day unpaid leave',
        })
        .expect(201);

      await request(server())
        .post(`/leave/${leaveRes1.body.id}/decide`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ decision: 'APPROVED' })
        .expect(200);

      // Create an approved sick half-day leave for emp-4 on 2026-07-08 (Wednesday)
      const leaveRes2 = await request(server())
        .post('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          type: 'SICK',
          startDate: '2026-07-08',
          endDate: '2026-07-08',
          isHalfDay: true,
          halfDayPeriod: 'FIRST_HALF',
          reason: 'Half-day sick leave',
        })
        .expect(201);

      await request(server())
        .post(`/leave/${leaveRes2.body.id}/decide`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ decision: 'APPROVED' })
        .expect(200);

      // Query July 2026 payroll (draft payslip list)
      const payrollRes = await request(server())
        .get('/payroll/payslips?month=2026-07')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      const payslip = payrollRes.body.find((p: any) => p.employeeId === 'emp-4');
      expect(payslip).toBeDefined();
      // July 2026 has 23 weekdays.
      // - 2026-07-06 is a holiday -> skipped (0 unpaid).
      // - 2026-07-07 is unpaid half-day leave -> 0.5 (leave) + 0.5 (no check-in absent) = 1.0 unpaid.
      // - 2026-07-08 is sick half-day leave -> 0 (sick) + 0.5 (no check-in absent) = 0.5 unpaid.
      // - 20 other weekdays have no check-in and no leave -> 20.0 unpaid.
      // Total unpaidDays should be exactly 21.5.
      expect(payslip.unpaidDays).toBe(21.5);
    });
  });
});
