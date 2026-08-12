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

describe('Timesheets Module (e2e)', () => {
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
    await prisma.timesheet.deleteMany({});

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
        { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['employees.*', 'timesheets.manage'] },
        { id: 'mem-2', userId: 'usr-2', organizationId: 'org-alderway', jobTitle: 'Founder & CEO', permissions: ['*'] },
        { id: 'mem-4', userId: 'usr-4', organizationId: 'org-alderway', jobTitle: 'Software Engineer', permissions: ['attendance.view', 'leave.view'] },
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

  describe('Timesheet Logging and Approval Workflow', () => {
    let timesheetId: string;

    it('allows an employee to log and save a weekly timesheet draft', async () => {
      const res = await request(server())
        .post('/timesheets')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          weekStartDate: '2026-08-03',
          rows: [
            { client: 'Acme Corp', project: 'Enterprise Portal', task: 'Frontend Coding', hours: [8, 8, 8, 8, 8, 0, 0], isBillable: true },
            { client: 'Internal', project: 'HRMS SaaS Integration', task: 'Database sync', hours: [0, 0, 1, 0, 0, 0, 0], isBillable: false },
          ],
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.totalHours).toBe(41);
      expect(res.body.rows.length).toBe(2);

      timesheetId = res.body.id;
    });

    it('allows an employee to fetch their logged timesheet', async () => {
      const res = await request(server())
        .get('/timesheets')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .query({ weekStartDate: '2026-08-03' })
        .expect(200);

      expect(res.body.id).toBe(timesheetId);
      expect(res.body.totalHours).toBe(41);
      expect(res.body.status).toBe('DRAFT');
    });

    it('allows an employee to submit their timesheet for approval', async () => {
      const res = await request(server())
        .patch(`/timesheets/${timesheetId}/status`)
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ status: 'SUBMITTED' })
        .expect(200);

      expect(res.body.status).toBe('SUBMITTED');
    });

    it('restricts employees from approving their own timesheet', async () => {
      await request(server())
        .patch(`/timesheets/${timesheetId}/status`)
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ status: 'APPROVED' })
        .expect(403);
    });

    it('allows managers to list all organization timesheets', async () => {
      const res = await request(server())
        .get('/timesheets/all')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].employeeName).toBe('Amit Patel');
      expect(res.body[0].totalHours).toBe(41);
    });

    it('allows managers to approve timesheets', async () => {
      const res = await request(server())
        .patch(`/timesheets/${timesheetId}/status`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ status: 'APPROVED' })
        .expect(200);

      expect(res.body.status).toBe('APPROVED');
    });
  });
});
