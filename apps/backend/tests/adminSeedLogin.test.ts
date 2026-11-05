import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

describe('Admin Seed Authentication Integration Tests', () => {
  const adminEmails = [
    'admin@electrohub.com',
    'admin1@electrohub.com',
    'admin2@electrohub.com',
    'admin3@electrohub.com',
    'admin4@electrohub.com',
  ];
  const password = 'admin123!';

  it('1. All 5 admin accounts exist in database with role = ADMIN', async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: adminEmails } },
      include: { role: true },
    });
    
    expect(users.length).toBe(5);
    for (const email of adminEmails) {
      const user = users.find((u) => u.email === email);
      expect(user).toBeDefined();
      expect(user?.role.name).toBe('ADMIN');
      expect(user?.isActive).toBe(true);
    }
  }, 15000);

  // Task 05.2: a correct administrator password opens only a restricted MFA transaction (or, for a factor-less account without an
  // operator enrollment window, is refused) — it never returns an access token or a refresh cookie.
  it('2. A correct seeded admin password never yields a session without the second factor', async () => {
    await Promise.all(
      adminEmails.map(async (email) => {
        const response = await request(app)
          .post('/api/auth/login')
          .send({ email, password });

        expect([200, 403]).toContain(response.status);
        if (response.status === 200) expect(response.body.requiresMfa).toBe(true);
        else expect(response.body.error.code).toBe('ENROLLMENT_NOT_AUTHORIZED');
        expect(response.body.accessToken).toBeUndefined();
        expect(response.headers['set-cookie']).toBeUndefined();
      })
    );
  }, 60000);

  it('3. Seed accounts cannot be logged into with incorrect password', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@electrohub.com', password: 'wrongpassword' });

    expect(response.status).toBe(401);
  }, 15000);
});
