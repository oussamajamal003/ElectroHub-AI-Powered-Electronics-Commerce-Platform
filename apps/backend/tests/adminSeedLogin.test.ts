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

  it('2. Backend login succeeds for all 5 seeded admin accounts with admin123!', async () => {
    await Promise.all(
      adminEmails.map(async (email) => {
        const response = await request(app)
          .post('/api/auth/login')
          .send({ email, password });

        expect(response.status).toBe(200);
        expect(response.body.user).toBeDefined();
        expect(response.body.user.email).toBe(email);
        expect(response.body.user.role).toBe('ADMIN');
        expect(response.body.accessToken).toBeDefined();

        // Test /api/auth/me using the returned accessToken
        const meResponse = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${response.body.accessToken}`);

        expect(meResponse.status).toBe(200);
        expect(meResponse.body.user).toBeDefined();
        expect(meResponse.body.user.email).toBe(email);
        expect(meResponse.body.user.role).toBe('ADMIN');
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
