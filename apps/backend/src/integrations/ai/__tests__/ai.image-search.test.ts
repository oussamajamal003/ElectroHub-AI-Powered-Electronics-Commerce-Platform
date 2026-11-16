import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiServiceClient, AiServiceError, type ImageSearchInput } from '../ai.client.js';
import { AI_MAX_RESPONSE_BYTES, type AiServiceEnabledConfig } from '../ai.config.js';
import { aiImageSearchResultSchema } from '../ai.schemas.js';
import { logger } from '../../../utils/logger.js';

/** winston's LogMethod overloads do not expose call tuples; tests read them through this narrow view. */
const callsOf = (spy: unknown) => (spy as { mock: { calls: unknown[][] } }).mock.calls;

vi.mock('../../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logSafely: vi.fn(),
}));

const KEY = 'k7Qp2Zr9Xw4Lm8Nv3Bt6Hy1Jd5Fs0Gc_AiSvc';
const ENV = 'development';
const P1 = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const P2 = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const P3 = '2d6cc2b3-6a1f-4a8b-8e5f-3c9e2a1b0d22';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;
interface Recorded { method?: string; url?: string; headers: IncomingHttpHeaders; body: string }

function startServer() {
  const state: { handler: Handler; requests: Recorded[] } = { handler: (_q, r) => r.end(), requests: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      state.requests.push({ method: req.method, url: req.url, headers: req.headers, body });
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

function send(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'x-electrohub-ai-environment': ENV, ...headers });
  res.end(text);
}

const okBody = (matches: unknown, extra: Record<string, unknown> = {}) => ({
  data: { matches, modelVersion: 'clip-v1.0', embeddingVersion: 'emb_2026.10', ...extra },
});
const match = (productId: string, score: number, rank: number) => ({ productId, score, rank });
const errorBody = (code: string) => ({ error: { code, message: 'safe', requestId: 'srv' } });

let ai: Awaited<ReturnType<typeof startServer>>;
let decoy: Awaited<ReturnType<typeof startServer>>;

function config(overrides: Partial<AiServiceEnabledConfig> = {}): AiServiceEnabledConfig {
  return {
    status: 'enabled', baseUrl: new URL(ai.origin), apiKey: KEY, environment: ENV, timeoutMs: 1000,
    imageSearchTimeoutMs: 8000, recommendationTimeoutMs: 1000, maxResponseBytes: AI_MAX_RESPONSE_BYTES, ...overrides,
  };
}

function input(overrides: Partial<ImageSearchInput> = {}): ImageSearchInput {
  return { image: JPEG, contentType: 'image/jpeg', topK: 5, requestId: 'req-1', ...overrides };
}

async function failure(promise: Promise<unknown>): Promise<AiServiceError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiServiceError);
    const err = error as AiServiceError;
    expect(err.message).not.toContain(KEY);
    expect(err.message).not.toContain('127.0.0.1');
    expect(err.message).not.toContain('safe');
    return err;
  }
  throw new Error('expected AiServiceError');
}

beforeAll(async () => { ai = await startServer(); decoy = await startServer(); });
beforeEach(() => { vi.mocked(logger.info).mockClear(); vi.mocked(logger.warn).mockClear(); });
afterEach(() => { ai.state.requests = []; decoy.state.requests = []; ai.state.handler = (_q, r) => r.end(); });
afterAll(async () => {
  for (const s of [ai, decoy]) { s.server.closeAllConnections(); await new Promise(r => s.server.close(r)); }
});

