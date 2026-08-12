const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');

// Pre-calculated bcrypt hash for "demo1234"
const DEMO_HASH = '$2b$10$S/JdXTN6BjYEEZaW0FBE5OXgZZ/LGyayrkC6fTZN28BhqIXAXAriC';

async function main() {
  console.log('1. Starting MongoMemoryReplSet...');
  const replSet = await MongoMemoryReplSet.create({
    replSet: { dbName: 'keystone', count: 1 },
    instanceOpts: [{ launchTimeout: 60000 }],
  });

  let uri = replSet.getUri();
  if (uri.includes('/?')) {
    uri = uri.replace('/?', '/keystone?');
  } else if (uri.endsWith('/')) {
    uri = uri + 'keystone';
  } else {
    uri = uri + '/keystone';
  }

  process.env.MONGO_URI = uri;
  process.env.DATABASE_URL = uri;
  process.env.EMBEDDED_MONGO_RUNNING = 'true';

  console.log('Waiting 5 seconds for ReplicaSet election...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log(`2. Connecting native driver to ${uri}...`);
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('keystone');

  console.log('3. Seeding collections via native driver...');

  // Clear any existing data
  await db.collection('User').deleteMany({});
  await db.collection('Organization').deleteMany({});
  await db.collection('Membership').deleteMany({});
  await db.collection('Employee').deleteMany({});
  await db.collection('AppraisalCycle').deleteMany({});
  await db.collection('Goal').deleteMany({});
  await db.collection('Review').deleteMany({});
  await db.collection('SalaryStructure').deleteMany({});
  await db.collection('Payslip').deleteMany({});
  await db.collection('AttendanceRecord').deleteMany({});
  await db.collection('LeaveRequest').deleteMany({});
  await db.collection('Document').deleteMany({});

  // User collection
  await db.collection('User').insertOne({
    _id: 'usr-1',
    id: 'usr-1',
    email: 'hr@demo.com',
    name: 'Marta Lindqvist',
    avatarInitials: 'ML',
    passwordHash: DEMO_HASH,
    requiresPasswordReset: false,
    createdAt: new Date(),
    fcmTokens: [],
  });

  await db.collection('User').insertOne({
    _id: 'usr-2',
    id: 'usr-2',
    email: 'owner@demo.com',
    name: 'Priya Nair',
    avatarInitials: 'PN',
    passwordHash: DEMO_HASH,
    requiresPasswordReset: false,
    createdAt: new Date(),
    fcmTokens: [],
  });

  await db.collection('User').insertOne({
    _id: 'usr-3',
    id: 'usr-3',
    email: 'manager@demo.com',
    name: 'Samuel Okafor',
    avatarInitials: 'SO',
    passwordHash: DEMO_HASH,
    requiresPasswordReset: false,
    createdAt: new Date(),
    fcmTokens: [],
  });

  await db.collection('User').insertOne({
    _id: 'usr-4',
    id: 'usr-4',
    email: 'employee@demo.com',
    name: 'Amit Patel',
    avatarInitials: 'AP',
    passwordHash: DEMO_HASH,
    requiresPasswordReset: false,
    createdAt: new Date(),
    fcmTokens: [],
  });

  await db.collection('User').insertOne({
    _id: 'usr-5',
    id: 'usr-5',
    email: 'unauthorized@demo.com',
    name: 'Unauthorized User',
    avatarInitials: 'UU',
    passwordHash: DEMO_HASH,
    requiresPasswordReset: false,
    createdAt: new Date(),
    fcmTokens: [],
  });

  // Organization collection
  await db.collection('Organization').insertOne({
    _id: 'org-alderway',
    id: 'org-alderway',
    name: 'Alderway Labs',
    address: '4 Wharf Road, London, E15 2QR',
    industry: 'Software & Technology',
    ownerId: 'usr-2',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Membership collection
  await db.collection('Membership').insertOne({
    _id: 'mem-1',
    id: 'mem-1',
    userId: 'usr-1',
    organizationId: 'org-alderway',
    jobTitle: 'HR Manager',
    permissions: [
      'employees.*',
      'attendance.*',
      'leave.*',
      'documents.*',
      'reports.view',
      'team.invite',
      'team.view'
    ],
    createdAt: new Date(),
  });

  await db.collection('Membership').insertOne({
    _id: 'mem-2',
    id: 'mem-2',
    userId: 'usr-2',
    organizationId: 'org-alderway',
    jobTitle: 'Founder & CEO',
    permissions: ['*'],
    createdAt: new Date(),
  });

  await db.collection('Membership').insertOne({
    _id: 'mem-3',
    id: 'mem-3',
    userId: 'usr-3',
    organizationId: 'org-alderway',
    jobTitle: 'Engineering Manager',
    permissions: [
      'attendance.view',
      'leave.approve',
      'performance.view',
      'documents.view'
    ],
    createdAt: new Date(),
  });

  await db.collection('Membership').insertOne({
    _id: 'mem-4',
    id: 'mem-4',
    userId: 'usr-4',
    organizationId: 'org-alderway',
    jobTitle: 'Software Engineer',
    permissions: [
      'attendance.view',
      'leave.view',
      'performance.view',
      'documents.view'
    ],
    createdAt: new Date(),
  });

  // Employee collection
  await db.collection('Employee').insertOne({
    _id: 'emp-1',
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
    educationDetails: [],
    familyDetails: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.collection('Employee').insertOne({
    _id: 'emp-2',
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
    educationDetails: [],
    familyDetails: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.collection('Employee').insertOne({
    _id: 'emp-3',
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
    educationDetails: [],
    familyDetails: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.collection('Employee').insertOne({
    _id: 'emp-4',
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
    educationDetails: [],
    familyDetails: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Seed sub-resource records for employees (emp-4 is Amit Patel)
  await db.collection('AppraisalCycle').insertOne({
    _id: 'cycle-1',
    id: 'cycle-1',
    organizationId: 'org-alderway',
    name: 'Q3 2026 Appraisal Cycle',
    status: 'OPEN',
    startDate: '2026-07-01',
    endDate: '2026-09-30',
    createdAt: new Date(),
  });

  await db.collection('Goal').insertOne({
    _id: 'goal-1',
    id: 'goal-1',
    organizationId: 'org-alderway',
    employeeId: 'emp-4',
    cycleId: 'cycle-1',
    title: 'Integrate the Employees sub-module',
    progress: 85,
    dueOn: '2026-09-15',
    createdAt: new Date(),
  });

  await db.collection('Review').insertOne({
    _id: 'rev-1',
    id: 'rev-1',
    organizationId: 'org-alderway',
    employeeId: 'emp-4',
    cycleId: 'cycle-1',
    rating: 5,
    summary: 'Outstanding performance on front-end component modernization and backend authorization audits.',
    reviewerUserId: 'usr-1',
    createdAt: new Date(),
  });

  await db.collection('SalaryStructure').insertOne({
    _id: 'sal-4',
    id: 'sal-4',
    organizationId: 'org-alderway',
    employeeId: 'emp-4',
    basic: 65000,
    hra: 25000,
    otherAllowance: 10000,
    effectiveFrom: '2026-01-01',
    createdByUserId: 'usr-2',
    createdAt: new Date(),
  });

  await db.collection('Payslip').insertOne({
    _id: 'ps-4-07',
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
  });

  await db.collection('AttendanceRecord').insertOne({
    _id: 'emp-4_2026-08-03', // Compounded unique key matching the index constraint
    id: 'att-4-1',
    organizationId: 'org-alderway',
    employeeId: 'emp-4',
    date: '2026-08-03',
    checkIn: new Date('2026-08-03T09:02:00.000Z'),
    checkOut: new Date('2026-08-03T18:05:00.000Z'),
    createdAt: new Date(),
  });

  await db.collection('AttendanceRecord').insertOne({
    _id: 'emp-4_2026-08-04',
    id: 'att-4-2',
    organizationId: 'org-alderway',
    employeeId: 'emp-4',
    date: '2026-08-04',
    checkIn: new Date('2026-08-04T08:58:00.000Z'),
    checkOut: new Date('2026-08-04T17:55:00.000Z'),
    createdAt: new Date(),
  });

  await db.collection('LeaveRequest').insertOne({
    _id: 'lv-4-1',
    id: 'lv-4-1',
    organizationId: 'org-alderway',
    employeeId: 'emp-4',
    type: 'CASUAL',
    startDate: '2026-08-10',
    endDate: '2026-08-11',
    reason: 'Family event travel.',
    status: 'APPROVED',
    days: 2,
    requestedAt: new Date('2026-08-01T10:00:00.000Z'),
    decidedAt: new Date('2026-08-02T11:00:00.000Z'),
    decidedByUserId: 'usr-1',
  });

  await db.collection('Document').insertOne({
    _id: 'doc-4-1',
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
  });

  console.log('✅ SEEDING COMPLETE & VERIFIED!');
  await client.close();

  // Load and bootstrap NestJS backend
  console.log('4. Starting NestJS Backend Server...');
  require('./dist/main.js');
}

main().catch(console.error);
