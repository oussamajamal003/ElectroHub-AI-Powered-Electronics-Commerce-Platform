/* eslint-disable no-console */
/**
 * Task 03.9 browser QA: creates (once) a second synthetic isolated customer "B" for account-switch checks and appends its generated
 * credentials to the gitignored .isolated/fixture-credentials.txt (never printed). Disposable isolated database only.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/utils/hash.js';

const file = path.join(__dirname, '..', '.isolated', 'fixture-credentials.txt');
(async () => {
  const [db] = await prisma.$queryRaw<{ db: string; port: number }[]>`select current_database()::text as db, inet_server_port()::int as port`;
  if (db!.db !== 'electrohub_disposable' || db!.port !== 55434) throw new Error('Refusing: not the disposable isolated database.');
  if (/^customer_b=/m.test(readFileSync(file, 'utf8'))) { console.log('customer B already provisioned'); return prisma.$disconnect(); }
  const email = 'customer-b@isolated.electrohub.test'; const password = `IsoB-${randomBytes(8).toString('hex')}!`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
  await prisma.user.create({ data: { roleId: role.id, email, passwordHash: await hashPassword(password), firstName: 'Second', lastName: 'Customer',
    isActive: true, emailVerifiedAt: new Date() } });
  appendFileSync(file, `\ncustomer_b=${email}\ncustomer_b_password=${password}\n`);
  console.log('customer B provisioned; credentials appended to the isolated fixture file');
  await prisma.$disconnect();
})().catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
