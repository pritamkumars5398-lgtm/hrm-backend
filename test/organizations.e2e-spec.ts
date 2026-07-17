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
 * Company deletion (§ "delete a company you want, but never down to zero").
 * Every test that creates a company for these specs must be a fresh, throwaway
 * one — never `org-alderway`, which every other e2e spec (and the seed data)
 * depends on staying alive for the whole test run.
 */
describe('Organizations / Delete Company (e2e)', () => {
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

  it('rejects a confirmName that does not match the company name', async () => {
    const orgId = await createCompany(ownerCookie, `Wrong Name Co ${Date.now()}`);

    await request(server())
      .delete(`/organizations/${orgId}`)
      .set('Cookie', ownerCookie)
      .send({ confirmName: 'Definitely Not The Name' })
      .expect(400);

    // Still there — a rejected attempt must not partially delete anything.
    await request(server())
      .get('/organizations/me')
      .set('Cookie', ownerCookie)
      .set('X-Workspace-Id', orgId)
      .expect(200);
  });

  it('forbids anyone who is not the company\'s Owner, even a real member of it', async () => {
    // manager@demo.com is a real member of org-alderway, just not its owner.
    await request(server())
      .delete('/organizations/org-alderway')
      .set('Cookie', managerCookie)
      .send({ confirmName: 'Alderway Labs' })
      .expect(403);

    // org-alderway must survive this and every other test in the suite.
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

    // Still there — the block must be a no-op, not a partial delete.
    await request(server())
      .get('/organizations/me')
      .set('Cookie', soloCookie)
      .set('X-Workspace-Id', orgId)
      .expect(200);
  });

  it('deletes the company and every row scoped to it, without touching a second, unrelated company', async () => {
    const nameA = `Delete Me Co ${Date.now()}`;
    const nameB = `Untouched Co ${Date.now()}`;
    const orgA = await createCompany(ownerCookie, nameA);
    const orgB = await createCompany(ownerCookie, nameB);

    // Give orgA a real Employee HR record and a pending invite, so the test
    // actually exercises the cascade rather than deleting an empty shell.
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
      .post('/invites')
      .set('Cookie', ownerCookie)
      .set('X-Workspace-Id', orgA)
      .send({ email: `deleteme-pending+${Date.now()}@x.com`, permissions: ['attendance.view'], source: 'team-members' })
      .expect(201);

    // Give orgB its own employee, as the control group — this must survive.
    const untouchedEmail = `untouched-emp+${Date.now()}@x.com`;
    await request(server())
      .post('/invites')
      .set('Cookie', ownerCookie)
      .set('X-Workspace-Id', orgB)
      .send({
        email: untouchedEmail,
        permissions: ['attendance.view'],
        source: 'employee-management',
        firstName: 'Untouched',
        lastName: 'Person',
        jobTitle: 'QA',
        employeeId: `EMP-UNT-${Date.now()}`,
      })
      .expect(201);

    // Delete orgA.
    await request(server())
      .delete(`/organizations/${orgA}`)
      .set('Cookie', ownerCookie)
      .send({ confirmName: nameA })
      .expect(200);

    // orgA is entirely gone — the caller no longer belongs to it at all.
    await request(server())
      .get('/organizations/me')
      .set('Cookie', ownerCookie)
      .set('X-Workspace-Id', orgA)
      .expect(403);
    await request(server())
      .get('/employees')
      .set('Cookie', ownerCookie)
      .set('X-Workspace-Id', orgA)
      .expect(403);

    // orgB is completely unaffected — its employee is still there.
    const orgBEmployees = await request(server())
      .get('/employees')
      .set('Cookie', ownerCookie)
      .set('X-Workspace-Id', orgB)
      .expect(200);
    expect(orgBEmployees.body.some((e: { email: string }) => e.email === untouchedEmail)).toBe(true);

    // org-alderway, seeded and shared by every other spec, is also unaffected.
    await request(server())
      .get('/organizations/me')
      .set('Cookie', ownerCookie)
      .set('X-Workspace-Id', 'org-alderway')
      .expect(200);
  });
});
