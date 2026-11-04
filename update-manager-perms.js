const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const MANAGER_PERMISSIONS = [
  'attendance.view', 'attendance.manage',
  'leave.view', 'leave.approve',
  'performance.view', 'performance.manage',
  'documents.view',
  'reports.view',
  'employees.view',
  'recruitment.view',
  'onboarding.view',
  'timesheets.view', 'timesheets.manage',
  'expenses.view', 'expenses.manage',
  'travel.view', 'travel.manage',
  'helpdesk.view', 'helpdesk.manage',
  'engagement.view', 'engagement.manage',
  'communication.view', 'communication.manage',
  'lms.view',
  'ai-copilot.view',
  'team.view',
];

async function main() {
  const result = await prisma.membership.update({
    where: { id: 'mem-3' },
    data: { permissions: MANAGER_PERMISSIONS },
  });
  console.log('✅ Manager permissions updated in DB!');
  console.log('   Total permissions:', result.permissions.length);
  result.permissions.forEach(p => console.log('  -', p));
}

main().catch(e => console.error('❌ Error:', e.message)).finally(() => prisma.$disconnect());

