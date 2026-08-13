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

describe('Helpdesk Tickets Module (e2e)', () => {
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
    await prisma.helpdeskTicket.deleteMany({});

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
        { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['helpdesk.manage'] },
        { id: 'mem-4', userId: 'usr-4', organizationId: 'org-alderway', jobTitle: 'Software Engineer', permissions: ['leave.view'] },
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

    hrCookie = await signIn('hr@demo.com');
    employeeCookie = await signIn('employee@demo.com');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Helpdesk Ticket Lifecycle', () => {
    let ticketId: string;

    it('allows employee to create a ticket with formatted ticketNo', async () => {
      const res = await request(server())
        .post('/helpdesk')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          subject: 'Broken Office Chair',
          description: 'The height adjustment lever is completely broken.',
          category: 'Admin',
          priority: 'MEDIUM',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.ticketNo).toMatch(/^HD-2026-\d{4}$/);
      expect(res.body.status).toBe('OPEN');
      expect(res.body.subject).toBe('Broken Office Chair');

      ticketId = res.body.id;
    });

    it('allows HR to assign ticket and mark in progress', async () => {
      const res = await request(server())
        .patch(`/helpdesk/${ticketId}/status`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          status: 'IN_PROGRESS',
          assignedToId: 'emp-1',
        })
        .expect(200);

      expect(res.body.status).toBe('IN_PROGRESS');
      expect(res.body.assignedToId).toBe('emp-1');
    });

    it('allows adding comments/replies to the ticket', async () => {
      const res = await request(server())
        .post(`/helpdesk/${ticketId}/comment`)
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          comment: 'Can I get a replacement chair soon?',
        })
        .expect(201);

      expect(res.body.length).toBe(1);
      expect(res.body[0].author).toBe('Amit Patel');
      expect(res.body[0].comment).toBe('Can I get a replacement chair soon?');
    });

    it('allows resolving the ticket with resolution details', async () => {
      const res = await request(server())
        .patch(`/helpdesk/${ticketId}/status`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          status: 'RESOLVED',
          resolution: 'Replaced with a spare ergonomic chair from stock.',
        })
        .expect(200);

      expect(res.body.status).toBe('RESOLVED');
      expect(res.body.resolution).toBe('Replaced with a spare ergonomic chair from stock.');
    });

    it('allows closing the ticket and enforces transition rules on closed tickets', async () => {
      // Close ticket
      await request(server())
        .patch(`/helpdesk/${ticketId}/status`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ status: 'CLOSED' })
        .expect(200);

      // Reopening directly to RESOLVED should fail
      await request(server())
        .patch(`/helpdesk/${ticketId}/status`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ status: 'RESOLVED' })
        .expect(400);

      // Reopening to IN_PROGRESS should succeed
      const res = await request(server())
        .patch(`/helpdesk/${ticketId}/status`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      expect(res.body.status).toBe('IN_PROGRESS');
    });
  });
});
