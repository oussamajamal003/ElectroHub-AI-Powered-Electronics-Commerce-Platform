import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../../utils/logger.js', () => ({ logger: log }));

import { AiServiceClient, getAiServiceRuntime, resetAiServiceRuntimeForTests } from '../ai.client.js';
import type { AiServiceEnabledConfig } from '../ai.config.js';
import { getAiServiceMetrics, resetAiServiceMetricsForTests } from '../ai.telemetry.js';

const KEY = 'Tele-metry-K3y_0123456789abcdefghijklmnop';
const config: AiServiceEnabledConfig = {
  status: 'enabled',
  baseUrl: new URL('http://127.0.0.1:9'),
  apiKey: KEY,
  environment: 'test',
  timeoutMs: 1000,
  maxResponseBytes: 256 * 1024,
};

const feature = { available: false, status: 'NOT_READY', reason: 'MODEL_NOT_CONFIGURED', modelVersion: null, embeddingVersion: null };
const ready = {
  data: {
    status: 'ready', service: 'electrohub-ai-service', environment: 'test', apiVersion: 'v1', modelReady: false,
    features: { imageSearch: feature, recommendations: feature },
  },
};

function respond(status: number, body: unknown, environment = 'test') {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-electrohub-ai-environment': environment },
  }));
}

function everyLoggedValue() {
  return JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls]);
}

describe('AI upstream telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiServiceMetricsForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetAiServiceRuntimeForTests();
  });

  it('records one sanitized success event with operation, duration, status class and request id', async () => {
    const client = new AiServiceClient(config, respond(200, ready));
    await client.getReadiness({ requestId: 'req-123' });

    expect(log.info).toHaveBeenCalledTimes(1);
    const [event, fields] = log.info.mock.calls[0];
    expect(event).toBe('AI_SERVICE_REQUEST_COMPLETED');
    expect(fields).toMatchObject({
      operation: 'ai.get /internal/v1/ready', environment: 'test', outcome: 'success', statusClass: '2xx', statusCode: 200, requestId: 'req-123',
    });
    expect(typeof fields.durationMs).toBe('number');
    expect(Object.keys(fields).sort()).toEqual(
      ['category', 'code', 'durationMs', 'environment', 'operation', 'outcome', 'requestId', 'statusClass', 'statusCode'].sort()
    );
    expect(getAiServiceMetrics()['ai.get /internal/v1/ready']).toMatchObject({ success: 1, failure: 0 });
  });

  it('records a failure event for an unavailable upstream and counts it by category', async () => {
    const client = new AiServiceClient(config, respond(503, { error: { code: 'AI_MODEL_NOT_READY', message: 'x', requestId: 'r' } }));
    await expect(client.recommend({ mode: 'POPULAR_PRODUCTS' })).rejects.toMatchObject({ category: 'unavailable' });

    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith('AI_SERVICE_REQUEST_FAILED', expect.objectContaining({
      operation: 'ai.post /internal/v1/recommendations', outcome: 'failure', statusClass: '5xx', category: 'unavailable', code: 'AI_MODEL_NOT_READY',
    }));
    expect(getAiServiceMetrics()['ai.post /internal/v1/recommendations']).toMatchObject({
      success: 0, failure: 1, failuresByCategory: { unavailable: 1 },
    });
  });

  it('drops unsafe or oversized request ids', async () => {
    const client = new AiServiceClient(config, respond(200, ready));
    await client.getReadiness({ requestId: 'x'.repeat(101) });
    await client.getReadiness({ requestId: 'bad id;<script>' });
    for (const [, fields] of log.info.mock.calls) expect(fields.requestId).toBeUndefined();
  });

  it('never logs the service key, URL, customer tokens or response bodies', async () => {
    const ok = new AiServiceClient(config, respond(200, ready));
    await ok.getReadiness({ requestId: 'r1' });
    const bad = new AiServiceClient(config, respond(401, { error: { code: 'AI_UNAUTHORIZED', message: 'secret detail', requestId: 'r' } }));
    await expect(bad.getCapabilities()).rejects.toBeTruthy();

    const logged = everyLoggedValue();
    for (const forbidden of [KEY, '127.0.0.1', 'Bearer', 'secret detail', 'MODEL_NOT_CONFIGURED']) expect(logged).not.toContain(forbidden);
  });

  it('a telemetry failure cannot fail a successful AI call', async () => {
    log.info.mockImplementation(() => { throw new Error('log transport down'); });
    const client = new AiServiceClient(config, respond(200, ready));
    await expect(client.getReadiness()).resolves.toMatchObject({ status: 'ready' });
  });

  it('does not duplicate configuration warnings across repeated runtime access', () => {
    const saved = { url: process.env.AI_SERVICE_URL, key: process.env.AI_SERVICE_API_KEY };
    process.env.AI_SERVICE_URL = 'http://127.0.0.1:8000';
    delete process.env.AI_SERVICE_API_KEY;
    try {
      resetAiServiceRuntimeForTests();
      for (let i = 0; i < 5; i += 1) getAiServiceRuntime();
      expect(log.warn.mock.calls.filter(([event]) => event === 'AI_SERVICE_MISCONFIGURED')).toHaveLength(1);
    } finally {
      if (saved.url === undefined) delete process.env.AI_SERVICE_URL; else process.env.AI_SERVICE_URL = saved.url;
      if (saved.key === undefined) delete process.env.AI_SERVICE_API_KEY; else process.env.AI_SERVICE_API_KEY = saved.key;
    }
  });
});
