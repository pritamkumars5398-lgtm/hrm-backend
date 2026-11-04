const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({ where: { email: 'nitinkann2026@gmail.com' } });
  if (!user) {
    console.log('❌ User not found');
    return;
  }
  console.log('User found:', user.id, user.email);
  
  const passwords = ['Test@123', 'test@123', 'demo1234', 'hello123', 'Test123', 'password'];
  for (const pw of passwords) {
    const ok = await bcrypt.compare(pw, user.passwordHash);
    console.log(`  "${pw}" => ${ok ? '✅ MATCH' : '❌ no'}`);
  }
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());

