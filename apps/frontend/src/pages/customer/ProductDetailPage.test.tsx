import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductDetailPage } from './ProductDetailPage';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useProduct, useMyReview, useReviewMutation, useReviews } from '@/features/products/queries';
import { useSearchResults } from '@/features/search/queries';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/products/queries', () => ({ useProduct: vi.fn(), useMyReview: vi.fn(), useReviewMutation: vi.fn(), useReviews: vi.fn() }));
vi.mock('@/features/search/queries', () => ({ useSearchResults: vi.fn() }));

const product = {
  id: 'p-1', name: 'Test Tablet', slug: 'test-tablet', sku: 'TEST-1', modelNumber: null,
  category: { id: 'c-1', name: 'Tablets', slug: 'tablets' }, brand: null,
  images: [{ id: 'image-1', url: '/images/catalog/tablets.jpg', altText: 'Tablet', sortOrder: 0, isPrimary: true }],
  specifications: [], price: '100.00', compareAtPrice: null, discountPercent: null,
  averageRating: null, reviewCount: 0, availability: 'AVAILABLE', description: 'A tablet', currency: 'USD',
};

const testQueryClient = new QueryClient();
const renderPage = () => render(<QueryClientProvider client={testQueryClient}><MemoryRouter initialEntries={['/products/test-tablet']}><Routes><Route path="/products/:slug" element={<ProductDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);

describe('Product details loading and review auth state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ isInitializing: true, isAuthenticated: false } as ReturnType<typeof useAuth>);
    vi.mocked(useProduct).mockReturnValue({ data: { data: product }, isPending: false, isError: false } as unknown as ReturnType<typeof useProduct>);
    vi.mocked(useReviews).mockReturnValue({ data: { data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } }, isPending: false, isError: false } as unknown as ReturnType<typeof useReviews>);
    vi.mocked(useMyReview).mockReturnValue({ isPending: true } as ReturnType<typeof useMyReview>);
    vi.mocked(useReviewMutation).mockReturnValue({ isPending: false, mutateAsync: vi.fn() } as unknown as ReturnType<typeof useReviewMutation>);
    vi.mocked(useSearchResults).mockReturnValue({ data: { data: [], meta: { page: 1, pageSize: 5, total: 0, totalPages: 0 } }, isPending: false, isError: false } as unknown as ReturnType<typeof useSearchResults>);
  });

  it('renders a structural detail skeleton instead of plain text', () => {
    vi.mocked(useProduct).mockReturnValue({ isPending: true } as ReturnType<typeof useProduct>);
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading product details' })).toBeInTheDocument();
    expect(screen.queryByText('Loading product details…')).not.toBeInTheDocument();
  });

  it('holds guest review UI until authentication resolves', async () => {
    const view = renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Reviews (0)' }));
    expect(screen.getByRole('status', { name: 'Checking review access' })).toBeInTheDocument();
    expect(screen.queryByText('Sign in to write a review of this product.')).not.toBeInTheDocument();

    vi.mocked(useAuth).mockReturnValue({ isInitializing: false, isAuthenticated: false } as ReturnType<typeof useAuth>);
    view.rerender(<QueryClientProvider client={testQueryClient}><MemoryRouter initialEntries={['/products/test-tablet']}><Routes><Route path="/products/:slug" element={<ProductDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(screen.getByText('Sign in to write a review of this product.')).toBeInTheDocument();
  });
});
