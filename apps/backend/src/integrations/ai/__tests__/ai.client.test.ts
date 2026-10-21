import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AiServiceClient, AiServiceError } from '../ai.client.js';
import { AI_MAX_RESPONSE_BYTES, type AiServiceEnabledConfig } from '../ai.config.js';

const KEY = 'k7Qp2Zr9Xw4Lm8Nv3Bt6Hy1Jd5Fs0Gc_AiSvc';
const ENV = 'development';
const P1 = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const P2 = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const P3 = '2d6cc2b3-6a1f-4a8b-8e5f-3c9e2a1b0d22';

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;
interface Recorded { method?: string; url?: string; headers: IncomingHttpHeaders; body: string }

function startServer() {
  const state: { handler: Handler; requests: Recorded[] } = { handler: (_q, r) => r.end(), requests: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      state.requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      // No pooled keep-alive sockets survive between tests; hung requests are torn down by the client abort.
      res.setHeader('connection', 'close');
      state.handler(req, res, body);
    });
  });
  return new Promise<{ server: http.Server; state: typeof state; origin: string }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, state, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    });
  });
}

function json(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'x-electrohub-ai-environment': ENV, 'x-request-id': 'srv', ...headers });
  res.end(text);
}

const feature = { available: false, status: 'NOT_READY', reason: 'MODEL_NOT_LOADED', modelVersion: null, embeddingVersion: null };
const ready = { data: { status: 'ready', service: 'electrohub-ai-service', environment: ENV, apiVersion: 'v1', modelReady: false, features: { imageSearch: feature, recommendations: feature } } };
const capabilities = { data: { service: 'electrohub-ai-service', environment: ENV, apiVersion: 'v1', serviceVersion: '0.2.0', features: { imageSearch: feature, recommendations: feature },
  limits: { maxRequestBytes: 1048576, maxTopK: 24, maxCandidates: 200, inferenceTimeoutMs: 5000, maxConcurrentInferences: 2 } } };
const recommendation = (items: unknown, extra: Record<string, unknown> = {}) =>
  ({ data: { mode: 'SIMILAR_PRODUCTS', items, modelVersion: 'clip-v1.0', embeddingVersion: 'emb_2026.10', ...extra } });
const recRequest = { mode: 'SIMILAR_PRODUCTS' as const, productId: P1, candidateProductIds: [P2, P3], limit: 3 };
const errorBody = (code: string) => ({ error: { code, message: 'safe', requestId: 'srv' } });

let ai: Awaited<ReturnType<typeof startServer>>;
let redirectTarget: Awaited<ReturnType<typeof startServer>>;

function config(overrides: Partial<AiServiceEnabledConfig> = {}): AiServiceEnabledConfig {
  return { status: 'enabled', baseUrl: new URL(ai.origin), apiKey: KEY, environment: ENV, timeoutMs: 1000, maxResponseBytes: AI_MAX_RESPONSE_BYTES, ...overrides };
}

async function failure(promise: Promise<unknown>): Promise<AiServiceError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiServiceError);
    const err = error as AiServiceError;
    // Safe messages only: never URL, key or body text.
    expect(err.message).not.toContain(KEY);
    expect(err.message).not.toContain('127.0.0.1');
    expect(err.message).not.toContain('safe');
    return err;
  }
  throw new Error('expected AiServiceError');
}

beforeAll(async () => { ai = await startServer(); redirectTarget = await startServer(); });
afterEach(() => { ai.state.requests = []; redirectTarget.state.requests = []; });
afterAll(async () => {
  for (const s of [ai, redirectTarget]) { s.server.closeAllConnections(); await new Promise(r => s.server.close(r)); }
});

