import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductDetailPage } from './ProductDetailPage';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useCart } from '@/features/cart/context';
import { useProduct, useMyReview, useReviewMutation, useReviews } from '@/features/products/queries';
import { useSearchResults } from '@/features/search/queries';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/cart/context', () => ({ useCart: vi.fn() }));
vi.mock('@/features/products/queries', () => ({ useProduct: vi.fn(), useMyReview: vi.fn(), useReviewMutation: vi.fn(), useReviews: vi.fn() }));
vi.mock('@/features/search/queries', () => ({ useSearchResults: vi.fn() }));

const product = {
  id: 'p-1', name: 'Test Tablet', slug: 'test-tablet', sku: 'TEST-1', modelNumber: null,
  category: { id: 'c-1', name: 'Tablets', slug: 'tablets' }, brand: null,
  images: [{ id: 'image-1', url: '/images/catalog/tablets.jpg', altText: 'Tablet', sortOrder: 0, isPrimary: true }],
  specifications: [], price: '100.00', compareAtPrice: null, discountPercent: null,
  averageRating: null, reviewCount: 0, availability: 'AVAILABLE', availableQuantity: 13, description: 'A tablet', currency: 'USD',
};

const testQueryClient = new QueryClient();
const renderPage = () => render(<QueryClientProvider client={testQueryClient}><MemoryRouter initialEntries={['/products/test-tablet']}><Routes><Route path="/products/:slug" element={<ProductDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);

describe('Product details loading and review auth state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCart).mockReturnValue({ addItem: vi.fn() } as unknown as ReturnType<typeof useCart>);
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

  it('limits additions to remaining stock and resets a now-invalid selection', async () => {
    const view = renderPage();
    expect(screen.getByText('13 more items available to add.')).toBeInTheDocument();
    const increase = screen.getByRole('button', { name: 'Increase quantity for Test Tablet' });
    for (let index = 0; index < 6; index++) await userEvent.click(increase);
    expect(screen.getByText('7', { selector: '[aria-live="polite"]' })).toBeInTheDocument();

    vi.mocked(useCart).mockReturnValue({ addItem: vi.fn(), data: { items: [{ productId: 'p-1', quantity: 8 }] } } as unknown as ReturnType<typeof useCart>);
    view.rerender(<QueryClientProvider client={testQueryClient}><MemoryRouter initialEntries={['/products/test-tablet']}><Routes><Route path="/products/:slug" element={<ProductDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(screen.getByText('1', { selector: '[aria-live="polite"]' })).toBeInTheDocument();
    expect(screen.getByText('5 more items available to add.')).toBeInTheDocument();
  });

  it('disables Add when the current Cart already contains all available stock', () => {
    vi.mocked(useCart).mockReturnValue({ addItem: vi.fn(), data: { items: [{ productId: 'p-1', quantity: 13 }] } } as unknown as ReturnType<typeof useCart>);
    renderPage();
    expect(screen.getByText('You already have the available stock in your cart.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeDisabled();
  });
  it('keeps usable product content and controls after a background availability failure', () => {
    vi.mocked(useProduct).mockReturnValue({ data: { data: { ...product, stockStatus: 'IN_STOCK' } }, isPending: false, isError: true } as unknown as ReturnType<typeof useProduct>);
    renderPage();
    expect(screen.getByRole('heading', { name: 'Test Tablet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry availability' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading product details' })).not.toBeInTheDocument();
  });
  it.each([['IN_STOCK', 8, 'In Stock'], ['LOW_STOCK', 2, 'Low Stock'], ['OUT_OF_STOCK', 0, 'Out of Stock']] as const)('renders %s with authoritative quantity controls', (stockStatus, availableQuantity, label) => {
    vi.mocked(useProduct).mockReturnValue({ data: { data: { ...product, stockStatus, availableQuantity, purchasable: availableQuantity > 0, availability: availableQuantity > 0 ? 'AVAILABLE' : 'UNAVAILABLE' } }, isPending: false, isError: false } as unknown as ReturnType<typeof useProduct>);
    renderPage();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Cart' }).hasAttribute('disabled')).toBe(availableQuantity === 0);
    expect(screen.getByRole('button', { name: 'Increase quantity for Test Tablet' }).hasAttribute('disabled')).toBe(availableQuantity === 0);
    if (stockStatus === 'LOW_STOCK') expect(screen.getByText('Only 2 left')).toBeInTheDocument();
  });
  it.each([undefined, null])('treats missing inventory status as unavailable rather than Out of Stock (%s)', stockStatus => {
    vi.mocked(useProduct).mockReturnValue({ data: { data: { ...product, stockStatus, availableQuantity: 0, purchasable: false, availability: 'UNAVAILABLE' } }, isPending: false, isError: false } as unknown as ReturnType<typeof useProduct>);
    renderPage();
    expect(screen.getByText('Unavailable', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('Out of Stock', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase quantity for Test Tablet' })).toBeDisabled();
  });
});