describe('AiServiceClient.imageSearch request shape', () => {
  it('posts one generic multipart image part to the private route with topK and forwards no end-user credentials', async () => {
    ai.state.handler = (_req, res) => send(res, 200, okBody([match(P1, 0.91, 1), match(P2, 0.5, 2)]));
    const client = new AiServiceClient(config());
    const result = await client.imageSearch(input({ topK: 5, contentType: 'image/png', image: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x41]) }));

    expect(result).toEqual({ matches: [match(P1, 0.91, 1), match(P2, 0.5, 2)], categoryHints: [], modelVersion: 'clip-v1.0', embeddingVersion: 'emb_2026.10' });
    const [request] = ai.state.requests;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/internal/v1/image-search?topK=5');
    expect(request.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(request.body).toContain('name="image"; filename="query.png"');
    expect(request.body).toContain('Content-Type: image/png');
    expect(request.headers['x-electrohub-ai-key']).toBe(KEY);
    expect(request.headers['x-electrohub-ai-environment']).toBe(ENV);
    expect(request.headers['x-request-id']).toBe('req-1');
    // Never forwarded: browser credentials, the caller's Authorization, or any client-side filename.
    expect(request.headers.cookie).toBeUndefined();
    expect(request.headers.authorization).toBeUndefined();
    expect(request.body).not.toContain('photo.jpg');
  });

  it('keeps the general AI timeout for other operations while imageSearch uses its own budget', async () => {
    ai.state.handler = () => { /* never answers */ };
    const client = new AiServiceClient(config({ timeoutMs: 60_000, imageSearchTimeoutMs: 120 }));
    const started = Date.now();
    const err = await failure(client.imageSearch(input()));
    expect(err.category).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('never follows redirects, so the service credential cannot travel to another origin', async () => {
    ai.state.handler = (_req, res) => { res.writeHead(302, { location: decoy.origin + '/internal/v1/image-search' }); res.end(); };
    const err = await failure(new AiServiceClient(config()).imageSearch(input()));
    expect(err.category).toBe('invalid_response');
    expect(decoy.state.requests).toHaveLength(0);
  });

  it('aborts when the caller disconnects', async () => {
    ai.state.handler = () => { /* never answers */ };
    const controller = new AbortController();
    const pending = new AiServiceClient(config({ imageSearchTimeoutMs: 15_000 })).imageSearch(input({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 50);
    const err = await failure(pending);
    expect(err.category).toBe('aborted');
  });

  it('rejects invalid local input before any network call', async () => {
    const client = new AiServiceClient(config());
    await expect(client.imageSearch(input({ topK: 0 }))).rejects.toBeInstanceOf(AiServiceError);
    await expect(client.imageSearch(input({ topK: 25 }))).rejects.toBeInstanceOf(AiServiceError);
    await expect(client.imageSearch(input({ contentType: 'image/gif' as never }))).rejects.toBeInstanceOf(AiServiceError);
    await expect(client.imageSearch(input({ image: Buffer.alloc(0) }))).rejects.toBeInstanceOf(AiServiceError);
    expect(ai.state.requests).toHaveLength(0);
  });
});

describe('AiServiceClient.imageSearch upstream failures', () => {
  it.each([
    [429, errorBody('AI_RATE_LIMITED'), { 'retry-after': '7' }, 'rate_limited'],
    [413, errorBody('AI_IMAGE_TOO_LARGE'), {}, 'rejected'],
    [415, errorBody('AI_IMAGE_UNSUPPORTED'), {}, 'rejected'],
    [422, errorBody('AI_IMAGE_UNREADABLE'), {}, 'rejected'],
    [503, errorBody('AI_MODEL_NOT_READY'), {}, 'unavailable'],
    [504, errorBody('AI_INFERENCE_TIMEOUT'), {}, 'unavailable'],
    [401, errorBody('AI_UNAUTHORIZED'), {}, 'unauthorized'],
    [403, errorBody('AI_ENVIRONMENT_MISMATCH'), {}, 'environment_mismatch'],
  ])('maps HTTP %i to the %s category with a safe code only', async (status, body, headers, category) => {
    ai.state.handler = (_req, res) => send(res, status, body, headers);
    const err = await failure(new AiServiceClient(config()).imageSearch(input()));
    expect(err.category).toBe(category);
    expect(err.statusCode).toBe(status);
    if (status === 429) expect(err.retryAfterMs).toBe(7000);
  });

  it('treats a non-JSON success, a network drop and an oversized body as controlled failures', async () => {
    ai.state.handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'x-electrohub-ai-environment': ENV }); res.end('<html>'); };
    expect((await failure(new AiServiceClient(config()).imageSearch(input())))).toMatchObject({ category: 'invalid_response' });

    ai.state.handler = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'x-electrohub-ai-environment': ENV, 'content-length': String(AI_MAX_RESPONSE_BYTES + 1) }); res.end('{}'); };
    expect((await failure(new AiServiceClient(config()).imageSearch(input())))).toMatchObject({ category: 'response_too_large' });

    const closed = await startServer();
    await new Promise(r => closed.server.close(r));
    const unreachable = new AiServiceClient(config({ baseUrl: new URL(closed.origin) }));
    expect((await failure(unreachable.imageSearch(input())))).toMatchObject({ category: 'connect' });
  });

  it('rejects a success response that is missing the environment binding', async () => {
    ai.state.handler = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(okBody([]))); };
    expect(await failure(new AiServiceClient(config()).imageSearch(input()))).toMatchObject({ category: 'environment_mismatch' });
  });
});