describe('AiServiceClient success paths', () => {
  it('reads readiness with the service credential and never forwards end-user credentials', async () => {
    ai.state.handler = (req, res) => {
      if (req.headers['x-electrohub-ai-key'] !== KEY) return json(res, 401, errorBody('AI_UNAUTHORIZED'));
      json(res, 200, ready);
    };
    const result = await new AiServiceClient(config()).getReadiness({ requestId: 'req_123-abc' });
    expect(result).toEqual(ready.data);
    const [sent] = ai.state.requests;
    expect(sent).toMatchObject({ method: 'GET', url: '/internal/v1/ready' });
    expect(sent.headers['x-electrohub-ai-key']).toBe(KEY);
    expect(sent.headers['x-electrohub-ai-environment']).toBe(ENV);
    expect(sent.headers['x-request-id']).toBe('req_123-abc');
    expect(sent.headers.accept).toBe('application/json');
    expect(sent.headers.authorization).toBeUndefined();
    expect(sent.headers.cookie).toBeUndefined();
  });

  it('does not forward a malicious request id', async () => {
    ai.state.handler = (_req, res) => json(res, 200, ready);
    await new AiServiceClient(config()).getReadiness({ requestId: 'x\r\nAuthorization: Bearer stolen' });
    await new AiServiceClient(config()).getReadiness({ requestId: 'a'.repeat(101) });
    expect(ai.state.requests.map(r => r.headers['x-request-id'])).toEqual([undefined, undefined]);
    expect(ai.state.requests.every(r => r.headers.authorization === undefined)).toBe(true);
  });

  it('reads capabilities', async () => {
    ai.state.handler = (_req, res) => json(res, 200, capabilities, { 'content-type': 'application/json; charset=utf-8' });
    expect(await new AiServiceClient(config()).getCapabilities()).toEqual(capabilities.data);
    expect(ai.state.requests[0].url).toBe('/internal/v1/capabilities');
  });

  it('posts a validated recommendation request and accepts a valid ranked result', async () => {
    const items = [{ productId: P2, score: 0.9, rank: 1 }, { productId: P3, score: 0.9, rank: 2 }, { productId: P1, score: -1, rank: 3 }];
    ai.state.handler = (_req, res) => json(res, 200, recommendation(items));
    const result = await new AiServiceClient(config()).recommend(recRequest);
    expect(result.items).toEqual(items);
    expect(ai.state.requests[0]).toMatchObject({ method: 'POST', url: '/internal/v1/recommendations' });
    expect(JSON.parse(ai.state.requests[0].body)).toEqual(recRequest);
    expect(ai.state.requests[0].headers['content-type']).toBe('application/json');
  });

  it('rejects invalid recommendation input locally without calling the service', async () => {
    const client = new AiServiceClient(config());
    expect((await failure(client.recommend({ ...recRequest, productId: null }))).category).toBe('rejected');
    expect((await failure(client.recommend({ ...recRequest, candidateProductIds: [P2, P2] }))).category).toBe('rejected');
    expect((await failure(client.recommend({ ...recRequest, limit: 25 }))).category).toBe('rejected');
    expect(ai.state.requests).toHaveLength(0);
  });
});

