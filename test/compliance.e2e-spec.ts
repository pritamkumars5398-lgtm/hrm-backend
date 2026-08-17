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

describe('Compliance System (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ownerCookie: string;
  let managerCookie: string;
  let employeeCookie: string;
  const orgId = 'org-alderway';

  const server = () => app.getHttpServer();

  const signIn = async (email: string, password = 'demo1234') => {
    const res = await request(server()).post('/auth/login').send({ email, password }).expect(200);
    return authCookie(res);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // Clean up test database
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.membership.deleteMany({});
    await prisma.employee.deleteMany({});
    await prisma.complianceFramework.deleteMany({});
    await prisma.complianceRequirement.deleteMany({});
    await prisma.complianceObligation.deleteMany({});
    await prisma.complianceTask.deleteMany({});
    await prisma.complianceViolation.deleteMany({});
    await prisma.complianceException.deleteMany({});
    await prisma.complianceRisk.deleteMany({});
    await prisma.policyAcknowledgement.deleteMany({});
    await prisma.courseAssignment.deleteMany({});

    const passwordHash = '$2b$10$S/JdXTN6BjYEEZaW0FBE5OXgZZ/LGyayrkC6fTZN28BhqIXAXAriC';

    await prisma.user.createMany({
      data: [
        { id: 'usr-owner', email: 'owner@demo.com', name: 'Priya Nair', avatarInitials: 'PN', passwordHash },
        { id: 'usr-manager', email: 'manager@demo.com', name: 'Marta Lindqvist', avatarInitials: 'ML', passwordHash },
        { id: 'usr-employee', email: 'employee@demo.com', name: 'Amit Patel', avatarInitials: 'AP', passwordHash },
      ],
    });

    await prisma.organization.create({
      data: {
        id: orgId,
        name: 'Alderway Labs',
        address: '4 Wharf Road, London',
        industry: 'Software & Technology',
        ownerId: 'usr-owner',
      },
    });

    await prisma.membership.createMany({
      data: [
        { id: 'mem-owner', userId: 'usr-owner', organizationId: orgId, jobTitle: 'Founder & CEO', permissions: ['*'] },
        { id: 'mem-manager', userId: 'usr-manager', organizationId: orgId, jobTitle: 'HR Manager', permissions: ['compliance.*', 'approvals.*', 'team.*'] },
        { id: 'mem-employee', userId: 'usr-employee', organizationId: orgId, jobTitle: 'Software Engineer', permissions: ['attendance.view', 'leave.view', 'performance.view', 'documents.view', 'compliance.view'] },
      ],
    });

    await prisma.employee.createMany({
      data: [
        {
          id: 'emp-alderway-owner',
          userId: 'usr-owner',
          organizationId: orgId,
          employeeId: 'EMP-2026-0001',
          firstName: 'Priya',
          lastName: 'Nair',
          jobTitle: 'Founder & CEO',
          department: 'Executive Office',
          startDate: new Date('2024-01-15T00:00:00.000Z'),
          employmentType: 'Full-time',
          workLocation: 'London Headquarters',
        },
        {
          id: 'emp-alderway-manager',
          userId: 'usr-manager',
          organizationId: orgId,
          employeeId: 'EMP-2026-0002',
          firstName: 'Marta',
          lastName: 'Lindqvist',
          jobTitle: 'HR Manager',
          department: 'Human Resources',
          startDate: new Date('2024-01-15T00:00:00.000Z'),
          employmentType: 'Full-time',
          workLocation: 'Stockholm Office',
        },
        {
          id: 'emp-alderway-employee',
          userId: 'usr-employee',
          organizationId: orgId,
          employeeId: 'EMP-2026-0004',
          firstName: 'Amit',
          lastName: 'Patel',
          jobTitle: 'Software Engineer',
          department: 'Engineering',
          startDate: new Date('2025-01-10T00:00:00.000Z'),
          employmentType: 'Full-time',
          workLocation: 'London Headquarters',
        },
      ],
    });

    ownerCookie = await signIn('owner@demo.com');
    managerCookie = await signIn('manager@demo.com');
    employeeCookie = await signIn('employee@demo.com');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Statutory & Labour Compliance Module CRUD & Status Engine', () => {
    let frameworkId: string;
    let requirementId: string;
    let obligationId: string;
    let taskId: string;
    let violationId: string;
    let exceptionId: string;

    it('POST /compliance/frameworks -> creates a compliance framework', async () => {
      const res = await request(server())
        .post('/compliance/frameworks')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', orgId)
        .send({
          name: 'Indian Labour Laws 2026',
          code: 'IND-LAB-26',
          description: 'EPF, ESIC, and statutory factory act guidelines.',
          jurisdiction: 'India',
          version: '1.0.0',
          effectiveFrom: '2026-01-01',
        })
        .expect(201);

      expect(res.body.code).toBe('IND-LAB-26');
      frameworkId = res.body.id;
    });

    it('GET /compliance/frameworks -> lists all compliance frameworks', async () => {
      const res = await request(server())
        .get('/compliance/frameworks')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', orgId)
        .expect(200);

      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].code).toBe('IND-LAB-26');
    });

    it('POST /compliance/requirements -> creates a compliance requirement and triggers applicability scan', async () => {
      const res = await request(server())
        .post('/compliance/requirements')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', orgId)
        .send({
          frameworkId,
          code: 'EPF-SUB-01',
          name: 'EPF Monthly Returns Filing',
          description: 'Submit monthly EPF electronic challan return (ECR).',
          category: 'DOCUMENT',
          mandatory: true,
          frequency: 'MONTHLY',
          riskLevel: 'CRITICAL',
          evidenceRequired: true,
          verificationRequired: true,
        })
        .expect(201);

      expect(res.body.code).toBe('EPF-SUB-01');
      requirementId = res.body.id;
    });

    it('GET /compliance/requirements -> lists all requirements', async () => {
      const res = await request(server())
        .get('/compliance/requirements')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', orgId)
        .expect(200);

      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.find((r: any) => r.code === 'EPF-SUB-01')).toBeDefined();
    });

    it('GET /compliance/obligations -> lists active employee obligations generated by the scan', async () => {
      const res = await request(server())
        .get('/compliance/obligations')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', orgId)
        .expect(200);

      expect(res.body.length).toBeGreaterThan(0);
      const matched = res.body.find((o: any) => o.requirementId === requirementId);
      expect(matched).toBeDefined();
      obligationId = matched.id;
    });

    it('POST /compliance/tasks -> creates a compliance task for an obligation', async () => {
      const res = await request(server())
        .post('/compliance/tasks')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', orgId)
        .send({
          obligationId,
          assignedToId: 'emp-alderway-owner', // Alderway Owner employee record
          title: 'Prepare EPF spreadsheet',
          description: 'Format the ECR file and run checksum.',
          priority: 'HIGH',
          dueDate: '2026-09-01',
        })
        .expect(201);

      expect(res.body.title).toBe('Prepare EPF spreadsheet');
      taskId = res.body.id;
    });

    it('PATCH /compliance/tasks/:id -> updates compliance task status', async () => {
      const res = await request(server())
        .patch(`/compliance/tasks/${taskId}`)
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', orgId)
        .send({
          status: 'COMPLETED',
          evidenceUrl: 'https://cloudinary.com/evidence-epf.pdf',
        })
        .expect(200);

      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.evidenceUrl).toBe('https://cloudinary.com/evidence-epf.pdf');
    });

    it('POST /compliance/risks -> registers a new compliance risk', async () => {
      const res = await request(server())
        .post('/compliance/risks')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', orgId)
        .send({
          category: 'Statutory Penalty',
          likelihood: 4,
          impact: 4,
          mitigation: 'Implement live audit notifications.',
        })
        .expect(201);

      expect(res.body.riskScore).toBe(16);
      expect(res.body.severity).toBe('CRITICAL');
    });

    it('GET /compliance/risks -> lists registered risks', async () => {
      const res = await request(server())
        .get('/compliance/risks')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', orgId)
        .expect(200);

      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].category).toBe('Statutory Penalty');
    });

    it('GET /compliance/dashboard -> returns aggregate compliance metrics', async () => {
      const res = await request(server())
        .get('/compliance/dashboard')
        .set('Cookie', ownerCookie)
        .set('X-Workspace-Id', orgId)
        .expect(200);

      expect(res.body.healthScore).toBeDefined();
      expect(res.body.totalCount).toBeGreaterThan(0);
      expect(res.body.riskLevel).toBe('CRITICAL');
    });

    it('POST /compliance/policies/acknowledge -> acknowledges policy and updates matching policy requirement', async () => {
      const res = await request(server())
        .post('/compliance/policies/acknowledge')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', orgId)
        .send({
          policyId: 'POL-CODE-10',
          version: '1.0.0',
        })
        .expect(201);

      expect(res.body.policyId).toBe('POL-CODE-10');
    });

    it('GET /compliance/courses/my-courses -> lists assigned courses and status', async () => {
      const res = await request(server())
        .get('/compliance/courses/my-courses')
        .set('Cookie', employeeCookie)
        .set('X-Workspace-Id', orgId)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
