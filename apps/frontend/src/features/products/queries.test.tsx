import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { useReviewMutation } from './queries';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/query';

vi.mock('@/lib/api', () => ({ apiClient: vi.fn() }));

describe('Review mutation cache scope', () => {
  it('updates detail and review caches without refetching Product Details payloads', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    client.setQueryData(queryKeys.products.detail('tablet'), { data: { id: 'product-1', slug: 'tablet', averageRating: null, reviewCount: 0, images: [{ id: 'image-1' }], specifications: [] } });
    client.setQueryData(queryKeys.products.myReview('tablet'), { data: null });
    client.setQueryData(queryKeys.products.reviews('tablet', 1), { data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
    vi.mocked(apiClient).mockResolvedValue({ data: { id: 'review-1', rating: 5, body: 'Good' }, summary: { averageRating: '5.0', reviewCount: 1 } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useReviewMutation('tablet'), { wrapper });

    await act(async () => { await result.current.mutateAsync({ method: 'POST', rating: 5, body: 'Good' }); });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products', 'reviews', 'tablet'], refetchType: 'none' });
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.products.detail('tablet') }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products', 'list'], refetchType: 'none' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products', 'deals'], refetchType: 'none' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['search', 'products'], refetchType: 'none' });
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.search.all }));
    expect(client.getQueryData(queryKeys.products.detail('tablet'))).toMatchObject({ data: { averageRating: '5.0', reviewCount: 1, images: [{ id: 'image-1' }] } });
    expect(client.getQueryData(queryKeys.products.myReview('tablet'))).toMatchObject({ data: { id: 'review-1' } });
    expect(client.getQueryData(queryKeys.products.reviews('tablet', 1))).toMatchObject({ data: [{ id: 'review-1' }], meta: { total: 1 } });
    expect(apiClient).toHaveBeenCalledWith('/api/products/tablet/reviews', expect.objectContaining({ method: 'POST' }));
    client.clear();
  });
});
