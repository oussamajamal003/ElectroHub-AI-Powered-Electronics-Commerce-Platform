import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('Swagger/OpenAPI', () => {
  it('should serve Swagger UI at /api/docs', async () => {
    const response = await request(app).get('/api/docs/');

    // Swagger UI returns HTML
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/html/);
  });

  it('should serve OpenAPI JSON specification at /api/openapi.json', async () => {
    const response = await request(app).get('/api/openapi.json');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/json/);
    expect(response.body).toHaveProperty('openapi', '3.0.0');
    expect(response.body).toHaveProperty('info');
    expect(response.body.info).toHaveProperty('title', 'ElectroHub API');
    expect(response.body.info).toHaveProperty('version', '0.1.0');
  });

  it('should document the health endpoint', async () => {
    const response = await request(app).get('/api/openapi.json');

    expect(response.body).toHaveProperty('paths');
    expect(response.body.paths).toHaveProperty('/health');
    expect(response.body.paths['/health']).toHaveProperty('get');
  });

  it('should include security scheme for future authentication', async () => {
    const response = await request(app).get('/api/openapi.json');

    expect(response.body.components).toHaveProperty('securitySchemes');
    expect(response.body.components.securitySchemes).toHaveProperty(
      'bearerAuth'
    );
  });
});
