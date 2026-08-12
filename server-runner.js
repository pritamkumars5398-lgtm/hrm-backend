import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

async function main() {
  console.log('Starting Embedded MongoDB ReplicaSet...');
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: 60000 }],
  });
  const uri = replSet.getUri() + 'keystone';
  process.env.MONGO_URI = uri;
  process.env.DATABASE_URL = uri;
  process.env.EMBEDDED_MONGO_RUNNING = 'true';

  console.log(`ReplicaSet ready at ${uri}`);

  const prisma = new PrismaClient({
    datasources: { db: { url: uri } },
  });

  try {
    const passwordHash = await bcrypt.hash('demo1234', 10);
    
    // Users
    await prisma.user.upsert({
      where: { id: 'usr-1' },
      update: { passwordHash },
      create: { id: 'usr-1', email: 'hr@demo.com', name: 'Marta Lindqvist', avatarInitials: 'ML', passwordHash },
    });
    await prisma.user.upsert({
      where: { id: 'usr-2' },
      update: { passwordHash },
      create: { id: 'usr-2', email: 'owner@demo.com', name: 'Priya Nair', avatarInitials: 'PN', passwordHash },
    });
    await prisma.user.upsert({
      where: { id: 'usr-3' },
      update: { passwordHash },
      create: { id: 'usr-3', email: 'manager@demo.com', name: 'Samuel Okafor', avatarInitials: 'SO', passwordHash },
    });
    await prisma.user.upsert({
      where: { id: 'usr-4' },
      update: { passwordHash },
      create: { id: 'usr-4', email: 'employee@demo.com', name: 'Amit Patel', avatarInitials: 'AP', passwordHash },
    });
    await prisma.user.upsert({
      where: { id: 'usr-5' },
      update: { passwordHash },
      create: { id: 'usr-5', email: 'unauthorized@demo.com', name: 'Unauthorized User', avatarInitials: 'UU', passwordHash },
    });

    // Organization
    await prisma.organization.upsert({
      where: { id: 'org-alderway' },
      update: {},
      create: { id: 'org-alderway', name: 'Alderway Labs', address: '4 Wharf Road, London', industry: 'Software & Technology', ownerId: 'usr-2' },
    });

    // Memberships
    await prisma.membership.upsert({
      where: { id: 'mem-1' },
      update: { permissions: ['employees.*', 'attendance.*', 'leave.*', 'documents.*', 'reports.view', 'team.invite', 'team.view'] },
      create: { id: 'mem-1', userId: 'usr-1', organizationId: 'org-alderway', jobTitle: 'HR Manager', permissions: ['employees.*', 'attendance.*', 'leave.*', 'documents.*', 'reports.view', 'team.invite', 'team.view'] },
    });
    await prisma.membership.upsert({
      where: { id: 'mem-2' },
      update: { permissions: ['*'] },
      create: { id: 'mem-2', userId: 'usr-2', organizationId: 'org-alderway', jobTitle: 'Founder & CEO', permissions: ['*'] },
    });
    await prisma.membership.upsert({
      where: { id: 'mem-3' },
      update: { permissions: ['attendance.view', 'leave.approve', 'performance.view', 'documents.view'] },
      create: { id: 'mem-3', userId: 'usr-3', organizationId: 'org-alderway', jobTitle: 'Engineering Manager', permissions: ['attendance.view', 'leave.approve', 'performance.view', 'documents.view'] },
    });
    await prisma.membership.upsert({
      where: { id: 'mem-4' },
      update: { permissions: ['attendance.view', 'leave.view', 'performance.view', 'documents.view'] },
      create: { id: 'mem-4', userId: 'usr-4', organizationId: 'org-alderway', jobTitle: 'Software Engineer', permissions: ['attendance.view', 'leave.view', 'performance.view', 'documents.view'] },
    });

    // Employees
    await prisma.employee.upsert({
      where: { id: 'emp-1' },
      update: {},
      create: {
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
        contactNumber: '+46 8 123 4567',
        homeAddress: 'Vasagatan 16, Stockholm, Sweden',
        financialDetails: {
          accName: 'Marta Lindqvist',
          accNumber: '1234567890',
          bankName: 'Nordea',
          ifscCode: 'NRDE2211',
        },
      },
    });

    await prisma.employee.upsert({
      where: { id: 'emp-2' },
      update: {},
      create: {
        id: 'emp-2',
        userId: 'usr-2',
        organizationId: 'org-alderway',
        employeeId: 'EMP-2026-0002',
        firstName: 'Priya',
        lastName: 'Nair',
        jobTitle: 'Founder & CEO',
        department: 'Executive',
        startDate: new Date('2023-06-01T00:00:00.000Z'),
        employmentType: 'Full-time',
        workLocation: 'London Headquarters',
        contactNumber: '+44 20 7946 0958',
        homeAddress: '4 Wharf Road, London, UK',
        financialDetails: {
          accName: 'Priya Nair',
          accNumber: '9876543210',
          bankName: 'Barclays',
          ifscCode: 'BARC1234',
        },
      },
    });

    await prisma.employee.upsert({
      where: { id: 'emp-3' },
      update: { managerId: 'emp-2' },
      create: {
        id: 'emp-3',
        userId: 'usr-3',
        organizationId: 'org-alderway',
        employeeId: 'EMP-2026-0003',
        managerId: 'emp-2',
        firstName: 'Samuel',
        lastName: 'Okafor',
        jobTitle: 'Engineering Manager',
        department: 'Engineering',
        startDate: new Date('2024-03-10T00:00:00.000Z'),
        employmentType: 'Full-time',
        workLocation: 'London Headquarters',
        contactNumber: '+44 20 7946 0112',
        homeAddress: '12 High Street, London, UK',
        financialDetails: {
          accName: 'Samuel Okafor',
          accNumber: '5544332211',
          bankName: 'HSBC',
          ifscCode: 'MIDL1234',
        },
      },
    });

    await prisma.employee.upsert({
      where: { id: 'emp-4' },
      update: { managerId: 'emp-3' },
      create: {
        id: 'emp-4',
        userId: 'usr-4',
        organizationId: 'org-alderway',
        employeeId: 'EMP-2026-0004',
        managerId: 'emp-3',
        firstName: 'Amit',
        lastName: 'Patel',
        jobTitle: 'Software Engineer',
        department: 'Engineering',
        startDate: new Date('2025-01-10T00:00:00.000Z'),
        employmentType: 'Full-time',
        workLocation: 'London Headquarters',
        contactNumber: '+44 20 7946 0223',
        homeAddress: '45 Wembley Road, London, UK',
        financialDetails: {
          accName: 'Amit Patel',
          accNumber: '2233445566',
          bankName: 'HSBC',
          ifscCode: 'MIDL1234',
        },
      },
    });

    // Seed sub-resource records for employees (emp-4 is Amit Patel)
    await prisma.appraisalCycle.upsert({
      where: { id: 'cycle-1' },
      update: {},
      create: {
        id: 'cycle-1',
        organizationId: 'org-alderway',
        name: 'Q3 2026 Appraisal Cycle',
        status: 'OPEN',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        createdAt: new Date(),
      },
    });

    await prisma.goal.upsert({
      where: { id: 'goal-1' },
      update: {},
      create: {
        id: 'goal-1',
        organizationId: 'org-alderway',
        employeeId: 'emp-4',
        cycleId: 'cycle-1',
        title: 'Integrate the Employees sub-module',
        progress: 85,
        dueOn: '2026-09-15',
        createdAt: new Date(),
      },
    });

    await prisma.review.upsert({
      where: { id: 'rev-1' },
      update: {},
      create: {
        id: 'rev-1',
        organizationId: 'org-alderway',
        employeeId: 'emp-4',
        cycleId: 'cycle-1',
        rating: 5,
        summary: 'Outstanding performance on front-end component modernization and backend authorization audits.',
        reviewerUserId: 'usr-1',
        createdAt: new Date(),
      },
    });

    await prisma.salaryStructure.upsert({
      where: { id: 'sal-4' },
      update: {},
      create: {
        id: 'sal-4',
        organizationId: 'org-alderway',
        employeeId: 'emp-4',
        basic: 65000,
        hra: 25000,
        otherAllowance: 10000,
        effectiveFrom: '2026-01-01',
        createdByUserId: 'usr-2',
        createdAt: new Date(),
      },
    });

    await prisma.payslip.upsert({
      where: { id: 'ps-4-07' },
      update: {},
      create: {
        id: 'ps-4-07',
        organizationId: 'org-alderway',
        employeeId: 'emp-4',
        month: '2026-07',
        status: 'FINALIZED',
        bonus: 5000,
        incentive: 2000,
        reimbursement: 1200,
        incomeTax: 4500,
        notes: 'Includes Q2 tech performance bonus.',
        snapshot: {
          basic: 65000,
          hra: 25000,
          otherAllowance: 10000,
          daysInMonth: 31,
          unpaidDays: 0,
          lopDeduction: 0,
          grossEarnings: 108200,
          totalDeductions: 4500,
          netSalary: 103700,
        },
        createdAt: new Date(),
        finalizedAt: new Date(),
        finalizedByUserId: 'usr-1',
      },
    });

    await prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: 'emp-4', date: '2026-08-03' } },
      update: {},
      create: {
        id: 'att-4-1',
        organizationId: 'org-alderway',
        employeeId: 'emp-4',
        date: '2026-08-03',
        checkIn: new Date('2026-08-03T09:02:00.000Z'),
        checkOut: new Date('2026-08-03T18:05:00.000Z'),
        createdAt: new Date(),
      },
    });

    await prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: 'emp-4', date: '2026-08-04' } },
      update: {},
      create: {
        id: 'att-4-2',
        organizationId: 'org-alderway',
        employeeId: 'emp-4',
        date: '2026-08-04',
        checkIn: new Date('2026-08-04T08:58:00.000Z'),
        checkOut: new Date('2026-08-04T17:55:00.000Z'),
        createdAt: new Date(),
      },
    });

    await prisma.leaveRequest.upsert({
      where: { id: 'lv-4-1' },
      update: {},
      create: {
        id: 'lv-4-1',
        organizationId: 'org-alderway',
        employeeId: 'emp-4',
        type: 'CASUAL',
        startDate: '2026-08-10',
        endDate: '2026-08-11',
        reason: 'Family event travel.',
        status: 'APPROVED',
        days: 2,
        appliedAt: new Date('2026-08-01T10:00:00.000Z'),
        decidedAt: new Date('2026-08-02T11:00:00.000Z'),
        decidedByUserId: 'usr-1',
      },
    });

    await prisma.document.upsert({
      where: { id: 'doc-4-1' },
      update: {},
      create: {
        id: 'doc-4-1',
        organizationId: 'org-alderway',
        employeeId: 'emp-4',
        name: 'Employment_Agreement_Patel.pdf',
        description: 'Standard Software Engineer employment agreement.',
        category: 'Contracts',
        fileType: 'PDF',
        sizeKb: 1240,
        cloudinaryPublicId: 'contracts/agreement_patel',
        cloudinaryResourceType: 'raw',
        cloudinaryUrl: 'https://res.cloudinary.com/demo/image/upload/v1580000000/contracts/agreement_patel.pdf',
        uploadedByUserId: 'usr-1',
        createdAt: new Date(),
      },
    });

    console.log('Seeded demo users, org, memberships & employees into memory DB successfully!');
  } catch (err) {
    console.error('Seeding error:', err);
  } finally {
    await prisma.$disconnect();
  }

  // Start main NestJS app
  require('./dist/main.js');
}

main().catch(console.error);
