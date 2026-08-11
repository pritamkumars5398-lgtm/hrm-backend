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

describe('Auth & ABAC Security (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let ownerCookie: string;
  let hrCookie: string;
  let managerCookie: string;
  let employeeCookie: string;
  let unauthorizedCookie: string;

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

    // Clean up test database first
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.membership.deleteMany({});
    await prisma.employee.deleteMany({});

    // Seed test users with pre-calculated password hash for 'demo1234'
    const passwordHash = '$2b$10$S/JdXTN6BjYEEZaW0FBE5OXgZZ/LGyayrkC6fTZN28BhqIXAXAriC';

    await prisma.user.createMany({
      data: [
        { id: 'usr-1', email: 'hr@demo.com', name: 'Marta Lindqvist', avatarInitials: 'ML', passwordHash },
        { id: 'usr-2', email: 'owner@demo.com', name: 'Priya Nair', avatarInitials: 'PN', passwordHash },
        { id: 'usr-3', email: 'manager@demo.com', name: 'Samuel Okafor', avatarInitials: 'SO', passwordHash },
        { id: 'usr-4', email: 'employee@demo.com', name: 'Amit Patel', avatarInitials: 'AP', passwordHash },
        { id: 'usr-5', email: 'unauthorized@demo.com', name: 'Unauthorized User', avatarInitials: 'UU', passwordHash },
      ],
    });

    // Seed test organization
    await prisma.organization.create({
      data: {
        id: 'org-alderway',
        name: 'Alderway Labs',
        address: '4 Wharf Road, London',
        industry: 'Software & Technology',
        ownerId: 'usr-2',
      },
    });

    // Seed memberships
    await prisma.membership.createMany({
      data: [
        { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['employees.*', 'attendance.*', 'leave.*', 'documents.*', 'reports.view', 'team.invite', 'team.view'] },
        { id: 'mem-2', userId: 'usr-2', organizationId: 'org-alderway', jobTitle: 'Founder & CEO', permissions: ['*'] },
        { id: 'mem-3', userId: 'usr-3', organizationId: 'org-alderway', jobTitle: 'Engineering Manager', permissions: ['attendance.view', 'leave.approve', 'performance.view', 'documents.view'] },
        { id: 'mem-4', userId: 'usr-4', organizationId: 'org-alderway', jobTitle: 'Software Engineer', permissions: ['attendance.view', 'leave.view', 'performance.view', 'documents.view'] },
      ],
    });

    // Seed employees
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
          contactNumber: '+46 8 123 4567',
          homeAddress: 'Vasagatan 16, Stockholm, Sweden',
          financialDetails: {
            accName: 'Marta Lindqvist',
            accNumber: '1234567890',
            bankName: 'Nordea',
            ifscCode: 'NRDE2211',
          },
        },
        {
          id: 'emp-2',
          userId: 'usr-2',
          organizationId: 'org-alderway',
          employeeId: 'EMP-2026-0002',
          firstName: 'Priya',
          lastName: 'Nair',
          jobTitle: 'Founder & CEO',
          department: 'Executive',
          startDate: new Date('2023-06-01T00:00:00.000Z'),
          employmentType: 'Full-time',
          workLocation: 'London Headquarters',
          contactNumber: '+44 20 7946 0958',
          homeAddress: '4 Wharf Road, London, UK',
          financialDetails: {
            accName: 'Priya Nair',
            accNumber: '9876543210',
            bankName: 'Barclays',
            ifscCode: 'BARC1234',
          },
        },
        {
          id: 'emp-3',
          userId: 'usr-3',
          organizationId: 'org-alderway',
          employeeId: 'EMP-2026-0003',
          managerId: 'emp-2',
          firstName: 'Samuel',
          lastName: 'Okafor',
          jobTitle: 'Engineering Manager',
          department: 'Engineering',
          startDate: new Date('2024-03-10T00:00:00.000Z'),
          employmentType: 'Full-time',
          workLocation: 'London Headquarters',
          contactNumber: '+44 20 7946 0112',
          homeAddress: '12 High Street, London, UK',
          financialDetails: {
            accName: 'Samuel Okafor',
            accNumber: '5544332211',
            bankName: 'HSBC',
            ifscCode: 'MIDL1234',
          },
        },
        {
          id: 'emp-4',
          userId: 'usr-4',
          organizationId: 'org-alderway',
          employeeId: 'EMP-2026-0004',
          managerId: 'emp-3',
          firstName: 'Amit',
          lastName: 'Patel',
          jobTitle: 'Software Engineer',
          department: 'Engineering',
          startDate: new Date('2025-01-10T00:00:00.000Z'),
          employmentType: 'Full-time',
          workLocation: 'London Headquarters',
          contactNumber: '+44 20 7946 0223',
          homeAddress: '45 Wembley Road, London, UK',
          financialDetails: {
            accName: 'Amit Patel',
            accNumber: '2233445566',
            bankName: 'HSBC',
            ifscCode: 'MIDL1234',
          },
        },
      ],
    });

    // Sign in users
    ownerCookie = await signIn('owner@demo.com');
    hrCookie = await signIn('hr@demo.com');
    managerCookie = await signIn('manager@demo.com');
    employeeCookie = await signIn('employee@demo.com');
    unauthorizedCookie = await signIn('unauthorized@demo.com');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('0.1 Authentication & Protected Routes', () => {
    it('rejects accessing /auth/me without cookie', async () => {
      await request(server()).get('/auth/me').expect(401);
    });

    it('rejects accessing /auth/me with invalid cookie', async () => {
      await request(server())
        .get('/auth/me')
        .set('Cookie', `${AUTH_COOKIE}=garbage-token`)
        .expect(401);
    });

    it('allows /auth/me for logged-in users', async () => {
      const res = await request(server())
        .get('/auth/me')
        .set('Cookie', employeeCookie)
        .expect(200);
      expect(res.body.email).toBe('employee@demo.com');
    });

    it('clears session on logout', async () => {
      const cookie = await signIn('employee@demo.com');
      const logoutRes = await request(server())
        .post('/auth/logout')
        .set('Cookie', cookie)
        .expect(200);

      const cleared = (logoutRes.headers['set-cookie'] as unknown as string[])[0];
      expect(cleared).toContain(`${AUTH_COOKIE}=;`);
    });
  });

  describe('0.2 User Identity & Profile Mapping', () => {
    it('returns own employee profile via /employees/me', async () => {
      const res = await request(server())
        .get('/employees/me')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.email).toBe('employee@demo.com');
      expect(res.body.firstName).toBe('Amit');
      expect(res.body.lastName).toBe('Patel');
      expect(res.body.department).toBe('Engineering');
      expect(res.body.designation).toBe('Software Engineer');
      expect(res.body.employeeId).toBe('EMP-2026-0004');
    });

    it('returns own employee profile for CEO/Owner (auto-created if missing)', async () => {
      // Temporarily delete Owner's Employee record to check auto-creation
      await prisma.employee.deleteMany({ where: { userId: 'usr-2', organizationId: 'org-alderway' } });

      const res = await request(server())
        .get('/employees/me')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.email).toBe('owner@demo.com');
      expect(res.body.firstName).toBe('Priya');
      expect(res.body.lastName).toBe('Nair');
      expect(res.body.designation).toBe('Founder & CEO');
      expect(res.body.employeeId).toContain('EMP-');
    });
  });

  describe('0.3 ABAC Policy Evaluation', () => {
    it('allows Admin (Owner) to list all employees', async () => {
      await request(server())
        .get('/employees')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
    });

    it('allows HR Manager to list all employees', async () => {
      await request(server())
        .get('/employees')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
    });

    it('denies Manager from listing all employees', async () => {
      await request(server())
        .get('/employees')
        .set('Cookie', managerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(403);
    });

    it('denies Employee from listing all employees', async () => {
      await request(server())
        .get('/employees')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(403);
    });

    it('denies Unauthorized user (no memberships) from calling /employees/me', async () => {
      await request(server())
        .get('/employees/me')
        .set('Cookie', unauthorizedCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(404); // Membership not found -> 404 in findByUserId
    });

    it('allows Employee to read their own profile, but denies reading others', async () => {
      // emp-4 is Amit Patel (Employee)
      // emp-3 is Samuel Okafor (Manager)
      
      // amit reads himself -> OK
      await request(server())
        .get('/employees/emp-4')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      // amit tries to read samuel -> Forbidden (403)
      await request(server())
        .get('/employees/emp-3')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(403);
    });

    it('blocks Inactive employee from workspace requests', async () => {
      // Deactivate Amit Patel (Employee, emp-4)
      await prisma.employee.update({
        where: { id: 'emp-4' },
        data: { deletedAt: new Date() }
      });

      // Amit tries to call /employees/me -> 403 Forbidden
      await request(server())
        .get('/employees/me')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(403);

      // Amit tries to list leave -> 403 Forbidden
      await request(server())
        .get('/leave')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(403);

      // Reactivate for subsequent runs/tests cleanliness
      await prisma.employee.update({
        where: { id: 'emp-4' },
        data: { deletedAt: null }
      });
    });
  });
});
