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

describe('Expense Claims Module (e2e)', () => {
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
    await prisma.expenseClaim.deleteMany({});
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
        { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['expenses.manage', 'approvals.manage'] },
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

  describe('Expense Claims Workflow', () => {
    let expenseId: string;
    let approvalId: string;

    it('rejects claim with zero or negative amount', async () => {
      await request(server())
        .post('/expenses')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          title: 'Invalid Expense',
          category: 'Food',
          amount: -50,
          claimDate: '2026-08-11',
        })
        .expect(400);
    });

    it('allows an employee to log a valid expense claim with receipt', async () => {
      const res = await request(server())
        .post('/expenses')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          title: 'Client Lunch at Savoy',
          category: 'Food',
          amount: 120.5,
          receiptUrl: 'https://storage.googleapis.com/receipt-savoy.pdf',
          claimDate: '2026-08-11',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('PENDING');
      expect(res.body.amount).toBe(120.5);

      expenseId = res.body.id;
    });

    it('prevents submission of duplicate expense claim', async () => {
      await request(server())
        .post('/expenses')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .send({
          title: 'Client Lunch at Savoy',
          category: 'Food',
          amount: 120.5,
          claimDate: '2026-08-11',
        })
        .expect(409);
    });

    it('fetches logged claims list', async () => {
      const res = await request(server())
        .get('/expenses')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(expenseId);
      expect(res.body[0].employeeName).toBe('Amit Patel');
    });

    it('manager approves claim via approvals, transitioning status to APPROVED and setting approvedAmount', async () => {
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

      const expenseRes = await request(server())
        .get('/expenses')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(expenseRes.body[0].status).toBe('APPROVED');
      expect(expenseRes.body[0].approvedAmount).toBe(120.5);
      expect(expenseRes.body[0].reimbursedAmount).toBeNull();
    });

    it('allows HR/Finance to reimburse approved claim, setting status to REIMBURSED', async () => {
      const reimburseRes = await request(server())
        .patch(`/expenses/${expenseId}/reimburse`)
        .set('Cookie', hrCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      expect(reimburseRes.body.status).toBe('REIMBURSED');
      expect(reimburseRes.body.reimbursedAmount).toBe(120.5);

      // Verify invariant: Claimed Amount (120.5) >= Approved Amount (120.5) >= Reimbursed Amount (120.5)
      expect(reimburseRes.body.amount).toBeGreaterThanOrEqual(reimburseRes.body.approvedAmount);
      expect(reimburseRes.body.approvedAmount).toBeGreaterThanOrEqual(reimburseRes.body.reimbursedAmount);
    });

    it('triggers a notification to employee upon reimbursement', async () => {
      const notifyRes = await request(server())
        .get('/notifications')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', 'org-alderway')
        .expect(200);

      const reimburseNotification = notifyRes.body.notifications.find(
        (n: any) => n.kind === 'employee' && n.title.includes('Reimbursed'),
      );
      expect(reimburseNotification).toBeDefined();
    });
  });
});
