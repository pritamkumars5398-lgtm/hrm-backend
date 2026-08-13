import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AUTH_COOKIE } from './../src/common/jwt-payload';

function authCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return (raw ?? []).find((c) => c.startsWith(`${AUTH_COOKIE}=`)) ?? '';
}

/**
 * Company deletion & settings management.
 */
describe('Organizations / Settings Management (e2e)', () => {
  let app: INestApplication<App>;
  let ownerCookie: string;
  let managerCookie: string;

  const server = () => app.getHttpServer();

  const signIn = async (email: string, password = 'demo1234') => {
    const res = await request(server()).post('/auth/login').send({ email, password }).expect(200);
    return authCookie(res);
  };

  /** Creates a fresh throwaway company owned by the given cookie's user. */
  const createCompany = async (cookie: string, name: string) => {
    const res = await request(server())
      .post('/organizations')
      .set('Cookie', cookie)
      .send({ name, address: '1 Test Street', industry: 'Software & Technology' })
      .expect(201);
    return res.body.organization.id as string;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    ownerCookie = await signIn('owner@demo.com');
    managerCookie = await signIn('manager@demo.com');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PATCH /organizations/me (Company Profile & Attendance Rules)', () => {
    it('updates company details and attendance rules successfully for Owner', async () => {
      const res = await request(server())
        .patch('/organizations/me')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          name: 'Alderway Labs Global',
          address: '5 Wharf Road, London',
          leaveNotificationEmail: 'hr-alerts@alderway.com',
          attendanceLateThreshold: '09:45',
          attendanceHalfDayThreshold: 4.5,
          attendanceWorkingHours: 8.5,
          attendanceHolidays: ['2026-12-25', '2026-12-26'],
        })
        .expect(200);

      expect(res.body.name).toBe('Alderway Labs Global');
      expect(res.body.attendanceLateThreshold).toBe('09:45');
      expect(res.body.attendanceWorkingHours).toBe(8.5);
      expect(res.body.attendanceHolidays).toEqual(['2026-12-25', '2026-12-26']);
    });

    it('rejects invalid working hours range (> 24)', async () => {
      const res = await request(server())
        .patch('/organizations/me')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ attendanceWorkingHours: 25 })
        .expect(400);

      expect(res.body.message).toMatch(/Working hours must be between 1 and 24/i);
    });

    it('rejects invalid half-day threshold exceeding working hours', async () => {
      const res = await request(server())
        .patch('/organizations/me')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ attendanceWorkingHours: 8, attendanceHalfDayThreshold: 10 })
        .expect(400);

      expect(res.body.message).toMatch(/Half-day threshold must be greater than 0 and less than total working hours/i);
    });

    it('rejects invalid late threshold format', async () => {
      const res = await request(server())
        .patch('/organizations/me')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ attendanceLateThreshold: '25:99' })
        .expect(400);

      expect(res.body.message).toMatch(/valid HH:MM time string/i);
    });
  });

  describe('DELETE /organizations/:id', () => {
    it('rejects a confirmName that does not match the company name', async () => {
      const orgId = await createCompany(ownerCookie, `Wrong Name Co ${Date.now()}`);

      await request(server())
        .delete(`/organizations/${orgId}`)
        .set('Cookie', ownerCookie)
        .send({ confirmName: 'Definitely Not The Name' })
        .expect(400);

      await request(server())
        .get('/organizations/me')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', orgId)
        .expect(200);
    });

    it('forbids anyone who is not the company\'s Owner', async () => {
      await request(server())
        .delete('/organizations/org-alderway')
        .set('Cookie', managerCookie)
        .send({ confirmName: 'Alderway Labs' })
        .expect(403);

      await request(server())
        .get('/organizations/me')
        .set('Cookie', managerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);
    });

    it('blocks deleting your only company', async () => {
      const email = `soloowner+${Date.now()}@x.com`;

      const signup = await request(server())
        .post('/auth/signup')
        .send({ email, password: 'testpass123', fullName: 'Solo Owner' })
        .expect(201);
      const soloCookie = authCookie(signup);

      const companyName = `Solo Co ${Date.now()}`;
      const orgId = await createCompany(soloCookie, companyName);

      const res = await request(server())
        .delete(`/organizations/${orgId}`)
        .set('Cookie', soloCookie)
        .send({ confirmName: companyName })
        .expect(400);

      expect(res.body.message).toMatch(/at least one company/i);

      await request(server())
        .get('/organizations/me')
        .set('Cookie', soloCookie)
        .set('X-Workspace-Id', orgId)
        .expect(200);
    });

    it('deletes the company and every row scoped to it', async () => {
      const nameA = `Delete Me Co ${Date.now()}`;
      const orgA = await createCompany(ownerCookie, nameA);

      const employeeEmail = `deleteme-emp+${Date.now()}@x.com`;
      await request(server())
        .post('/invites')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', orgA)
        .send({
          email: employeeEmail,
          permissions: ['attendance.view'],
          source: 'employee-management',
          firstName: 'Delete',
          lastName: 'Me',
          jobTitle: 'QA',
          employeeId: `EMP-DEL-${Date.now()}`,
        })
        .expect(201);

      await request(server())
        .delete(`/organizations/${orgA}`)
        .set('Cookie', ownerCookie)
        .send({ confirmName: nameA })
        .expect(200);

      await request(server())
        .get('/organizations/me')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', orgA)
        .expect(400);
    });
  });
});
