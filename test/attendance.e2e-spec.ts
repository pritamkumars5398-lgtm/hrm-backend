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

describe('Attendance Module (e2e)', () => {
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

  describe('Attendance Self-Service (Check-in / Check-out / History)', () => {
    const todayISO = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    it('denies check-in when X-Workspace-Id header is missing', async () => {
      await request(server())
        .post('/attendance/check-in')
        .set('Cookie', employeeCookie)
        .expect(400);
    });

    it('allows an employee to check-in successfully', async () => {
      // 1. Get initial dashboard stats
      const initialDashboard = await request(server())
        .get('/dashboard')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
      
      const initialPresentStat = initialDashboard.body.stats.find((s: any) => s.id === 'st-present');
      const initialPresentCount = initialPresentStat ? Number(initialPresentStat.value) : 0;

      // 2. Perform check-in
      await request(server())
        .post('/attendance/check-in')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      // 3. Simultaneously verify:
      // A) My Today Status shows checkedIn: true
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth(); // 0-indexed

      const attendanceMonth = await request(server())
        .get(`/attendance/month?year=${currentYear}&month=${currentMonth}`)
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(attendanceMonth.body.myTodayStatus?.checkedIn).toBe(true);
      expect(attendanceMonth.body.myTodayStatus?.checkedOut).toBe(false);
      expect(attendanceMonth.body.myTodayStatus?.checkInTime).not.toBeNull();

      // B) Dashboard "Present today" count increases
      const updatedDashboard = await request(server())
        .get('/dashboard')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      const updatedPresentStat = updatedDashboard.body.stats.find((s: any) => s.id === 'st-present');
      const updatedPresentCount = updatedPresentStat ? Number(updatedPresentStat.value) : 0;
      expect(updatedPresentCount).toBe(initialPresentCount + 1);

      // C) Employee Profile shows today's attendance record
      const employeeProfileAttendance = await request(server())
        .get('/employees/emp-4/attendance')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      const todayRecord = employeeProfileAttendance.body.find((r: any) => r.date === todayISO());
      expect(todayRecord).toBeDefined();
      expect(todayRecord.checkIn).not.toBeNull();
      expect(todayRecord.checkOut).toBeNull();
    });

    it('prevents duplicate check-in today', async () => {
      await request(server())
        .post('/attendance/check-in')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(409);
    });

    it('allows check-out successfully and updates myTodayStatus and Employee Profile', async () => {
      // 1. Perform check-out
      await request(server())
        .post('/attendance/check-out')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      // 2. Simultaneously verify:
      // A) My Today Status shows checkedOut: true
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();

      const attendanceMonth = await request(server())
        .get(`/attendance/month?year=${currentYear}&month=${currentMonth}`)
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(attendanceMonth.body.myTodayStatus?.checkedIn).toBe(true);
      expect(attendanceMonth.body.myTodayStatus?.checkedOut).toBe(true);
      expect(attendanceMonth.body.myTodayStatus?.checkOutTime).not.toBeNull();

      // B) Employee Profile shows checkedOut time
      const employeeProfileAttendance = await request(server())
        .get('/employees/emp-4/attendance')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      const todayRecord = employeeProfileAttendance.body.find((r: any) => r.date === todayISO());
      expect(todayRecord).toBeDefined();
      expect(todayRecord.checkOut).not.toBeNull();
    });

    it('prevents duplicate check-out today', async () => {
      await request(server())
        .post('/attendance/check-out')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(400);
    });
  });

  describe('Attendance Sync with Reports', () => {
    it('updates average attendance rate in reports when a past record is added', async () => {
      // 1. Get initial reports data
      const initialReports = await request(server())
        .get('/reports')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      const initialAvgAttendance = initialReports.body.avgAttendance;

      // 2. Seed a check-in for yesterday directly in database (past day)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      // Ensure yesterday is a weekday, otherwise backdate further
      while (yesterday.getDay() === 0 || yesterday.getDay() === 6) {
        yesterday.setDate(yesterday.getDate() - 1);
      }

      const pad = (n: number) => String(n).padStart(2, '0');
      const yesterdayISO = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;

      const checkInTime = new Date(yesterday);
      checkInTime.setHours(9, 0, 0, 0);

      const checkOutTime = new Date(yesterday);
      checkOutTime.setHours(18, 0, 0, 0);

      await prisma.attendanceRecord.create({
        data: {
          id: `att-test-yest`,
          organizationId: 'org-alderway',
          employeeId: 'emp-4',
          date: yesterdayISO,
          checkIn: checkInTime,
          checkOut: checkOutTime,
        },
      });

      // 3. Fetch reports again and verify avgAttendance is updated (greater than initial if it was 0%)
      const updatedReports = await request(server())
        .get('/reports')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(updatedReports.body.avgAttendance).toBeGreaterThan(initialAvgAttendance);
    });
  });

  describe('Attendance Correction Workflow (Centralized Approvals)', () => {
    it('allows employee to submit correction request', async () => {
      await request(server())
        .post('/attendance/correction')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          date: '2026-08-05',
          checkIn: '09:00',
          checkOut: '17:00',
          reason: 'Forgot to punch in and out',
        })
        .expect(200);

      // Verify that a pending ApprovalRequest was created
      const pending = await request(server())
        .get('/approvals/pending')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      const correctionReq = pending.body.find(
        (a: any) => a.sourceModule === 'Attendance' && a.requesterId === 'emp-4',
      );
      expect(correctionReq).toBeDefined();
      expect(correctionReq.status).toBe('PENDING');

      // Decide on approval (approve it)
      await request(server())
        .patch(`/approvals/${correctionReq.id}/decide`)
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ status: 'APPROVED' })
        .expect(200);

      // Verify that AttendanceRecord is created/updated in the database
      const record = await prisma.attendanceRecord.findFirst({
        where: { organizationId: 'org-alderway', employeeId: 'emp-4', date: '2026-08-05' },
      });
      expect(record).toBeDefined();
      expect(record?.checkIn).not.toBeNull();
      expect(record?.checkOut).not.toBeNull();
    });
  });
});
