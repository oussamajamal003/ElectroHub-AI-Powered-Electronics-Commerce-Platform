import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Connecting with pg adapter...');
  const count = await prisma.user.count();
  console.log('User count:', count);
}
main().catch(console.error).finally(() => prisma.$disconnect());
