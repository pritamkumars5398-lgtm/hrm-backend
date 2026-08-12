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

describe('Travel Desk Module (e2e)', () => {
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
    await prisma.travelRequest.deleteMany({});
    await prisma.approvalRequest.deleteMany({});
    await prisma.notification.deleteMany({});

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
        { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['travel.manage', 'approvals.manage'] },
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

  describe('Travel Request Lifecycle', () => {
    let travelId: string;
    let approvalId: string;

    it('allows employee to create a travel request', async () => {
      const res = await request(server())
        .post('/travel')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          destination: 'Munich, Germany',
          startDate: '2026-10-15',
          endDate: '2026-10-20',
          purpose: 'Attend React Conf Europe',
          estimatedCost: 1500,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('PENDING');
      expect(res.body.destination).toBe('Munich, Germany');

      travelId = res.body.id;
    });

    it('manager approves the request, changing status to APPROVED', async () => {
      const pendingRes = await request(server())
        .get('/approvals/pending')
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(pendingRes.body.length).toBe(1);
      approvalId = pendingRes.body[0].id;

      await request(server())
        .patch(`/approvals/${approvalId}/decide`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          status: 'APPROVED',
        })
        .expect(200);

      const travelRes = await request(server())
        .get('/travel')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(travelRes.body[0].status).toBe('APPROVED');
    });

    it('travel desk logs booking details, status becomes BOOKED', async () => {
      const res = await request(server())
        .patch(`/travel/${travelId}/booking`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          bookingDetails: 'Lufthansa LH-2430 | Munich Central Hotel Booking #882910',
        })
        .expect(200);

      expect(res.body.status).toBe('BOOKED');
      expect(res.body.bookingDetails).toBe('Lufthansa LH-2430 | Munich Central Hotel Booking #882910');
    });

    it('allows employee to cancel their request', async () => {
      const res = await request(server())
        .patch(`/travel/${travelId}/cancel`)
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          cancellationReason: 'Conference postponed due to schedule changes.',
        })
        .expect(200);

      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.cancellationReason).toBe('Conference postponed due to schedule changes.');
    });
  });
});
