const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const newPassword = 'Test@123';
  const newHash = await bcrypt.hash(newPassword, 10);
  
  const user = await prisma.user.update({
    where: { email: 'nitinkann2026@gmail.com' },
    data: { passwordHash: newHash },
  });
  
  console.log('✅ Password reset successfully!');
  console.log('   Email:', user.email);
  console.log('   New password: Test@123');
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());

