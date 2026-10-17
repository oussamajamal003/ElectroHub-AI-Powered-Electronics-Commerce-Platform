import { prisma } from '../src/lib/prisma.js';
import crypto from 'crypto';

async function testScenario(name: string, fn: () => Promise<void>) {
  console.log(`\n=== SCENARIO: ${name} ===`);
  try {
    await fn();
  } catch (err) {
    console.error(`Scenario "${name}" threw error:`, err);
  }
}

async function createTokenForUser(userId: string, isRevoked = false, isExpired = false) {
  const rawRefreshToken = crypto.randomBytes(64).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
  const expiresAt = isExpired
    ? new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      isRevoked,
    },
  });

  return { rawRefreshToken, tokenHash };
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { role: { name: 'CUSTOMER' }, isActive: true },
    include: { role: true },
  });

  if (!user) {
    console.error('No active customer found!');
    return;
  }
  console.log('Using customer:', user.email, user.id);

  // Scenario 1: Valid Refresh via HTTP
  await testScenario('1. Valid Refresh via HTTP', async () => {
    const { rawRefreshToken } = await createTokenForUser(user.id);
    const res = await fetch('http://localhost:5000/api/auth/refresh', {
      method: 'POST',
      headers: {
        Cookie: `electrohub_refresh=${rawRefreshToken}`,
      },
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Body:', text);
  });

  // Scenario 2: Expired Token via HTTP
  await testScenario('2. Expired Token via HTTP', async () => {
    const { rawRefreshToken } = await createTokenForUser(user.id, false, true);
    const res = await fetch('http://localhost:5000/api/auth/refresh', {
      method: 'POST',
      headers: {
        Cookie: `electrohub_refresh=${rawRefreshToken}`,
      },
    });
    console.log('Status:', res.status);
    console.log('Body:', await res.text());
  });

  // Scenario 3: Revoked Token via HTTP
  await testScenario('3. Revoked Token via HTTP', async () => {
    const { rawRefreshToken } = await createTokenForUser(user.id, true, false);
    const res = await fetch('http://localhost:5000/api/auth/refresh', {
      method: 'POST',
      headers: {
        Cookie: `electrohub_refresh=${rawRefreshToken}`,
      },
    });
    console.log('Status:', res.status);
    console.log('Body:', await res.text());
  });

  // Scenario 4: Reused Token (Token used twice in sequence)
  await testScenario('4. Reused Token (Rotated then used again)', async () => {
    const { rawRefreshToken } = await createTokenForUser(user.id);
    const res1 = await fetch('http://localhost:5000/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `electrohub_refresh=${rawRefreshToken}` },
    });
    console.log('Call 1 Status:', res1.status);

    const res2 = await fetch('http://localhost:5000/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `electrohub_refresh=${rawRefreshToken}` },
    });
    console.log('Call 2 Status:', res2.status);
    console.log('Call 2 Body:', await res2.text());
  });

  // Scenario 5: Concurrent Refresh Requests (5 simultaneous requests with SAME token)
  await testScenario('5. Concurrent Refresh Requests (5 simultaneous)', async () => {
    const { rawRefreshToken } = await createTokenForUser(user.id);
    const promises = Array.from({ length: 5 }).map((_, i) =>
      fetch('http://localhost:5000/api/auth/refresh', {
        method: 'POST',
        headers: { Cookie: `electrohub_refresh=${rawRefreshToken}` },
      }).then(async (r) => ({
        index: i,
        status: r.status,
        body: await r.text(),
      }))
    );

    const results = await Promise.all(promises);
    for (const res of results) {
      console.log(`Req ${res.index}: Status ${res.status} -> ${res.body}`);
    }
  });

  await prisma.$disconnect();
}

main().catch(console.error);
