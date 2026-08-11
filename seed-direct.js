const { MongoClient, ObjectId } = require('mongodb');

async function seed() {
  const uri = process.argv[2] || 'mongodb://127.0.0.1:55345/keystone?directConnection=true';
  console.log('Connecting to:', uri);
  const client = await MongoClient.connect(uri);
  const db = client.db('keystone');

  const users = db.collection('User');
  const orgs = db.collection('Organization');
  const mems = db.collection('Membership');

  const passwordHash = '$2b$10$S/JdXTN6BjYEEZaW0FBE5OXgZZ/LGyayrkC6fTZN28BhqIXAXAriC'; // demo1234

  await users.deleteMany({});
  await users.insertMany([
    {
      _id: 'usr-1',
      id: 'usr-1',
      email: 'hr@demo.com',
      passwordHash: passwordHash,
      requiresPasswordReset: false,
      name: 'HR Manager',
      avatarInitials: 'HR',
      fcmTokens: [],
      createdAt: new Date()
    },
    {
      _id: 'usr-2',
      id: 'usr-2',
      email: 'owner@demo.com',
      passwordHash: passwordHash,
      requiresPasswordReset: false,
      name: 'Owner User',
      avatarInitials: 'OU',
      fcmTokens: [],
      createdAt: new Date()
    },
    {
      _id: 'usr-3',
      id: 'usr-3',
      email: 'manager@demo.com',
      passwordHash: passwordHash,
      requiresPasswordReset: false,
      name: 'Line Manager',
      avatarInitials: 'LM',
      fcmTokens: [],
      createdAt: new Date()
    }
  ]);

  await orgs.updateOne(
    { _id: 'org-alderway' },
    {
      $set: {
        id: 'org-alderway',
        name: 'Alderway Technologies',
        address: '123 Tech Park',
        industry: 'Software',
        ownerId: 'usr-2',
        createdAt: new Date()
      }
    },
    { upsert: true }
  );

  await mems.deleteMany({});
  await mems.insertMany([
    {
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
      createdAt: new Date()
    },
    {
      _id: 'mem-2',
      id: 'mem-2',
      userId: 'usr-2',
      organizationId: 'org-alderway',
      jobTitle: 'Founder & CEO',
      permissions: ['*'],
      createdAt: new Date()
    },
    {
      _id: 'mem-3',
      id: 'mem-3',
      userId: 'usr-3',
      organizationId: 'org-alderway',
      jobTitle: 'Engineering Lead',
      permissions: [
        'attendance.view',
        'leave.approve',
        'performance.view',
        'documents.view'
      ],
      createdAt: new Date()
    }
  ]);

  console.log('✅ SEEDED DEMO ACCOUNTS MATCHING PRISMA SCHEMA');
  await client.close();
}

seed().catch(console.error);
