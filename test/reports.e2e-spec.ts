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

describe('Reports & Analytics Module (e2e)', () => {
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
    await prisma.attendanceRecord.deleteMany({});
    await prisma.leaveRequest.deleteMany({});
    await prisma.payslip.deleteMany({});
    await prisma.expenseClaim.deleteMany({});
    await prisma.travelRequest.deleteMany({});
    await prisma.helpdeskTicket.deleteMany({});
    await prisma.asset.deleteMany({});

    const passwordHash = '$2b$10$S/JdXTN6BjYEEZaW0FBE5OXgZZ/LGyayrkC6fTZN28BhqIXAXAriC';

    await prisma.user.createMany({
      data: [
        { id: 'usr-1', email: 'hr@demo.com', name: 'Marta Lindqvist', avatarInitials: 'ML', passwordHash },
        { id: 'usr-4', email: 'employee@demo.com', name: 'Amit Patel', avatarInitials: 'AP', passwordHash },
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
        { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['reports.view', 'payroll.view'] },
        { id: 'mem-4', userId: 'usr-4', organizationId: 'org-alderway', jobTitle: 'Software Engineer', permissions: ['reports.view'] },
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

    // Create cross-module records
    await prisma.expenseClaim.create({
      data: {
        id: 'exp-1',
        organizationId: 'org-alderway',
        employeeId: 'emp-4',
        title: 'Client Visit Cab',
        category: 'Travel',
        amount: 250,
        approvedAmount: 250,
        status: 'APPROVED',
        claimDate: '2026-08-01',
      },
    });

    await prisma.travelRequest.create({
      data: {
        id: 'trv-1',
        organizationId: 'org-alderway',
        employeeId: 'emp-4',
        purpose: 'Tech conference',
        destination: 'Berlin',
        startDate: '2026-09-10',
        endDate: '2026-09-14',
        estimatedCost: 1200,
        status: 'APPROVED',
      },
    });

    await prisma.helpdeskTicket.create({
      data: {
        id: 'tkt-1',
        organizationId: 'org-alderway',
        employeeId: 'emp-4',
        subject: 'Laptop screen flicker',
        description: 'Screen flickers when on battery',
        category: 'IT',
        priority: 'HIGH',
        status: 'OPEN',
      },
    });

    await prisma.asset.create({
      data: {
        id: 'ast-1',
        organizationId: 'org-alderway',
        assetTag: 'AST-2026-0001',
        name: 'MacBook Pro 16"',
        category: 'LAPTOP',
        serialNumber: 'MBP-99281',
        status: 'ASSIGNED',
        assignedToId: 'emp-4',
      },
    });

    hrCookie = await signIn('hr@demo.com');
    employeeCookie = await signIn('employee@demo.com');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /reports', () => {
    it('returns aggregated summary data with payrollCost for HR', async () => {
      const res = await request(server())
        .get('/reports')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.headcount).toBe(2);
      expect(res.body.activeCount).toBe(2);
      expect(res.body.expenseTotal).toBe(250);
      expect(res.body.travelCount).toBe(1);
      expect(res.body.openTicketsCount).toBe(1);
      expect(res.body.totalAssetsCount).toBe(1);
      expect(res.body.departments).toBeDefined();
      expect(Array.isArray(res.body.departments)).toBe(true);
    });

    it('masks payrollCost as null when user lacks payroll permission', async () => {
      const res = await request(server())
        .get('/reports')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.headcount).toBe(2);
      expect(res.body.payrollCost).toBeNull();
    });
  });

  describe('GET /reports/export', () => {
    it('returns CSV download stream and logs audit event', async () => {
      const res = await request(server())
        .get('/reports/export')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Summary');
      expect(res.text).toContain('Headcount (active),2');
      expect(res.text).toContain('Expense total (approved/reimbursed),250');
      expect(res.text).toContain('Open helpdesk tickets,1');
    });
  });
});
