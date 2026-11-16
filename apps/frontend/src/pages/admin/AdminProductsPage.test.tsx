import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminProductsPage } from './AdminProductsPage';

const mocks = vi.hoisted(() => ({ products: vi.fn(), refetch: vi.fn() }));
vi.mock('@/features/adminMedia/queries', () => ({ useAdminMediaProducts: mocks.products }));

const productsFor = (query: string, page: number) => {
  if (query) return [{ id: 'product-31', name: 'Acer Predator Cestus 330', slug: 'acer-predator-cestus-330' }];
  if (page === 2) return [{ id: 'product-31', name: 'Product 31', slug: 'product-31' }];
  return Array.from({ length: 30 }, (_, index) => ({ id: `product-${index + 1}`, name: `Product ${index + 1}`, slug: `product-${index + 1}` }));
};

describe('AdminProductsPage catalog discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.products.mockImplementation((query: string, page: number) => ({
      data: { data: productsFor(query, page), meta: { page, pageSize: 30, total: query ? 1 : 31, totalPages: query ? 1 : 2 } },
      isPending: false, isFetching: false, isError: false, refetch: mocks.refetch,
    }));
  });

  it('shows a page count distinct from the catalog total and navigates through results', () => {
    render(<MemoryRouter><AdminProductsPage /></MemoryRouter>);
    expect(screen.getByText('Showing 1–30 of 31 products')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Product result pages' })).toHaveTextContent('Page 1 of 2');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(mocks.products).toHaveBeenLastCalledWith('', 2, 30);
    expect(screen.getByText('Showing 31–31 of 31 products')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Manage media for Product 31' })).toHaveAttribute('href', '/admin/products/product-31/media');

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(mocks.products).toHaveBeenLastCalledWith('', 1, 30);
  });

  it('searches server-side beyond the original first 30 and opens the matching media editor', async () => {
    render(<MemoryRouter><AdminProductsPage /></MemoryRouter>);
    expect(screen.queryByText('Product 31')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a product' }), { target: { value: 'SKU-031' } });

    await waitFor(() => expect(mocks.products).toHaveBeenLastCalledWith('SKU-031', 1, 30));
    expect(screen.getByText('Showing 1–1 of 1 products')).toBeInTheDocument();
    const manage = screen.getByRole('link', { name: 'Manage media for Acer Predator Cestus 330' });
    expect(manage).toHaveAttribute('href', '/admin/products/product-31/media');
  });

  it('keeps last loaded products on background failure and offers a clear initial error', () => {
    mocks.products.mockReturnValueOnce({
      data: { data: [{ id: 'p', name: 'Cached product', slug: 'cached-product' }], meta: { page: 1, pageSize: 30, total: 1, totalPages: 1 } },
      isPending: false, isFetching: false, isError: true, refetch: mocks.refetch,
    });
    const { rerender } = render(<MemoryRouter><AdminProductsPage /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('last loaded products are still available');
    expect(screen.getByText('Cached product')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);

    mocks.products.mockReturnValue({ data: undefined, isPending: false, isFetching: false, isError: true, refetch: mocks.refetch });
    rerender(<MemoryRouter><AdminProductsPage /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Products could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
  });

  it('prevents Retry from refetching the previous query while typed search is debouncing', () => {
    mocks.products.mockReturnValue({
      data: { data: [{ id: 'old', name: 'Old query result', slug: 'old-query-result' }], meta: { page: 1, pageSize: 30, total: 1, totalPages: 1 } },
      isPending: false, isFetching: false, isError: true, refetch: mocks.refetch,
    });
    render(<MemoryRouter><AdminProductsPage /></MemoryRouter>);

    fireEvent.change(screen.getByRole('textbox', { name: 'Find a product' }), { target: { value: 'new query' } });
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it('shows loading and empty search states without implying a catalog-wide zero', async () => {
    mocks.products.mockReturnValueOnce({ data: undefined, isPending: true, isFetching: true, isError: false, refetch: mocks.refetch });
    render(<MemoryRouter><AdminProductsPage /></MemoryRouter>);
    expect(screen.getByText('Loading products…')).toHaveAttribute('role', 'status');

    mocks.products.mockReturnValue({ data: { data: [], meta: { page: 1, pageSize: 30, total: 0, totalPages: 0 } }, isPending: false, isFetching: false, isError: false, refetch: mocks.refetch });
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a product' }), { target: { value: 'unknown product' } });
    await waitFor(() => expect(mocks.products).toHaveBeenLastCalledWith('unknown product', 1, 30));
    expect(screen.getByText('No products match this search.')).toBeInTheDocument();
    expect(screen.getByText('Showing 0–0 of 0 products')).toBeInTheDocument();
  });
});
