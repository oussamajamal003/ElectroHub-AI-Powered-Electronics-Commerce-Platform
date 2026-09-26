import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../errorHandler.js';

describe('unexpected error responses', () => {
  it('never exposes internal Prisma or TLS diagnostics to clients', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new Error('Invalid prisma.user.findUnique() at C:\\private\\auth.repository.ts: self-signed certificate in certificate chain');
    });
    app.use(errorHandler);

    const response = await request(app).get('/boom');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong. Please try again later.' },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/prisma|certificate|auth\.repository|C:\\/i);
  });
});
