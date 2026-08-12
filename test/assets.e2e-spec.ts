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

describe('Assets Module (e2e)', () => {
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
    await prisma.asset.deleteMany({});

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
        { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['employees.*', 'assets.manage'] },
        { id: 'mem-2', userId: 'usr-2', organizationId: 'org-alderway', jobTitle: 'Founder & CEO', permissions: ['*'] },
        { id: 'mem-4', userId: 'usr-4', organizationId: 'org-alderway', jobTitle: 'Software Engineer', permissions: ['attendance.view', 'leave.view'] },
      ],
    });

    await prisma.employee.createMany({
      data: [
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

  describe('Asset Lifecycle Workflow', () => {
    let assetId: string;

    it('allows HR to create a new asset in inventory', async () => {
      const res = await request(server())
        .post('/assets')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          name: 'MacBook Pro M3 Max 16"',
          category: 'Laptop',
          serialNumber: 'SN-MBP-2026',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('MacBook Pro M3 Max 16"');
      expect(res.body.status).toBe('AVAILABLE');

      assetId = res.body.id;
    });

    it('allows HR to list assets', async () => {
      const res = await request(server())
        .get('/assets')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('MacBook Pro M3 Max 16"');
      expect(res.body[0].assignedTo).toBe('Unassigned');
    });

    it('allows HR to assign an asset to an employee', async () => {
      const res = await request(server())
        .patch(`/assets/${assetId}/status`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          status: 'ASSIGNED',
          assignedToId: 'emp-4',
        })
        .expect(200);

      expect(res.body.status).toBe('ASSIGNED');
      expect(res.body.assignedToId).toBe('emp-4');
    });

    it('lists asset with assigned employee name resolved', async () => {
      const res = await request(server())
        .get('/assets')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body[0].assignedTo).toBe('Amit Patel');
    });

    it('allows HR to return an asset to available inventory', async () => {
      const res = await request(server())
        .patch(`/assets/${assetId}/status`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          status: 'AVAILABLE',
        })
        .expect(200);

      expect(res.body.status).toBe('AVAILABLE');
      expect(res.body.assignedToId).toBeNull();
    });

    it('allows HR to delete an asset', async () => {
      await request(server())
        .delete(`/assets/${assetId}`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      // Verify asset is deleted
      const res = await request(server())
        .get('/assets')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(0);
    });
  });
});