describe('AiServiceClient response validation', () => {
  const cases: Array<[string, string]> = [
    ['invalid UUID', JSON.stringify(recommendation([{ productId: 'not-a-uuid', score: 0.5, rank: 1 }]))],
    ['duplicate productIds', JSON.stringify(recommendation([{ productId: P2, score: 0.5, rank: 1 }, { productId: P2.toUpperCase(), score: 0.4, rank: 2 }]))],
    ['Infinity score', `{"data":{"mode":"SIMILAR_PRODUCTS","items":[{"productId":"${P2}","score":1e999,"rank":1}],"modelVersion":"m","embeddingVersion":"e"}}`],
    ['NaN score', `{"data":{"mode":"SIMILAR_PRODUCTS","items":[{"productId":"${P2}","score":NaN,"rank":1}],"modelVersion":"m","embeddingVersion":"e"}}`],
    ['score above 1', JSON.stringify(recommendation([{ productId: P2, score: 1.0001, rank: 1 }]))],
    ['score below -1', JSON.stringify(recommendation([{ productId: P2, score: -1.5, rank: 1 }]))],
    ['non-contiguous rank', JSON.stringify(recommendation([{ productId: P2, score: 0.5, rank: 1 }, { productId: P3, score: 0.4, rank: 3 }]))],
    ['increasing scores', JSON.stringify(recommendation([{ productId: P2, score: 0.4, rank: 1 }, { productId: P3, score: 0.5, rank: 2 }]))],
    ['more items than limit', JSON.stringify(recommendation([P1, P2, P3, '3e7dd3c4-7b2a-4b9c-9f6a-4d0f3b2c1e33'].map((productId, i) => ({ productId, score: 0.5, rank: i + 1 }))))],
    ['invalid version string', JSON.stringify(recommendation([], { modelVersion: 'bad version!' }))],
    ['different mode', JSON.stringify(recommendation([], { mode: 'POPULAR_PRODUCTS' }))],
    ['unknown field', JSON.stringify({ data: { ...recommendation([]).data, extra: true } })],
    ['invalid JSON', '{"data":'],
  ];

  it.each(cases)('maps %s to invalid_response', async (_label, body) => {
    ai.state.handler = (_req, res) => json(res, 200, body);
    expect((await failure(new AiServiceClient(config()).recommend(recRequest))).category).toBe('invalid_response');
  });

  it('rejects a non-JSON content type', async () => {
    ai.state.handler = (_req, res) => json(res, 200, ready, { 'content-type': 'text/html' });
    expect((await failure(new AiServiceClient(config()).getReadiness())).category).toBe('invalid_response');
  });

  it('rejects an inconsistent readiness feature', async () => {
    const bad = { data: { ...ready.data, features: { ...ready.data.features, imageSearch: { ...feature, available: true } } } };
    ai.state.handler = (_req, res) => json(res, 200, bad);
    expect((await failure(new AiServiceClient(config()).getReadiness())).category).toBe('invalid_response');
  });

  it('rejects a mismatched or missing response environment header', async () => {
    ai.state.handler = (_req, res) => json(res, 200, ready, { 'x-electrohub-ai-environment': 'production' });
    expect((await failure(new AiServiceClient(config()).getReadiness())).category).toBe('environment_mismatch');
    ai.state.handler = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(ready)); };
    expect((await failure(new AiServiceClient(config()).getReadiness())).category).toBe('environment_mismatch');
  });

  it('rejects an oversized declared content-length', async () => {
    ai.state.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-electrohub-ai-environment': ENV, 'content-length': String(AI_MAX_RESPONSE_BYTES + 1) });
      res.write('{');
    };
    expect((await failure(new AiServiceClient(config()).getReadiness())).category).toBe('response_too_large');
  });

  it('caps a chunked body without content-length', async () => {
    let written = 0;
    ai.state.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-electrohub-ai-environment': ENV });
      const chunk = 'x'.repeat(16 * 1024);
      const pump = () => {
        while (written < 4 * AI_MAX_RESPONSE_BYTES && !res.destroyed) {
          written += chunk.length;
          if (!res.write(chunk)) { res.once('drain', pump); return; }
        }
        if (!res.destroyed) res.end();
      };
      pump();
    };
    const started = Date.now();
    const err = await failure(new AiServiceClient(config({ maxResponseBytes: 64 * 1024 })).getReadiness());
    expect(err.category).toBe('response_too_large');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('AiServiceClient transport failures', () => {
  it('does not follow redirects', async () => {
    redirectTarget.state.handler = (_req, res) => json(res, 200, ready);
    ai.state.handler = (_req, res) => { res.writeHead(307, { location: `${redirectTarget.origin}/internal/v1/ready`, 'x-electrohub-ai-environment': ENV }); res.end(); };
    const err = await failure(new AiServiceClient(config()).getReadiness());
    expect(err.category).toBe('invalid_response');
    expect(err.statusCode).toBe(307);
    expect(redirectTarget.state.requests).toHaveLength(0);
  });

  it.each([
    [401, 'AI_UNAUTHORIZED', 'unauthorized'],
    [403, 'AI_ENVIRONMENT_MISMATCH', 'environment_mismatch'],
    [422, 'AI_VALIDATION_FAILED', 'rejected'],
    [503, 'AI_MODEL_NOT_READY', 'unavailable'],
    [503, 'AI_AUTH_NOT_CONFIGURED', 'unavailable'],
    [500, 'AI_INTERNAL_ERROR', 'unavailable'],
  ] as const)('maps HTTP %i %s to %s', async (status, code, category) => {
    ai.state.handler = (_req, res) => json(res, status, errorBody(code));
    const err = await failure(new AiServiceClient(config()).recommend(recRequest));
    expect(err).toMatchObject({ category, statusCode: status, code });
  });

  it('maps a wrong key to unauthorized', async () => {
    ai.state.handler = (req, res) => (req.headers['x-electrohub-ai-key'] === KEY ? json(res, 200, ready) : json(res, 401, errorBody('AI_UNAUTHORIZED')));
    const err = await failure(new AiServiceClient(config({ apiKey: 'Wr0ngKeyWr0ngKeyWr0ngKeyWr0ngKey99' })).getReadiness());
    expect(err).toMatchObject({ category: 'unauthorized', statusCode: 401, code: 'AI_UNAUTHORIZED' });
  });

  it('maps 429 with a bounded Retry-After', async () => {
    ai.state.handler = (_req, res) => json(res, 429, errorBody('AI_RATE_LIMITED'), { 'retry-after': '7' });
    expect(await failure(new AiServiceClient(config()).getReadiness())).toMatchObject({ category: 'rate_limited', retryAfterMs: 7000 });
    ai.state.handler = (_req, res) => json(res, 429, errorBody('AI_RATE_LIMITED'), { 'retry-after': '999999' });
    expect((await failure(new AiServiceClient(config()).getReadiness())).retryAfterMs).toBe(3_600_000);
  });

  it('drops error codes that do not match the contract pattern and never surfaces body text', async () => {
    ai.state.handler = (_req, res) => json(res, 503, { error: { code: 'internal secret at http://10.0.0.1', message: 'safe', requestId: 'srv' } });
    const err = await failure(new AiServiceClient(config()).getReadiness());
    expect(err).toMatchObject({ category: 'unavailable', statusCode: 503 });
    expect(err.code).toBeUndefined();
    expect(err.message).not.toContain('10.0.0.1');
  });

  it('maps connection refused to connect', async () => {
    const closed = await startServer();
    const origin = closed.origin;
    await new Promise(r => closed.server.close(r));
    const err = await failure(new AiServiceClient(config({ baseUrl: new URL(origin) })).getReadiness());
    expect(err.category).toBe('connect');
  });

  it('times out within the configured bound when the service never responds', async () => {
    ai.state.handler = () => undefined;
    const started = Date.now();
    const err = await failure(new AiServiceClient(config({ timeoutMs: 200 })).getReadiness());
    expect(err.category).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('times out while a body stalls mid-stream', async () => {
    ai.state.handler = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'x-electrohub-ai-environment': ENV }); res.write('{"data":'); };
    const started = Date.now();
    expect((await failure(new AiServiceClient(config({ timeoutMs: 200 })).getReadiness())).category).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('honours caller aborts before and during the request', async () => {
    const pre = new AbortController();
    pre.abort();
    expect((await failure(new AiServiceClient(config()).getReadiness({ signal: pre.signal }))).category).toBe('aborted');
    expect(ai.state.requests).toHaveLength(0);

    ai.state.handler = () => undefined;
    const during = new AbortController();
    setTimeout(() => during.abort(), 50);
    const started = Date.now();
    expect((await failure(new AiServiceClient(config({ timeoutMs: 5000 })).getReadiness({ signal: during.signal }))).category).toBe('aborted');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
