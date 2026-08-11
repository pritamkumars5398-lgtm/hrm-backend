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

describe('Employees Module (e2e)', () => {
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

  describe('Directory Status Queries', () => {
    it('returns only active employees by default', async () => {
      const res = await request(server())
        .get('/employees')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(2);
      expect(res.body.find((e: any) => e.id === 'emp-4')).toBeDefined();
    });

    it('returns empty inactive list initially', async () => {
      const res = await request(server())
        .get('/employees?status=INACTIVE')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(0);
    });
  });

  describe('Employee Creation & Seeding Details', () => {
    it('creates an employee via POST /invites and creates a CREATE audit log', async () => {
      const res = await request(server())
        .post('/invites')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          email: 'newhire@demo.com',
          permissions: ['leave.view'],
          source: 'employee-management',
          firstName: 'John',
          lastName: 'Doe',
          jobTitle: 'Developer',
          department: 'Engineering',
          startDate: '2026-08-01',
          employmentType: 'Full-time',
          workLocation: 'Remote',
          employeeId: 'EMP-999',
        })
        .expect(201);

      expect(res.body.invite.email).toBe('newhire@demo.com');

      // Verify the employee was created
      const emp = await prisma.employee.findFirst({ where: { employeeId: 'EMP-999' } });
      expect(emp).toBeDefined();
      expect(emp?.firstName).toBe('John');

      // Verify Audit Log
      const log = await prisma.auditLog.findFirst({
        where: { action: 'CREATE', resource: 'Employee', resourceId: emp?.id },
      });
      expect(log).toBeDefined();
      expect(log?.userId).toBe('usr-1'); // HR user ID
    });
  });

  describe('Sub-Resource Routes', () => {
    beforeAll(async () => {
      // Seed sub-resource tables for emp-4
      await prisma.appraisalCycle.create({
        data: { id: 'cycle-1', organizationId: 'org-alderway', name: 'Q3 2026', status: 'OPEN', startDate: '2026-07-01', endDate: '2026-09-30' },
      });
      await prisma.goal.create({
        data: { id: 'goal-1', organizationId: 'org-alderway', employeeId: 'emp-4', cycleId: 'cycle-1', title: 'Complete Tasks', progress: 50, dueOn: '2026-09-30' },
      });
      await prisma.review.create({
        data: { id: 'rev-1', organizationId: 'org-alderway', employeeId: 'emp-4', cycleId: 'cycle-1', rating: 4, summary: 'Good job', reviewerUserId: 'usr-1' },
      });
      await prisma.attendanceRecord.create({
        data: { id: 'att-1', organizationId: 'org-alderway', employeeId: 'emp-4', date: '2026-08-01', checkIn: new Date(), checkOut: new Date() },
      });
      await prisma.leaveRequest.create({
        data: { id: 'lv-1', organizationId: 'org-alderway', employeeId: 'emp-4', type: 'CASUAL', startDate: '2026-08-10', endDate: '2026-08-11', reason: 'Vacation', status: 'APPROVED', days: 2 },
      });
      await prisma.payslip.create({
        data: { id: 'ps-1', organizationId: 'org-alderway', employeeId: 'emp-4', month: '2026-07', status: 'FINALIZED' },
      });
      await prisma.document.create({
        data: { id: 'doc-1', organizationId: 'org-alderway', employeeId: 'emp-4', name: 'ID.pdf', description: 'ID Proof', category: 'Compliance', fileType: 'PDF', sizeKb: 200, cloudinaryPublicId: 'x', cloudinaryResourceType: 'raw', cloudinaryUrl: 'http://cloudinary/id.pdf', uploadedByUserId: 'usr-1' },
      });
    });

    it('returns attendance logs', async () => {
      const res = await request(server())
        .get('/employees/emp-4/attendance')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].date).toBe('2026-08-01');
    });

    it('returns leave logs', async () => {
      const res = await request(server())
        .get('/employees/emp-4/leave')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].type).toBe('CASUAL');
    });

    it('returns payroll logs', async () => {
      const res = await request(server())
        .get('/employees/emp-4/payroll')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].month).toBe('2026-07');
    });

    it('returns performance goals and reviews', async () => {
      const res = await request(server())
        .get('/employees/emp-4/performance')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.goals.length).toBe(1);
      expect(res.body.reviews.length).toBe(1);
      expect(res.body.goals[0].title).toBe('Complete Tasks');
      expect(res.body.reviews[0].summary).toBe('Good job');
    });

    it('returns documents', async () => {
      const res = await request(server())
        .get('/employees/emp-4/documents')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('ID.pdf');
    });

    it('returns timeline and audit history', async () => {
      const res = await request(server())
        .get('/employees/emp-4/history')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.employmentHistory.length).toBe(1);
      expect(res.body.employmentHistory[0].title).toBe('Joined the company');
    });
  });

  describe('Employee Modification & Deactivation', () => {
    it('updates employee details and logs an UPDATE audit trail', async () => {
      const res = await request(server())
        .patch('/employees/emp-4')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          firstName: 'Amrit',
          jobTitle: 'Senior Software Engineer',
        })
        .expect(200);

      expect(res.body.firstName).toBe('Amrit');
      expect(res.body.designation).toBe('Senior Software Engineer');

      // Verify Audit Log
      const log = await prisma.auditLog.findFirst({
        where: { action: 'UPDATE', resource: 'Employee', resourceId: 'emp-4' },
        orderBy: { timestamp: 'desc' },
      });
      expect(log).not.toBeNull();
      expect(JSON.parse(log?.details || '{}').updatedFields).toContain('firstName');
    });

    it('soft deletes (deactivates) employee and logs a DELETE audit trail', async () => {
      // Deactivate Amrit Patel (Employee, emp-4)
      await request(server())
        .delete('/employees/emp-4')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      // Verify employee status is now INACTIVE in DB
      const emp = await prisma.employee.findUnique({ where: { id: 'emp-4' } });
      expect(emp?.deletedAt).not.toBeNull();

      // Verify that they no longer show in active list
      const activeList = await request(server())
        .get('/employees')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
      expect(activeList.body.find((e: any) => e.id === 'emp-4')).toBeUndefined();

      // Verify they show in INACTIVE list
      const inactiveList = await request(server())
        .get('/employees?status=INACTIVE')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
      expect(inactiveList.body.find((e: any) => e.id === 'emp-4')).toBeDefined();

      // Verify child resources are STILL intact (deactivation safety)
      const attendances = await prisma.attendanceRecord.findMany({ where: { employeeId: 'emp-4' } });
      expect(attendances.length).toBe(1);

      // Verify Audit Log
      const log = await prisma.auditLog.findFirst({
        where: { action: 'DELETE', resource: 'Employee', resourceId: 'emp-4' },
      });
      expect(log).toBeDefined();
    });
  });
});
