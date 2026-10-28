import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { mediaConcurrencyTag } from './types';
import { newIdempotencyKey } from './types';
import { useAdminMediaProducts, useAdminProductImages, useMediaMutations } from './queries';

vi.mock('@/lib/api', () => ({ apiClient: vi.fn() }));

describe('admin media mutations', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([null, '', '   '])('preserves the saved editable alt text when it is %s', async altText => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['admin', 'media', 'product', 'product-1'], { data: { id: 'product-1', name: 'Test Tablet', slug: 'test-tablet' } });
    vi.mocked(apiClient).mockResolvedValue({ data: [{ id: 'image-1', productId: 'product-1', url: '/photo.webp', altText,
      sortOrder: 0, isPrimary: true, sourceRevision: null, mediaState: 'PUBLISHED', width: null, height: null,
      updatedAt: '2026-10-28T12:00:00.000Z', indexing: { state: 'LEGACY', embeddingVersion: null, errorCode: null } }] } as never);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useAdminProductImages('product-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data[0]?.altText).toBe(altText);
    client.clear();
  });

  it('uploads one file with a UUID idempotency key and multipart form data', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    vi.mocked(apiClient).mockResolvedValue({ data: { id: 'image-1' } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useMediaMutations('product-1'), { wrapper });
    const file = new File(['photo'], 'phone.webp', { type: 'image/webp' });

    const idempotencyKey = newIdempotencyKey();
    await act(async () => { await result.current.upload.mutateAsync({ file, altText: 'Phone front', idempotencyKey }); });

    const [, options] = vi.mocked(apiClient).mock.calls[0]!;
    const headers = new Headers(options?.headers);
    expect(vi.mocked(apiClient).mock.calls[0]?.[0]).toBe('/api/admin/products/product-1/images');
    expect(headers.get('Idempotency-Key')).toBe(idempotencyKey);
    expect(options?.data).toBeInstanceOf(FormData);
    expect((options?.data as FormData).get('file')).toBe(file);
    expect((options?.data as FormData).get('altText')).toBe('Phone front');
    client.clear();
  });

  it('replaces with PUT and keeps the staged intent key on retry', async () => {
    vi.clearAllMocks();
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    vi.mocked(apiClient).mockResolvedValue({ data: { id: 'image-1' } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useMediaMutations('product-1'), { wrapper });
    const image = { id: 'image-1', productId: 'product-1', url: '/photo.webp', altText: 'Phone', sortOrder: 0,
      isPrimary: true, sourceRevision: 'revision-2', mediaState: 'PUBLISHED' as const, width: null, height: null, updatedAt: '2026-10-28T12:00:00.000Z',
      indexing: { state: 'INDEXED' as const, embeddingVersion: 'd3', errorCode: null } };
    const input = { image, file: new File(['replacement'], 'new.webp', { type: 'image/webp' }), altText: 'Phone', idempotencyKey: newIdempotencyKey() };

    await act(async () => { await result.current.replace.mutateAsync(input); await result.current.replace.mutateAsync(input); await result.current.remove.mutateAsync(image); });

    const calls = vi.mocked(apiClient).mock.calls;
    expect(calls).toHaveLength(3);
    for (const [url, options] of calls.slice(0, 2)) {
      expect(url).toBe('/api/admin/products/product-1/images/image-1/file');
      expect(options?.method).toBe('PUT');
      expect(new Headers(options?.headers).get('If-Match')).toBe(image.updatedAt);
      expect(new Headers(options?.headers).get('Idempotency-Key')).toBe(input.idempotencyKey);
    }
    expect(calls[2]?.[0]).toBe('/api/admin/products/product-1/images/image-1');
    expect(calls[2]?.[1]?.method).toBe('DELETE');
    expect(new Headers(calls[2]?.[1]?.headers).get('If-Match')).toBe(image.updatedAt);
    client.clear();
  });

  it('uses updatedAt for metadata changes even when an image has a source revision', async () => {
    vi.clearAllMocks();
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.mocked(apiClient).mockResolvedValue({ data: { id: 'image-1' } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useMediaMutations('product-1'), { wrapper });
    const image = { id: 'image-1', productId: 'product-1', url: '/photo.webp', altText: null, sortOrder: 0,
      isPrimary: false, sourceRevision: 'revision-4', mediaState: 'PUBLISHED' as const, width: null, height: null, updatedAt: '2026-10-28T12:00:00.000Z',
      indexing: { state: 'LEGACY' as const, embeddingVersion: null, errorCode: null } };

    await act(async () => { await result.current.patch.mutateAsync({ image, changes: { isPrimary: true } }); });

    const [, options] = vi.mocked(apiClient).mock.calls[0]!;
    expect(new Headers(options?.headers).get('If-Match')).toBe(image.updatedAt);
    expect(options?.data).toEqual({ isPrimary: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'media', 'images', 'product-1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.products.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.search.all });
    expect(mediaConcurrencyTag({ ...image, sourceRevision: 'rev-2' })).toBe(image.updatedAt);
    client.clear();
  });
});

describe('admin media product discovery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requests the server-filtered page and keeps the compatible data array plus total metadata', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const product = { id: 'product-31', name: 'Acer Cestus 330', slug: 'acer-cestus-330' };
    vi.mocked(apiClient).mockResolvedValue({ data: [product], meta: { page: 2, pageSize: 30, total: 31, totalPages: 2 } } as never);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useAdminMediaProducts(' EH-031 ', 2, 30), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(vi.mocked(apiClient).mock.calls[0]?.[0]).toBe('/api/admin/products?q=EH-031&page=2&pageSize=30');
    expect(result.current.data?.data).toEqual([product]);
    expect(result.current.data?.meta).toEqual({ page: 2, pageSize: 30, total: 31, totalPages: 2 });
    client.clear();
  });
});
