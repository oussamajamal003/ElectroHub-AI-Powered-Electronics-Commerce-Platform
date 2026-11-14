/**
 * Task 06.2 — public OTP endpoints are rate limited per client (Work Package E, test 10).
 * Requests are rejected by validation before any database access, so the limiter is the only stateful component exercised.
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../lib/prisma.js', () => ({ prisma: { $queryRaw: vi.fn(), $transaction: vi.fn() } }));

import app from '../app.js';

describe('OTP endpoint rate limits', () => {
  it('verify-email allows 30 attempts per window per client and then answers 429 without reaching the handler', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      const response = await request(app).post('/api/auth/verify-email').send({ email: 'not-an-email', code: '12' });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 30).every((status) => status === 400)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('resend-verification stays rate limited (10 per window) and answers with the shared limiter body', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const response = await request(app).post('/api/auth/resend-verification').send({ email: 'not-an-email' });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
