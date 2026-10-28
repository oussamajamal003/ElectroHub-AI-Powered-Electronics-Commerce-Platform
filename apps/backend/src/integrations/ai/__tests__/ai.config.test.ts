import { describe, expect, it } from 'vitest';
import { AI_DEFAULT_IMAGE_SEARCH_TIMEOUT_MS, AI_DEFAULT_TIMEOUT_MS, AI_MAX_IMAGE_SEARCH_TIMEOUT_MS, AI_MAX_RESPONSE_BYTES, resolveAiServiceConfig } from '../ai.config.js';

const KEY = 'k7Qp2Zr9Xw4Lm8Nv3Bt6Hy1Jd5Fs0Gc_AiSvc';
const base = { AI_SERVICE_URL: 'http://127.0.0.1:8000', AI_SERVICE_API_KEY: KEY, AI_SERVICE_ENVIRONMENT: 'development' };

function disabled(result: ReturnType<typeof resolveAiServiceConfig>) {
  if (result.status !== 'disabled') throw new Error('expected disabled');
  return result;
}

describe('resolveAiServiceConfig', () => {
  it('is NOT_CONFIGURED when the URL is unset or blank', () => {
    expect(resolveAiServiceConfig({}, 'development')).toEqual({ status: 'disabled', reason: 'NOT_CONFIGURED', issues: [] });
    expect(resolveAiServiceConfig({ AI_SERVICE_URL: '   ', AI_SERVICE_API_KEY: KEY }, 'production').status).toBe('disabled');
  });

  it('enables a valid development configuration with bounded defaults', () => {
    const result = resolveAiServiceConfig(base, 'development');
    expect(result).toMatchObject({ status: 'enabled', apiKey: KEY, environment: 'development', timeoutMs: AI_DEFAULT_TIMEOUT_MS, maxResponseBytes: AI_MAX_RESPONSE_BYTES });
    if (result.status === 'enabled') expect(result.baseUrl.href).toBe('http://127.0.0.1:8000/');
    expect(resolveAiServiceConfig({ ...base, AI_SERVICE_ENVIRONMENT: 'qa', AI_SERVICE_TIMEOUT_MS: '100' }, 'development'))
      .toMatchObject({ status: 'enabled', environment: 'qa', timeoutMs: 100 });
    expect(resolveAiServiceConfig({ ...base, AI_SERVICE_TIMEOUT_MS: '10000', AI_SERVICE_URL: 'http://localhost:8000/' }, 'development'))
      .toMatchObject({ status: 'enabled', timeoutMs: 10000 });
  });

  it.each([
    ['ftp://127.0.0.1:8000'],
    ['http://user:pass@127.0.0.1:8000'],
    ['http://127.0.0.1:8000/?a=1'],
    ['http://127.0.0.1:8000/#frag'],
    ['http://127.0.0.1:8000/internal'],
    ['not a url'],
    ['javascript:alert(1)'],
  ])('rejects unsafe URL %s by name only', (url) => {
    const result = disabled(resolveAiServiceConfig({ ...base, AI_SERVICE_URL: url }, 'development'));
    expect(result.reason).toBe('MISCONFIGURED');
    expect(result.issues).toEqual(['AI_SERVICE_URL']);
    expect(JSON.stringify(result)).not.toContain(url);
  });

  it.each([
    [undefined],
    ['short-key'],
    [`  ${KEY}`],
    ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['your-ai-service-api-key-here-0123456789abcdef'],
    ['replace-with-a-long-random-value-0123456789'],
    ['change_me_change_me_change_me_0123456789'],
    ['Placeholder0123456789abcdefghijklmnopqrstu'],
    [`${KEY} with space`],
  ])('rejects weak or placeholder key %#', (key) => {
    const result = disabled(resolveAiServiceConfig({ ...base, AI_SERVICE_API_KEY: key }, 'development'));
    expect(result.issues).toEqual(['AI_SERVICE_API_KEY']);
    if (key) expect(JSON.stringify(result)).not.toContain(key.trim());
  });

  it.each([['99'], ['10001'], ['abc'], ['1.5'], ['-1']])('rejects out-of-range timeout %s', (timeout) => {
    expect(disabled(resolveAiServiceConfig({ ...base, AI_SERVICE_TIMEOUT_MS: timeout }, 'development')).issues).toEqual(['AI_SERVICE_TIMEOUT_MS']);
  });

  it('binds the AI environment to NODE_ENV', () => {
    expect(disabled(resolveAiServiceConfig({ ...base, AI_SERVICE_ENVIRONMENT: 'production' }, 'development')).issues).toEqual(['AI_SERVICE_ENVIRONMENT']);
    expect(disabled(resolveAiServiceConfig({ ...base, AI_SERVICE_ENVIRONMENT: 'staging' }, 'test')).issues).toEqual(['AI_SERVICE_ENVIRONMENT']);
    expect(resolveAiServiceConfig({ ...base, AI_SERVICE_ENVIRONMENT: 'production' }, 'test')).toMatchObject({ status: 'enabled' });
    expect(resolveAiServiceConfig({ ...base, AI_SERVICE_ENVIRONMENT: undefined }, 'test')).toMatchObject({ status: 'enabled', environment: 'test' });
    expect(resolveAiServiceConfig({ ...base, AI_SERVICE_ENVIRONMENT: undefined }, 'development')).toMatchObject({ status: 'enabled', environment: 'development' });
  });

  it('requires explicit production binding and TLS for non-internal production hosts', () => {
    const prod = { ...base, AI_SERVICE_ENVIRONMENT: 'production', AI_SERVICE_URL: 'https://ai.electrohub.example' };
    expect(resolveAiServiceConfig(prod, 'production')).toMatchObject({ status: 'enabled', environment: 'production' });
    expect(disabled(resolveAiServiceConfig({ ...prod, AI_SERVICE_ENVIRONMENT: undefined }, 'production')).issues).toEqual(['AI_SERVICE_ENVIRONMENT']);
    expect(disabled(resolveAiServiceConfig({ ...prod, AI_SERVICE_ENVIRONMENT: 'development' }, 'production')).issues).toEqual(['AI_SERVICE_ENVIRONMENT']);
    expect(disabled(resolveAiServiceConfig({ ...prod, AI_SERVICE_URL: 'http://ai.electrohub.example' }, 'production')).issues).toEqual(['AI_SERVICE_URL']);
    expect(disabled(resolveAiServiceConfig({ ...prod, AI_SERVICE_URL: 'http://10.0.0.5:8000' }, 'production')).issues).toEqual(['AI_SERVICE_URL']);
    expect(resolveAiServiceConfig({ ...prod, AI_SERVICE_URL: 'http://ai-service:8000' }, 'production')).toMatchObject({ status: 'enabled' });
    expect(resolveAiServiceConfig({ ...prod, AI_SERVICE_URL: 'http://127.0.0.1:8000' }, 'production')).toMatchObject({ status: 'enabled' });
    expect(resolveAiServiceConfig({ ...prod, AI_SERVICE_URL: 'http://[::1]:8000' }, 'production')).toMatchObject({ status: 'enabled' });
  });

  it('reports every issue at once and never throws on hostile input', () => {
    const result = disabled(resolveAiServiceConfig({ AI_SERVICE_URL: 'http://x y', AI_SERVICE_API_KEY: '', AI_SERVICE_ENVIRONMENT: 'prod', AI_SERVICE_TIMEOUT_MS: '0' }, 'production'));
    expect(result.issues).toEqual(['AI_SERVICE_URL', 'AI_SERVICE_API_KEY', 'AI_SERVICE_ENVIRONMENT', 'AI_SERVICE_TIMEOUT_MS']);
    const hostile = new Proxy({}, { get() { throw new Error('boom'); } }) as NodeJS.ProcessEnv;
    expect(() => resolveAiServiceConfig(hostile, 'development')).not.toThrow();
    expect(resolveAiServiceConfig(hostile, 'development')).toEqual({ status: 'disabled', reason: 'MISCONFIGURED', issues: [] });
  });
});

