import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});
async function main() {
  console.log('Connecting...');
  const count = await prisma.user.count();
  console.log('User count:', count);
}
main().catch(console.error).finally(() => prisma.$disconnect());
