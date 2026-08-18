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

describe('Audit Logs Pagination (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let ownerCookie: string;
  let tenantBCookie: string;

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

    // Clean up
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.membership.deleteMany({});
    await prisma.auditLog.deleteMany({});

    const passwordHash = '$2b$10$S/JdXTN6BjYEEZaW0FBE5OXgZZ/LGyayrkC6fTZN28BhqIXAXAriC';

    // Create seed users
    await prisma.user.createMany({
      data: [
        { id: 'usr-2', email: 'owner@demo.com', name: 'Priya Nair', avatarInitials: 'PN', passwordHash },
        { id: 'usr-tenant-b', email: 'ownerb@demo.com', name: 'Tenant B Owner', avatarInitials: 'TB', passwordHash },
      ],
    });

    // Create organizations
    await prisma.organization.createMany({
      data: [
        { id: 'org-alderway', name: 'Alderway Labs', address: '4 Wharf Road, London', industry: 'Software & Technology', ownerId: 'usr-2' },
        { id: 'org-tenant-b', name: 'Tenant B Labs', address: '99 Analytical Way', industry: 'Healthcare', ownerId: 'usr-tenant-b' },
      ],
    });

    // Create memberships
    await prisma.membership.createMany({
      data: [
        { id: 'mem-2', userId: 'usr-2', organizationId: 'org-alderway', jobTitle: 'Founder & CEO', permissions: ['*'] },
        { id: 'mem-tenant-b', userId: 'usr-tenant-b', organizationId: 'org-tenant-b', jobTitle: 'Owner B', permissions: ['*'] },
      ],
    });

    // Seed 10 audit logs for Org A with unique timestamps
    const logsA = [];
    for (let i = 1; i <= 10; i++) {
      const date = new Date('2026-08-18T10:00:00.000Z');
      date.setSeconds(date.getSeconds() - i); // Ensure deterministic, distinct timestamps
      logsA.push({
        id: `log-a-${i}`,
        organizationId: 'org-alderway',
        userId: 'usr-2',
        userEmail: 'owner@demo.com',
        action: i % 2 === 0 ? 'CREATE' : 'UPDATE',
        resource: i <= 5 ? 'Employee' : 'Leave',
        resourceId: `emp-${i}`,
        result: 'ALLOW',
        timestamp: date,
      });
    }
    await prisma.auditLog.createMany({ data: logsA });

    // Seed 5 audit logs for Org B
    const logsB = [];
    for (let i = 1; i <= 5; i++) {
      const date = new Date('2026-08-18T10:00:00.000Z');
      date.setSeconds(date.getSeconds() - i);
      logsB.push({
        id: `log-b-${i}`,
        organizationId: 'org-tenant-b',
        userId: 'usr-tenant-b',
        userEmail: 'ownerb@demo.com',
        action: 'CREATE',
        resource: 'Employee',
        resourceId: `emp-b-${i}`,
        result: 'ALLOW',
        timestamp: date,
      });
    }
    await prisma.auditLog.createMany({ data: logsB });

    ownerCookie = await signIn('owner@demo.com');
    tenantBCookie = await signIn('ownerb@demo.com');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Audit Log Pagination Scenarios', () => {
    it('returns logs with pagination metadata for page 1', async () => {
      const res = await request(server())
        .get('/audit-logs')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .query({ limit: 3, resource: 'Employee' })
        .expect(200);

      expect(res.body.data.length).toBe(3);
      expect(res.body.pagination.limit).toBe(3);
      expect(res.body.pagination.hasNextPage).toBe(true);
      expect(typeof res.body.pagination.nextCursor).toBe('string');
      // Verify descending order by timestamp
      expect(res.body.data[0].id).toBe('log-a-1');
      expect(res.body.data[2].id).toBe('log-a-3');
    });

    it('traverses to page 2 using the nextCursor and ends with hasNextPage=false', async () => {
      // Get page 1 first
      const page1 = await request(server())
        .get('/audit-logs')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .query({ limit: 3, resource: 'Employee' })
        .expect(200);

      const cursor = page1.body.pagination.nextCursor;

      // Fetch page 2
      const page2 = await request(server())
        .get('/audit-logs')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .query({ limit: 3, cursor, resource: 'Employee' })
        .expect(200);

      expect(page2.body.data.length).toBe(2); // Remaining 2 logs (log-a-4 and log-a-5)
      expect(page2.body.data[0].id).toBe('log-a-4');
      expect(page2.body.data[1].id).toBe('log-a-5');
      expect(page2.body.pagination.hasNextPage).toBe(false);
      expect(page2.body.pagination.nextCursor).toBeNull();
    });

    it('rejects an invalid limit parameter', async () => {
      await request(server())
        .get('/audit-logs')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .query({ limit: -1 })
        .expect(400);

      await request(server())
        .get('/audit-logs')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .query({ limit: 'abc' })
        .expect(400);
    });

    it('enforces maximum limit cap', async () => {
      const res = await request(server())
        .get('/audit-logs')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .query({ limit: 999 })
        .expect(200);

      // Max limit is capped at 500
      expect(res.body.pagination.limit).toBe(500);
    });

    it('rejects a malformed cursor', async () => {
      await request(server())
        .get('/audit-logs')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .query({ limit: 5, cursor: 'invalid_base64_string_here' })
        .expect(400);
    });

    it('enforces tenant isolation and prevents cross-tenant cursor misuse', async () => {
      // Get cursor for Org A
      const page1A = await request(server())
        .get('/audit-logs')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .query({ limit: 3 })
        .expect(200);

      const cursorA = page1A.body.pagination.nextCursor;

      // Attempt to use Org A's cursor under Org B context (Tenant B Owner)
      await request(server())
        .get('/audit-logs')
        .set('Cookie', tenantBCookie)
        .set('X-Workspace-Id', 'org-tenant-b')
        .query({ limit: 3, cursor: cursorA })
        .expect(400); // Mismatched organizationId context inside cursor triggers a controlled error
    });

    it('preserves existing filters', async () => {
      const res = await request(server())
        .get('/audit-logs')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .query({ limit: 10, resource: 'Leave' })
        .expect(200);

      // Exactly 5 of the seeded logs have resource 'Leave'
      expect(res.body.data.length).toBe(5);
      res.body.data.forEach((log: any) => {
        expect(log.resource).toBe('Leave');
      });
    });

    it('redacts sensitive details from audit log metadata', async () => {
      const testLogId = 'log-redacted-test';
      const { writeAuditLog } = require('../src/common/audit-log');
      await writeAuditLog(prisma, {
        organizationId: 'org-alderway',
        userId: 'usr-2',
        action: 'TEST_REDACT',
        resource: 'Security',
        resourceId: testLogId,
        result: 'ALLOW',
        details: {
          someField: 'normalValue',
          password: 'mySecretPassword123',
          api_key: 'superSecretApiKey123',
          nested: {
            token: 'jwtTokenValueHere',
          },
        },
      });

      const log = await prisma.auditLog.findFirst({
        where: { resourceId: testLogId },
      });
      expect(log).toBeDefined();
      const details = JSON.parse(log!.details!);
      expect(details.someField).toBe('normalValue');
      expect(details.password).toBe('[REDACTED]');
      expect(details.api_key).toBe('[REDACTED]');
      expect(details.nested.token).toBe('[REDACTED]');
    });
  });
});
