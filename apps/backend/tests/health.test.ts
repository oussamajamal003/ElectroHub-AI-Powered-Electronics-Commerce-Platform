import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

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
