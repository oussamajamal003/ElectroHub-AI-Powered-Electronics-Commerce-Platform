require('dotenv').config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  
  try {
    const roles = await prisma.role.findMany();
    console.log('PRISMA ADAPTER CONNECTED TO HOSTNAME!', roles.length, 'roles found.');
  } catch (e) {
    console.error('PRISMA ADAPTER ERROR:', e);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();