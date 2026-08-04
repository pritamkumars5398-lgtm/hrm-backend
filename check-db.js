const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('--- TEST QUERIES ---')
  const docsA = await prisma.document.findMany({
    where: { uploadedByUserId: 'usr-381e39df' }
  });
  console.log('Query A count:', docsA.length);

  const docsB = await prisma.document.findMany({
    where: { uploadedByUserId: 'usr-381e39df', organizationId: 'org-c85651bb' }
  });
  console.log('Query B count:', docsB.length);

  const docsC = await prisma.document.findMany({
    where: { uploadedByUserId: 'usr-381e39df', organizationId: 'org-c85651bb', deletedAt: null }
  });
  console.log('Query C count:', docsC.length);
}

main()
  .catch((e) => {
    console.error(e)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
