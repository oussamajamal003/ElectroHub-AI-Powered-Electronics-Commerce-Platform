import express from 'express';
import request from 'supertest';
import Transport from 'winston-transport';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logger } from '../src/utils/logger.js';
import { requestId } from '../src/middleware/requestId.js';
import { requestLogger } from '../src/middleware/requestLogger.js';
import { AppError, errorHandler } from '../src/middleware/errorHandler.js';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
class Capture extends Transport {
  records: Record<string, unknown>[] = [];
  log(info: Record<string, unknown>, callback: () => void) { this.records.push(info); callback(); }
}
let capture: Capture;
beforeEach(() => { capture = new Capture(); logger.add(capture); });
afterEach(() => logger.remove(capture));
describe('HTTP logging coverage', () => {
  function app() {
    const app = express(); app.use(requestId, requestLogger, express.json());
    app.post('/checkout', (_req, res) => res.json({ data: 'private' }));
    app.get('/handled', () => { throw new AppError('Denied', 403, 'ACCESS_DENIED'); });
    app.get('/direct', (_req, res) => res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Denied' } }));
    app.get('/activity', async (_req, res) => { await Promise.resolve(); logger.info('Inner service activity'); res.sendStatus(200); });
    app.use(errorHandler); return app;
  }
  it('records parser failures before routing without query strings or bodies', async () => {
    const response = await request(app()).post('/checkout?password=private').set('Content-Type', 'application/json').send('{ invalid private');
    expect(response.status).toBe(500);
    expect(capture.records.some(item => item.operation === 'http.started')).toBe(true);
    expect(capture.records.some(item => item.operation === 'http.completed')).toBe(true);
    // Parser exception messages can contain body snippets: these must be removed at the error boundary.
    expect(capture.records.some(item => 'body' in item && item.body !== '[REDACTED]')).toBe(false);
    expect(JSON.stringify(capture.records)).not.toContain('password=private');
    expect(JSON.stringify(capture.records)).not.toContain('{ invalid private');
  });
  it('captures a handled failure once at error severity and includes its code', async () => {
    await request(app()).get('/handled');
    expect(capture.records.filter(item => item.level === 'error')).toHaveLength(1);
    expect(capture.records.find(item => item.operation === 'http.completed')?.code).toBe('ACCESS_DENIED');
  });
  it('captures directly returned failure codes', async () => {
    await request(app()).get('/direct');
    expect(capture.records.find(item => item.operation === 'http.completed')).toMatchObject({ level: 'error', code: 'AUTH_REQUIRED' });
  });
  it('propagates request correlation through asynchronous services', async () => {
    await request(app()).get('/activity').set('x-request-id', 'correlation-test');
    expect(capture.records.find(item => item.message === 'Inner service activity')?.correlationId).toBe('correlation-test');
  });
  it('records an aborted response once even if close repeats', () => {
    const req = { id: 'aborted-fixture', method: 'GET' } as Request;
    const res = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: false, locals: {}, json: () => res }) as unknown as Response;
    requestLogger(req, res, () => {});
    res.emit('close'); res.emit('close');
    expect(capture.records.filter(record => record.operation === 'http.aborted')).toHaveLength(1);
    expect(capture.records.find(record => record.operation === 'http.aborted')).toMatchObject({ level: 'error', code: 'HTTP_ABORTED' });
  });
});
