import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import routes from './search.routes.js';
import { requestId } from '../middleware/requestId.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { IMAGE_SEARCH_RATE_LIMIT } from '../middleware/rateLimiter.js';

vi.mock('../lib/prisma.js', () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, logSafely: vi.fn() }));

const app = express();
app.use(requestId);
app.use('/api/search', routes);
app.use(errorHandler);

describe('POST /api/search/image per-IP limit', () => {
  it('allows 20 requests per 5 minutes and answers the 21st with 429 before reading any body', async () => {
    expect(IMAGE_SEARCH_RATE_LIMIT).toEqual({ windowMs: 5 * 60 * 1000, limit: 20 });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < IMAGE_SEARCH_RATE_LIMIT.limit; attempt += 1) {
      // No image attached: each allowed request fails validation (400) but still counts against the budget.
      statuses.push((await request(app).post('/api/search/image')).status);
    }
    expect(new Set(statuses)).toEqual(new Set([400]));

    const limited = await request(app).post('/api/search/image').attach('image', Buffer.from([0xff, 0xd8, 0xff]), 'a.jpg');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['ratelimit-policy'] ?? limited.headers['ratelimit-limit']).toBeDefined();
  });
});
