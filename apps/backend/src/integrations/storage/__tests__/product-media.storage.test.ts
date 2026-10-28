import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ProductMediaStorage,
  ProductMediaStorageError,
  resolveProductMediaStorageConfig,
  type ImmutableProductMediaInput,
  type ProductMediaStorageConfig,
} from '../product-media.storage.js';

const config: ProductMediaStorageConfig = {
  supabaseUrl: new URL('https://testproject.supabase.co'),
  serviceRoleKey: 'unit-test-only-key-with-no-real-privileges-000000000000',
  projectRef: 'testproject',
  bucket: 'product-media',
  timeoutMs: 500,
};
const bytes = Buffer.from('normalized-webp-bytes');
const makeInput = (overrides: Partial<ImmutableProductMediaInput> = {}): ImmutableProductMediaInput => ({
  productId: '8f2813b4-a388-44d3-b51e-5d4c40386677',
  imageId: '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11',
  revision: '2d6cc2b3-6a1f-4a8b-8e5f-3c9e2a1b0d22',
  bytes,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  ...overrides,
});

describe('resolveProductMediaStorageConfig', () => {
  it('accepts an operator latency budget only within the bounded request policy', () => {
    const source = { NODE_ENV: 'test', SUPABASE_URL: 'https://testproject.supabase.co',
      SUPABASE_PROJECT_REF: 'testproject', SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey };
    expect(resolveProductMediaStorageConfig({ ...source, PRODUCT_MEDIA_STORAGE_TIMEOUT_MS: '30000' })?.timeoutMs).toBe(30000);
    for (const timeout of ['NaN', '0', '30001']) {
      expect(() => resolveProductMediaStorageConfig({ ...source, PRODUCT_MEDIA_STORAGE_TIMEOUT_MS: timeout }))
        .toThrowError(ProductMediaStorageError);
    }
  });

  it('keeps Storage optional until configured, then requires complete project identity', () => {
    expect(resolveProductMediaStorageConfig({})).toBeNull();
    expect(() => resolveProductMediaStorageConfig({ SUPABASE_URL: 'https://testproject.supabase.co' })).toThrowError(ProductMediaStorageError);
  });

  it('rejects mismatched project host, insecure remote URL, and invalid bucket', () => {
    expect(() => resolveProductMediaStorageConfig({
      SUPABASE_URL: 'https://otherproject.supabase.co',
      SUPABASE_PROJECT_REF: 'testproject',
      SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
    })).toThrowError(/validation/i);
    expect(() => resolveProductMediaStorageConfig({
      SUPABASE_URL: 'http://testproject.supabase.co',
      SUPABASE_PROJECT_REF: 'testproject',
      SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
    })).toThrowError(ProductMediaStorageError);
    expect(() => resolveProductMediaStorageConfig({
      SUPABASE_URL: 'https://testproject.supabase.co',
      SUPABASE_PROJECT_REF: 'testproject',
      SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
      PRODUCT_MEDIA_BUCKET: '../private',
    })).toThrowError(ProductMediaStorageError);
  });

  it('prefers modern secret keys and does not treat them as JWT bearer credentials', async () => {
    const modernKey = `sb_secret_${'x'.repeat(38)}`;
    const resolved = resolveProductMediaStorageConfig({
      SUPABASE_URL: 'https://testproject.supabase.co',
      SUPABASE_PROJECT_REF: 'testproject',
      SUPABASE_SECRET_KEY: modernKey,
      SUPABASE_SERVICE_ROLE_KEY: `legacy-${'x'.repeat(40)}`,
    });
    expect(resolved?.secretKey).toBe(modernKey);
    let calls = 0;
    const requestMock = vi.fn(async (_input: Request | string | URL, _init?: RequestInit) => ++calls === 1 ? new Response(null, { status: 200 }) : new Response(bytes, { status: 200 }));
    const request = requestMock as unknown as typeof fetch;
    await new ProductMediaStorage(resolved!, request).uploadImmutable(makeInput());
    const firstRequest = requestMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(firstRequest.headers);
    expect(headers.get('apikey')).toBe(modernKey);
    expect(headers.has('authorization')).toBe(false);
  });
});

describe('ProductMediaStorage', () => {
  it('uploads once without upsert, verifies exact bytes, and returns an immutable public URL', async () => {
    const calls: Request[] = [];
    const request = vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
      calls.push(new Request(input, init));
      return calls.length === 1 ? new Response(null, { status: 200 }) : new Response(bytes, { status: 200 });
    }) as unknown as typeof fetch;
    const storage = new ProductMediaStorage(config, request);
    const stored = await storage.uploadImmutable(makeInput());

    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers.get('x-upsert')).toBe('false');
    expect(calls[0].headers.get('content-type')).toBe('image/webp');
    expect(calls[0].headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await calls[0].arrayBuffer())).toEqual(bytes);
    expect(calls[1].method).toBe('GET');
    expect(stored).toEqual({
      bucket: 'product-media',
      path: 'products/8f2813b4-a388-44d3-b51e-5d4c40386677/1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11/2d6cc2b3-6a1f-4a8b-8e5f-3c9e2a1b0d22/original.webp',
      url: 'https://testproject.supabase.co/storage/v1/object/public/product-media/products/8f2813b4-a388-44d3-b51e-5d4c40386677/1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11/2d6cc2b3-6a1f-4a8b-8e5f-3c9e2a1b0d22/original.webp',
    });
  });

  it('rejects invalid keys and digest before contacting Storage', async () => {
    const request = vi.fn() as unknown as typeof fetch;
    const storage = new ProductMediaStorage(config, request);
    await expect(storage.uploadImmutable(makeInput({ productId: '../other' }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(storage.uploadImmutable(makeInput({ sha256: '0'.repeat(64) }))).rejects.toMatchObject({ code: 'INTEGRITY' });
    expect(request).not.toHaveBeenCalled();
  });

  it('does not report success when verification bytes differ', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response('different', { status: 200 })) as unknown as typeof fetch;
    await expect(new ProductMediaStorage(config, request).uploadImmutable(makeInput()))
      .rejects.toMatchObject({ code: 'INTEGRITY' });
  });

  it('maps provider conflicts safely and never retries as an overwrite', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 409 })) as unknown as typeof fetch;
    await expect(new ProductMediaStorage(config, request).uploadImmutable(makeInput()))
      .rejects.toMatchObject({ code: 'UPSTREAM', statusCode: 503 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('allows deletion only for a product media key through explicit remove', async () => {
    const requestMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const request = requestMock as unknown as typeof fetch;
    const storage = new ProductMediaStorage(config, request);
    await expect(storage.remove('../untrusted')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(request).not.toHaveBeenCalled();
    await storage.remove('products/8f2813b4-a388-44d3-b51e-5d4c40386677/1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11/2d6cc2b3-6a1f-4a8b-8e5f-3c9e2a1b0d22/original.webp');
    const call = requestMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(call[1].method).toBe('DELETE');
    expect(call[1].body).toContain('original.webp');
  });
});
