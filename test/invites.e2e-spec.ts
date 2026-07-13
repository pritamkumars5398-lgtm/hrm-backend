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

describe('Team Members / Invites (e2e)', () => {
  let app: INestApplication<App>;
  let ownerCookie: string;
  let hrCookie: string;
  let managerCookie: string;

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

    ownerCookie = await signIn('owner@demo.com');
    hrCookie = await signIn('hr@demo.com');
    managerCookie = await signIn('manager@demo.com');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('who may invite (§10)', () => {
    it('lets an Owner invite', async () => {
      const res = await request(server())
        .post('/invites')
        .set('Cookie', ownerCookie)
        .send({ email: `new+${Date.now()}@x.com`, role: 'MANAGER' })
        .expect(201);

      expect(res.body.inviteLink).toContain('/accept-invite?token=');
      // The token is a credential — it must not appear on the invite record.
      expect(res.body.invite.token).toBeUndefined();
    });

    it('lets HR invite', async () => {
      await request(server())
        .post('/invites')
        .set('Cookie', hrCookie)
        .send({ email: `hrinv+${Date.now()}@x.com`, role: 'MANAGER' })
        .expect(201);
    });

    it('forbids a Manager from inviting', async () => {
      await request(server())
        .post('/invites')
        .set('Cookie', managerCookie)
        .send({ email: `nope+${Date.now()}@x.com`, role: 'HR' })
        .expect(403);
    });

    it('forbids a Manager from listing invites', async () => {
      await request(server()).get('/invites').set('Cookie', managerCookie).expect(403);
    });

    it('rejects an invite while signed out', async () => {
      await request(server()).post('/invites').send({ email: 'x@x.com', role: 'HR' }).expect(401);
    });

    it('refuses to invite someone as OWNER', async () => {
      await request(server())
        .post('/invites')
        .set('Cookie', ownerCookie)
        .send({ email: `owner2+${Date.now()}@x.com`, role: 'OWNER' })
        .expect(400);
    });

    it('refuses a duplicate pending invite', async () => {
      const email = `dupe+${Date.now()}@x.com`;

      await request(server())
        .post('/invites')
        .set('Cookie', ownerCookie)
        .send({ email, role: 'HR' })
        .expect(201);

      await request(server())
        .post('/invites')
        .set('Cookie', ownerCookie)
        .send({ email, role: 'HR' })
        .expect(409);
    });

    it('refuses to invite someone who already has an account', async () => {
      await request(server())
        .post('/invites')
        .set('Cookie', ownerCookie)
        .send({ email: 'manager@demo.com', role: 'HR' })
        .expect(409);
    });
  });

  describe('accepting an invite', () => {
    it('joins the inviter’s org with the role set at invite time', async () => {
      const email = `joiner+${Date.now()}@x.com`;

      const created = await request(server())
        .post('/invites')
        .set('Cookie', ownerCookie)
        .send({ email, role: 'HR' })
        .expect(201);

      const token = new URL(created.body.inviteLink).searchParams.get('token')!;

      const preview = await request(server())
        .get('/invites/preview')
        .query({ token })
        .expect(200);

      expect(preview.body.email).toBe(email);
      expect(preview.body.role).toBe('HR');
      expect(preview.body.organizationName).toBe('Alderway Labs');

      const accepted = await request(server())
        .post('/invites/accept')
        .send({
          token,
          fullName: 'Jo Invitee',
          phone: '+44 7700 900123',
          jobTitle: 'Recruiter',
          password: 'hunter2xx',
        })
        .expect(200);

      // Role and org come from the invite, not from anything the invitee typed.
      expect(accepted.body.role).toBe('HR');
      expect(accepted.body.organizationId).toBe('org-alderway');
      expect(accepted.body.email).toBe(email);
      expect(accepted.body.passwordHash).toBeUndefined();
    });

    it('burns the token — the same link cannot be used twice', async () => {
      const email = `once+${Date.now()}@x.com`;

      const created = await request(server())
        .post('/invites')
        .set('Cookie', ownerCookie)
        .send({ email, role: 'MANAGER' })
        .expect(201);

      const token = new URL(created.body.inviteLink).searchParams.get('token')!;

      await request(server())
        .post('/invites/accept')
        .send({
          token,
          fullName: 'First Use',
          phone: '123456',
          jobTitle: 'Analyst',
          password: 'hunter2xx',
        })
        .expect(200);

      await request(server())
        .post('/invites/accept')
        .send({
          token,
          fullName: 'Replay Attack',
          phone: '123456',
          jobTitle: 'Analyst',
          password: 'hunter2xx',
        })
        .expect(400);
    });

    it('rejects a made-up token', async () => {
      await request(server())
        .get('/invites/preview')
        .query({ token: 'totally-made-up' })
        .expect(404);
    });

    it('rejects a revoked invite', async () => {
      const created = await request(server())
        .post('/invites')
        .set('Cookie', ownerCookie)
        .send({ email: `revoked+${Date.now()}@x.com`, role: 'HR' })
        .expect(201);

      const token = new URL(created.body.inviteLink).searchParams.get('token')!;

      await request(server())
        .post(`/invites/${created.body.invite.id}/revoke`)
        .set('Cookie', ownerCookie)
        .expect(200);

      await request(server()).get('/invites/preview').query({ token }).expect(400);
    });

    it('resend issues a new token and kills the old link', async () => {
      const created = await request(server())
        .post('/invites')
        .set('Cookie', ownerCookie)
        .send({ email: `resend+${Date.now()}@x.com`, role: 'HR' })
        .expect(201);

      const oldToken = new URL(created.body.inviteLink).searchParams.get('token')!;

      const resent = await request(server())
        .post(`/invites/${created.body.invite.id}/resend`)
        .set('Cookie', ownerCookie)
        .expect(200);

      const newToken = new URL(resent.body.inviteLink).searchParams.get('token')!;

      expect(newToken).not.toBe(oldToken);
      await request(server()).get('/invites/preview').query({ token: newToken }).expect(200);
      await request(server()).get('/invites/preview').query({ token: oldToken }).expect(404);
    });
  });

  describe('members', () => {
    it('lists only members of the caller’s own company', async () => {
      const res = await request(server()).get('/members').set('Cookie', ownerCookie).expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(3);
      expect(
        res.body.every((m: { organizationId: string }) => m.organizationId === 'org-alderway'),
      ).toBe(true);
      expect(res.body.every((m: { passwordHash?: string }) => m.passwordHash === undefined)).toBe(
        true,
      );
    });

    it('forbids a Manager from removing a member', async () => {
      await request(server())
        .delete('/members/usr-2')
        .set('Cookie', managerCookie)
        .expect(403);
    });

    // usr-1 is the owner AND the caller, so the self-removal check fires first.
    // The separate `role === 'OWNER'` guard is defence-in-depth for the day an
    // org can have more than one admin.
    it('forbids removing yourself', async () => {
      await request(server()).delete('/members/usr-1').set('Cookie', ownerCookie).expect(400);
    });

    it('404s removing a user from another company', async () => {
      await request(server())
        .delete('/members/usr-does-not-exist')
        .set('Cookie', ownerCookie)
        .expect(404);
    });
  });
});
