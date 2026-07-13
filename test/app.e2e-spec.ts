import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AUTH_COOKIE } from './../src/common/jwt-payload';

/** Pulls the auth cookie out of a Set-Cookie header so we can replay it. */
function authCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return (raw ?? []).find((c) => c.startsWith(`${AUTH_COOKIE}=`)) ?? '';
}

describe('Auth + Organizations (e2e)', () => {
  let app: INestApplication<App>;

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
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  describe('protected routes', () => {
    it('rejects /auth/me with no cookie', async () => {
      await request(server()).get('/auth/me').expect(401);
    });

    it('rejects /auth/me with a garbage token', async () => {
      await request(server())
        .get('/auth/me')
        .set('Cookie', `${AUTH_COOKIE}=not-a-real-jwt`)
        .expect(401);
    });
  });

  describe('login', () => {
    it('signs in a seeded demo account and sets an httpOnly cookie', async () => {
      const res = await request(server())
        .post('/auth/login')
        .send({ email: 'owner@demo.com', password: 'demo1234' })
        .expect(200);

      expect(res.body.email).toBe('owner@demo.com');
      expect(res.body.role).toBe('OWNER');
      expect(res.body.organizationId).toBe('org-alderway');

      // The password hash must never reach the client.
      expect(res.body.passwordHash).toBeUndefined();
      expect(authCookie(res)).toContain('HttpOnly');
    });

    it('rejects a wrong password with the same message as an unknown email', async () => {
      const wrongPassword = await request(server())
        .post('/auth/login')
        .send({ email: 'owner@demo.com', password: 'wrong-password' })
        .expect(401);

      const unknownEmail = await request(server())
        .post('/auth/login')
        .send({ email: 'nobody@nowhere.com', password: 'demo1234' })
        .expect(401);

      // Identical responses — anything else is an account-enumeration leak.
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });

    it('reaches a protected route with the cookie from login', async () => {
      const login = await request(server())
        .post('/auth/login')
        .send({ email: 'hr@demo.com', password: 'demo1234' })
        .expect(200);

      const me = await request(server())
        .get('/auth/me')
        .set('Cookie', authCookie(login))
        .expect(200);

      expect(me.body.email).toBe('hr@demo.com');
      expect(me.body.role).toBe('HR');
    });
  });

  describe('logout', () => {
    it('clears the cookie', async () => {
      const login = await request(server())
        .post('/auth/login')
        .send({ email: 'owner@demo.com', password: 'demo1234' })
        .expect(200);

      const res = await request(server())
        .post('/auth/logout')
        .set('Cookie', authCookie(login))
        .expect(200);

      const cleared = (res.headers['set-cookie'] as unknown as string[])[0];
      expect(cleared).toContain(`${AUTH_COOKIE}=;`);
    });
  });

  describe('signup then create company', () => {
    it('signs up with no company, then creates one and becomes its Owner', async () => {
      const email = `ada+${Date.now()}@newco.com`;

      const signup = await request(server())
        .post('/auth/signup')
        .send({ fullName: 'Ada Lovelace', email, password: 'hunter2xx' })
        .expect(201);

      // Signing up creates a person, not yet a company (§11.2).
      expect(signup.body.organizationId).toBeNull();
      expect(signup.body.role).toBe('OWNER');

      const created = await request(server())
        .post('/organizations')
        .set('Cookie', authCookie(signup))
        .send({
          name: 'Newco Ltd',
          address: '1 Analytical Way, London',
          industry: 'Software & Technology',
          jobTitle: 'Founder',
        })
        .expect(201);

      expect(created.body.organization.ownerId).toBe(signup.body.id);
      expect(created.body.user.organizationId).toBe(created.body.organization.id);

      // The JWT must be re-issued, or it still claims organizationId: null.
      const refreshed = authCookie(created);
      expect(refreshed).not.toBe('');

      const me = await request(server()).get('/auth/me').set('Cookie', refreshed).expect(200);
      expect(me.body.organizationId).toBe(created.body.organization.id);

      const mine = await request(server())
        .get('/organizations/me')
        .set('Cookie', refreshed)
        .expect(200);
      expect(mine.body.name).toBe('Newco Ltd');
    });

    it('refuses a second company for someone who already has one', async () => {
      const login = await request(server())
        .post('/auth/login')
        .send({ email: 'owner@demo.com', password: 'demo1234' })
        .expect(200);

      await request(server())
        .post('/organizations')
        .set('Cookie', authCookie(login))
        .send({ name: 'Second Co', address: 'Somewhere', industry: 'Healthcare' })
        .expect(409);
    });

    it('rejects a duplicate signup email', async () => {
      await request(server())
        .post('/auth/signup')
        .send({ fullName: 'Impostor', email: 'owner@demo.com', password: 'hunter2xx' })
        .expect(409);
    });

    it('rejects creating a company while signed out', async () => {
      await request(server())
        .post('/organizations')
        .send({ name: 'Ghost Co', address: 'Nowhere', industry: 'Healthcare' })
        .expect(401);
    });

    it('rejects an invalid industry', async () => {
      const signup = await request(server())
        .post('/auth/signup')
        .send({ fullName: 'Test User', email: `t+${Date.now()}@x.com`, password: 'hunter2xx' })
        .expect(201);

      await request(server())
        .post('/organizations')
        .set('Cookie', authCookie(signup))
        .send({ name: 'Bad Co', address: 'Somewhere', industry: 'Underwater Basket Weaving' })
        .expect(400);
    });
  });
});
