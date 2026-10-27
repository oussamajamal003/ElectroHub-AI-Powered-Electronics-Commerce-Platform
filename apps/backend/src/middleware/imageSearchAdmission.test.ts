import express, { type RequestHandler } from 'express';
import http, { type Server, type ClientRequest } from 'node:http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageSearchAdmission, imageSearchLifecycle } from './imageSearchAdmission.js';
import { imageSearchUpload } from './imageSearchUpload.js';
import { errorHandler } from './errorHandler.js';
import { requestId } from './requestId.js';
import { getImageSearchLifecycleMetrics, resetImageSearchLifecycleMetricsForTests } from '../integrations/ai/image-search.telemetry.js';

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../utils/logger.js', () => ({ logger: log, logSafely: vi.fn() }));
const servers: Server[] = [];
const clients: ClientRequest[] = [];
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]);
const prefix = '--review\r\nContent-Disposition: form-data; name="image"; filename="private.jpg"\r\nContent-Type: image/jpeg\r\n\r\n';

async function fixture(options = { maxConcurrent: 1, uploadTimeoutMs: 1000, requestTimeoutMs: 2000 }, handler?: RequestHandler) {
  const app = express();
  const parse = vi.fn(imageSearchUpload);
  app.use(requestId);
  app.post('/image', createImageSearchAdmission(options), parse, handler ?? ((_req, res) => { res.json({ ok: true }); }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listening test port');
  return { server, port: address.port, parse };
}

function slow(port: number) {
  let client: ClientRequest;
  const response = new Promise<{ status: number; code: string }>((resolve, reject) => {
    client = http.request({ hostname: '127.0.0.1', port, path: '/image', method: 'POST', headers: {
      'content-type': 'multipart/form-data; boundary=review', 'content-length': '2000000',
    } }, incoming => {
      let body = '';
      incoming.on('data', chunk => { body += String(chunk); });
      incoming.on('end', () => { try { resolve({ status: incoming.statusCode ?? 0, code: JSON.parse(body).error.code as string }); } catch (error) { reject(error); } });
    });
    // Deliberately aborted clients have no response. Their lifecycle is asserted through server metrics instead.
    client.on('error', () => {});
    clients.push(client);
    client.write(prefix); client.write(jpeg);
  });
  return { client: client!, response };
}

beforeEach(() => { vi.clearAllMocks(); resetImageSearchLifecycleMetricsForTests(); });
afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
});

describe('pre-body image search admission', () => {
  it('rejects saturated requests before parsing and recovers immediately after disconnect', async () => {
    const { server, port, parse } = await fixture();
    const pending = slow(port);
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
    const busy = await request(server).post('/image').attach('image', jpeg, 'secret.jpg');
    expect(busy.status).toBe(429); expect(busy.body.error.code).toBe('IMAGE_UPLOAD_BUSY');
    expect(busy.headers['retry-after']).toBe('1'); expect(parse).toHaveBeenCalledTimes(1);
    pending.client.destroy();
    await vi.waitFor(() => expect(getImageSearchLifecycleMetrics().disconnected).toBe(1));
    expect((await request(server).post('/image').attach('image', jpeg, 'ok.jpg')).status).toBe(200);
    expect(getImageSearchLifecycleMetrics()).toMatchObject({ admitted: 2, busy: 1, parsed: 1, completed: 1 });
  });

  it('expires a slow upload independently of inference and frees its slot', async () => {
    const { server, port } = await fixture({ maxConcurrent: 1, uploadTimeoutMs: 80, requestTimeoutMs: 2000 });
    const started = Date.now();
    expect(await slow(port).response).toEqual({ status: 408, code: 'IMAGE_UPLOAD_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(getImageSearchLifecycleMetrics().upload_timeout).toBe(1);
    expect((await request(server).post('/image').attach('image', jpeg, 'ok.jpg')).status).toBe(200);
  });

  it('caps total retained work even when downstream never completes', async () => {
    let signal: AbortSignal | undefined;
    const { server } = await fixture({ maxConcurrent: 1, uploadTimeoutMs: 1000, requestTimeoutMs: 100 }, (req, _res) => {
      signal = imageSearchLifecycle(req)?.signal;
    });
    const response = await request(server).post('/image').attach('image', jpeg, 'ok.jpg');
    expect(response.status).toBe(504); expect(response.body.error.code).toBe('IMAGE_SEARCH_REQUEST_TIMEOUT');
    expect(signal?.aborted).toBe(true); expect(getImageSearchLifecycleMetrics().request_timeout).toBe(1);
  });

  it.each([
    ['invalid', Buffer.from('not an image'), 415],
    ['too_large', Buffer.concat([jpeg, Buffer.alloc(8 * 1024 * 1024)]), 413],
  ])('releases capacity for %s rejection', async (outcome, bytes, status) => {
    const { server } = await fixture();
    expect((await request(server).post('/image').attach('image', bytes, 'private.jpg')).status).toBe(status);
    expect(getImageSearchLifecycleMetrics()[outcome]).toBe(1);
    expect((await request(server).post('/image').attach('image', jpeg, 'ok.jpg')).status).toBe(200);
  });

  it('releases after malformed multipart and downstream errors', async () => {
    let fail = true;
    const { server } = await fixture(undefined, (_req, res, next) => {
      if (fail) { fail = false; next(new Error('private downstream detail')); } else res.json({ ok: true });
    });
    const bad = await request(server).post('/image').set('Content-Type', 'multipart/form-data; boundary=review').send('malformed');
    expect(bad.status).toBe(400); expect(getImageSearchLifecycleMetrics().parse_failed).toBe(1);
    expect((await request(server).post('/image').attach('image', jpeg, 'ok.jpg')).status).toBe(500);
    expect((await request(server).post('/image').attach('image', jpeg, 'ok.jpg')).status).toBe(200);
  });

  it('cannot turn logger failures into failed uploads', async () => {
    log.info.mockImplementation(() => { throw new Error('observer broken'); });
    log.warn.mockImplementation(() => { throw new Error('observer broken'); });
    const { server } = await fixture();
    expect((await request(server).post('/image').attach('image', jpeg, 'private.jpg')).status).toBe(200);
  });
});
