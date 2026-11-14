import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import type { Server } from 'node:http';
import request from 'supertest';
import app from '../src/app.js';

let server: Server;
beforeAll(async () => { await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); });
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

describe('Swagger/OpenAPI', () => {
  it('documents both administrator runtime reads and safe failures', async () => {
    const response = await request(server).get('/api/openapi.json');
    for (const path of ['/admin/settings/store', '/admin/dashboard/alerts']) {
      const operation = response.body.paths[path].get;
      expect(operation.security).toEqual([{ bearerAuth: [] }]);
      expect(Object.keys(operation.responses)).toEqual(['200', '401', '403', '500']);
      expect(operation.responses['200'].content['application/json'].schema.required).toEqual(['data']);
    }
  });
  it('should serve Swagger UI at /api/docs', async () => {
    const response = await request(server).get('/api/docs/');

    // Swagger UI returns HTML
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/html/);
  });

  it('should serve OpenAPI JSON specification at /api/openapi.json', async () => {
    const response = await request(server).get('/api/openapi.json');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/json/);
    expect(response.body).toHaveProperty('openapi', '3.0.0');
    expect(response.body).toHaveProperty('info');
    expect(response.body.info).toHaveProperty('title', 'ElectroHub API');
    expect(response.body.info).toHaveProperty('version', '0.1.0');
  });

  it('should document the health endpoint', async () => {
    const response = await request(server).get('/api/openapi.json');

    expect(response.body).toHaveProperty('paths');
    expect(response.body.paths).toHaveProperty('/health');
    expect(response.body.paths['/health']).toHaveProperty('get');
  });

  it('should include security scheme for future authentication', async () => {
    const response = await request(server).get('/api/openapi.json');

    expect(response.body.components).toHaveProperty('securitySchemes');
    expect(response.body.components.securitySchemes).toHaveProperty(
      'bearerAuth'
    );
  });
});
