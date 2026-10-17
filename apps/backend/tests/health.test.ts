import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

describe('GET /api/health', () => {
  it('should return 200 with health status', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('data');
    expect(response.body.data).toHaveProperty('status', 'healthy');
    expect(response.body.data).toHaveProperty('service', 'electrohub-backend');
    expect(response.body.data).toHaveProperty('timestamp');
    expect(response.body.data).toHaveProperty('version', '0.1.0');
  });

  it('should return a valid ISO timestamp', async () => {
    const response = await request(app).get('/api/health');

    const timestamp = new Date(response.body.data.timestamp);
    expect(timestamp.toISOString()).toBe(response.body.data.timestamp);
  });

  it('should return consistent response structure', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['content-type']).toMatch(/json/);
    expect(Object.keys(response.body)).toEqual(['data']);
  });
});

describe('GET /api/health/ready and /api/ready', () => {
  it('should return 200 when database connection is healthy', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ '?column?': 1 }]);

    const response = await request(app).get('/api/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('data');
    expect(response.body.data).toHaveProperty('status', 'ready');
    expect(response.body.data).toHaveProperty('database', 'connected');
    expect(response.body.data).toHaveProperty('service', 'electrohub-backend');

    const aliasResponse = await request(app).get('/api/ready');
    expect(aliasResponse.status).toBe(200);
    expect(aliasResponse.body.data).toHaveProperty('status', 'ready');

    spy.mockRestore();
  });

  it('should return 503 when database is unavailable', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('Connection refused: private-host password=private-value'));

    const response = await request(app).get('/api/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toHaveProperty('status', 'not_ready');
    expect(response.body.error).toHaveProperty('database', 'disconnected');
    expect(response.body.error).toHaveProperty('message', 'Database unavailable');
    expect(JSON.stringify(response.body)).not.toMatch(/private-host|private-value|password/);
    const aliasResponse = await request(app).get('/api/ready');
    expect(aliasResponse.status).toBe(503);
    expect(aliasResponse.body.error.message).toBe('Database unavailable');
    expect(JSON.stringify(aliasResponse.body)).not.toMatch(/private-host|private-value|password/);

    spy.mockRestore();
  });
});