describe('aiImageSearchResultSchema tightened invariants', () => {
  const schema = aiImageSearchResultSchema(3);
  const wrap = (matches: unknown, extra: Record<string, unknown> = {}) => ({
    data: { matches, modelVersion: 'clip-v1.0', embeddingVersion: 'emb_2026.10', ...extra },
  });

  it('accepts a contiguous, unique, finite, non-increasing ranked list', () => {
    expect(schema.safeParse(wrap([match(P1, 0.9, 1), match(P2, 0.4, 2), match(P3, -0.2, 3)])).success).toBe(true);
    expect(schema.safeParse(wrap([])).success).toBe(true);
  });

  it.each<[string, unknown]>([
    ['NaN score', [match(P1, Number.NaN, 1)]],
    ['infinite score', [match(P1, Number.POSITIVE_INFINITY, 1)]],
    ['score above 1', [match(P1, 1.01, 1)]],
    ['score below -1', [match(P1, -1.01, 1)]],
    ['duplicate product id', [match(P1, 0.9, 1), match(P1.toUpperCase(), 0.5, 2)]],
    ['non-uuid product id', [match('not-a-uuid', 0.9, 1)]],
    ['rank gap', [match(P1, 0.9, 1), match(P2, 0.5, 3)]],
    ['rank starts at zero', [match(P1, 0.9, 0)]],
    ['scores increase by rank', [match(P1, 0.2, 1), match(P2, 0.9, 2)]],
    ['more matches than topK', [match(P1, 0.9, 1), match(P2, 0.8, 2), match(P3, 0.7, 3), match('3e4d5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b', 0.6, 4)]],
    ['extra price field', [{ ...match(P1, 0.9, 1), price: '1.00' }]],
  ])('rejects %s', (_label, matches) => {
    expect(schema.safeParse(wrap(matches)).success).toBe(false);
  });

  it('bounds version strings and rejects unknown envelope fields', () => {
    expect(schema.safeParse(wrap([], { modelVersion: 'bad version with spaces' })).success).toBe(false);
    expect(schema.safeParse(wrap([], { embeddingVersion: 'x'.repeat(65) })).success).toBe(false);
    expect(schema.safeParse({ ...wrap([]), extra: true }).success).toBe(false);
  });
});

describe('aiImageSearchResultSchema category hints (Task 04.2-Q)', () => {
  const schema = aiImageSearchResultSchema(3);
  const wrap = (categoryHints?: unknown) => ({
    data: { matches: [], modelVersion: 'm1', embeddingVersion: 'e1', ...(categoryHints === undefined ? {} : { categoryHints }) },
  });

  it('defaults absent hints to an empty list so older AI services still validate', () => {
    const parsed = schema.parse(wrap());
    expect(parsed.data.categoryHints).toEqual([]);
  });

  it('accepts unique slugs with non-increasing probabilities', () => {
    const parsed = schema.parse(wrap([{ category: 'keyboards-mice', probability: 0.6 }, { category: 'laptops', probability: 0.2 }]));
    expect(parsed.data.categoryHints.map(hint => hint.category)).toEqual(['keyboards-mice', 'laptops']);
  });

  it.each<[string, unknown]>([
    ['duplicate category', [{ category: 'laptops', probability: 0.3 }, { category: 'laptops', probability: 0.2 }]],
    ['increasing probabilities', [{ category: 'laptops', probability: 0.1 }, { category: 'tablets', probability: 0.2 }]],
    ['total above 1', [{ category: 'laptops', probability: 0.7 }, { category: 'tablets', probability: 0.6 }]],
    ['probability above 1', [{ category: 'laptops', probability: 1.5 }]],
    ['non-slug category', [{ category: 'Laptops & more', probability: 0.2 }]],
    ['unknown field', [{ category: 'laptops', probability: 0.2, label: 'x' }]],
    ['too many hints', Array.from({ length: 33 }, (_, i) => ({ category: `c${i}`, probability: 0 }))],
  ])('rejects %s', (_label, hints) => {
    expect(schema.safeParse(wrap(hints)).success).toBe(false);
  });
});

describe('image search telemetry', () => {
  it('records one imageSearch event per call with allowlisted fields only (no bytes, filename or vectors)', async () => {
    ai.state.handler = (_req, res) => send(res, 200, okBody([match(P1, 0.9, 1)]));
    await new AiServiceClient(config()).imageSearch(input());

    const completed = callsOf(logger.info).filter(([event]) => event === 'AI_SERVICE_REQUEST_COMPLETED');
    expect(completed).toHaveLength(1);
    const fields = completed[0][1] as Record<string, unknown>;
    expect(fields.operation).toBe('imageSearch');
    expect(Object.keys(fields).sort()).toEqual(
      ['category', 'code', 'durationMs', 'environment', 'operation', 'outcome', 'requestId', 'statusClass', 'statusCode'].sort()
    );
    const serialized = JSON.stringify(callsOf(logger.info));
    expect(serialized).not.toContain(JPEG.toString('base64'));
    expect(serialized).not.toContain('query.jpg');
    expect(serialized).not.toContain(P1);
  });

  it('records a single failure event with a safe category when the upstream call fails', async () => {
    ai.state.handler = (_req, res) => send(res, 503, errorBody('AI_MODEL_NOT_READY'));
    await failure(new AiServiceClient(config()).imageSearch(input()));
    const failed = callsOf(logger.warn).filter(([event]) => event === 'AI_SERVICE_REQUEST_FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0][1]).toMatchObject({ operation: 'imageSearch', category: 'unavailable', statusCode: 503, code: 'AI_MODEL_NOT_READY' });
  });
});
