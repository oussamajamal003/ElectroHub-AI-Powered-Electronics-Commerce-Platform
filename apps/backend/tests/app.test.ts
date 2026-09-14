import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('App Middleware & Global Handlers', () => {
  it('should return 404 Not Found in standardized format for unknown routes', async () => {
    const response = await request(app).get('/api/this-route-does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toHaveProperty('code', 'NOT_FOUND');
    expect(response.body.error).toHaveProperty('message', 'Route GET /api/this-route-does-not-exist not found');
  });

  it('should attach x-request-id to responses', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.headers['x-request-id'].length).toBeGreaterThan(0);
  });
});