describe('image search timeout (Task 04.2)', () => {
  const base = { AI_SERVICE_URL: 'http://localhost:8000', AI_SERVICE_API_KEY: KEY, AI_SERVICE_ENVIRONMENT: 'development' };
  it('uses a bounded 15000 ms default and accepts the configured maximum', () => {
    expect(AI_DEFAULT_IMAGE_SEARCH_TIMEOUT_MS).toBe(15_000);
    expect(resolveAiServiceConfig(base, 'development')).toMatchObject({ status: 'enabled', imageSearchTimeoutMs: AI_DEFAULT_IMAGE_SEARCH_TIMEOUT_MS });
    expect(resolveAiServiceConfig({ ...base, AI_IMAGE_SEARCH_TIMEOUT_MS: String(AI_MAX_IMAGE_SEARCH_TIMEOUT_MS) }, 'development'))
      .toMatchObject({ status: 'enabled', imageSearchTimeoutMs: AI_MAX_IMAGE_SEARCH_TIMEOUT_MS });
  });
  it.each([['14999999'], ['15001'], ['99'], ['abc']])('rejects out-of-range or malformed value %s as a misconfiguration', (value) => {
    const result = resolveAiServiceConfig({ ...base, AI_IMAGE_SEARCH_TIMEOUT_MS: value }, 'development');
    expect(result).toMatchObject({ status: 'disabled', reason: 'MISCONFIGURED', issues: ['AI_IMAGE_SEARCH_TIMEOUT_MS'] });
  });
});
