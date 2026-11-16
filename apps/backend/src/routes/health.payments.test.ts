import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import router from './health.routes.js';

const db = vi.hoisted(() => ({ paymentWork: { count: vi.fn(), findFirst: vi.fn() }, $queryRaw: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
const app = express(); app.use('/api', router);
beforeEach(() => { vi.resetAllMocks(); });

describe('GET /api/health/payments', () => {
  it('reports ok when nothing is overdue and nothing is in INCIDENT', async () => {
    db.paymentWork.count.mockResolvedValue(0); db.paymentWork.findFirst.mockResolvedValue(null);
    const response = await request(app).get('/api/health/payments');
    expect(response.status).toBe(200); expect(response.body.data).toMatchObject({ status: 'ok', overdueWork: 0, oldestOverdueSeconds: 0, incidentWork: 0 });
  });
  it('reports degraded with the worker hint when work is overdue (runner absent or stalled)', async () => {
    db.paymentWork.count.mockResolvedValueOnce(11).mockResolvedValueOnce(0);
    db.paymentWork.findFirst.mockResolvedValue({ nextRunAt: new Date(Date.now() - 3 * 3_600_000) });
    const response = await request(app).get('/api/health/payments');
    expect(response.status).toBe(503);
    expect(response.body.data).toMatchObject({ status: 'degraded', overdueWork: 11, incidentWork: 0 });
    expect(response.body.data.oldestOverdueSeconds).toBeGreaterThan(10_000); expect(response.body.data.hint).toMatch(/payment recovery runner/);
    expect(JSON.stringify(response.body)).not.toMatch(/attemptId|userId|email/);
  });
  it('reports degraded for INCIDENT work and fails closed to 503 unknown when the database is unavailable', async () => {
    db.paymentWork.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2); db.paymentWork.findFirst.mockResolvedValue(null);
    expect((await request(app).get('/api/health/payments')).body.data).toMatchObject({ status: 'degraded', incidentWork: 2 });
    db.paymentWork.count.mockRejectedValue(new Error('db down'));
    const down = await request(app).get('/api/health/payments');
    expect(down.status).toBe(503); expect(down.body.error.status).toBe('unknown');
  });
});
