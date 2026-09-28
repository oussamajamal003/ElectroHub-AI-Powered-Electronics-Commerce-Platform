import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchPage } from './SearchPage';
import { SearchField } from '@/components/ui/SearchField/SearchField';
import { apiClient } from '@/lib/api';
import { activeSearch, clearFilters, emptySearch, parseSearch, searchParams } from './searchState';
import type { Suggestion } from './api';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/query';
import { useBrands, useCategories } from './queries';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query';
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiClient: vi.fn() }));
const product = { id: 'product', name: 'Apple MacBook Air', slug: 'apple-macbook-air', price: '999.00', compareAtPrice: null,
  currency: 'USD', category: { id: 'laptops', name: 'Laptops', slug: 'laptops' }, brand: null, availability: 'AVAILABLE', primaryImage: null };
const response = { data: [product], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient).mockImplementation(async endpoint => {
    if (endpoint.startsWith('/api/categories')) return { data: [{ id: 'laptops', name: 'Laptops', slug: 'laptops', description: null, imageUrl: null }], meta: { total: 1 } } as never;
    if (endpoint.startsWith('/api/brands')) return { data: [{ id: 'apple', name: 'Apple', slug: 'apple', description: null, logoUrl: null }], meta: { total: 1 } } as never;
    if (endpoint.startsWith('/api/search/suggestions')) return { data: [{ id: 'product', type: 'PRODUCT', label: 'Apple MacBook Air', slug: 'apple-macbook-air' }] } as never;
    return response as never;
  });
  URL.createObjectURL = vi.fn(() => 'blob:test-image'); URL.revokeObjectURL = vi.fn();
});
function Harness({ catalog = false }: { catalog?: boolean }) {
  const navigate = useNavigate(); const location = useLocation(); const client = useQueryClient();
  const state = (() => { try { return parseSearch(new URLSearchParams(location.search)); } catch { return emptySearch; } })();
  return <><button onClick={() => navigate(-1)}>History back</button><button onClick={() => navigate(1)}>History forward</button><button onClick={() => void client.refetchQueries({ queryKey: queryKeys.search.products(state) })}>Refetch results</button><output data-testid="location">{location.search}</output><SearchPage catalog={catalog} /></>;
}
function ReferenceConsumers() {
  const categoriesA = useCategories(true); const categoriesB = useCategories(true);
  const brandsA = useBrands(true); const brandsB = useBrands(true);
  return <div>{categoriesA.data && categoriesB.data && brandsA.data && brandsB.data ? 'References ready' : 'Loading references'}</div>;
}
const page = (path: string | string[] = '/search', catalog = false) => render(<QueryClientProvider client={createQueryClient()}><MemoryRouter initialEntries={Array.isArray(path) ? path : [path]} initialIndex={Array.isArray(path) ? path.length - 1 : 0}><Harness catalog={catalog} /></MemoryRouter></QueryClientProvider>);
describe('URL-backed Search state', () => {
  it('normalizes queries, ignores unrelated keys and round-trips committed state', () => {
    const state = parseSearch(new URLSearchParams('q=sony+++headphones&brand=sony&page=2&utm=demo'));
    expect(state.q).toBe('sony headphones'); expect(parseSearch(searchParams(state))).toEqual(state);
    expect(clearFilters(state)).toEqual({ q: 'sony headphones', page: 1, pageSize: 20 });
    expect(activeSearch(parseSearch(new URLSearchParams()))).toBe(false);
    expect(activeSearch(parseSearch(new URLSearchParams('minPrice=0')))).toBe(true);
  });
  it.each(['page=1001', 'pageSize=101', 'q=a&q=b', 'availability=stock', 'minPrice=-1', 'minPrice=1.234', 'minPrice=10&maxPrice=9', 'sort=featured'])('rejects malformed state %s', value => {
    expect(() => parseSearch(new URLSearchParams(value))).toThrow();
  });
});
describe('Search page', () => {
  it('accepts a new query while loading and ignores the cancelled response', async () => {
    let finishOld: ((value: typeof response) => void) | undefined;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.includes('/api/search/products?q=old')) return new Promise(resolve => { finishOld = resolve; }) as never;
      if (endpoint.includes('/api/search/products?q=new')) return { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } as never;
      return { data: [], meta: { total: 0 } } as never;
    });
    page('/search?q=old');
    await waitFor(() => expect(finishOld).toBeDefined());
    const input = screen.getByRole('combobox', { name: 'Search products' });
    fireEvent.change(input, { target: { value: 'new' } });
    expect(await screen.findByRole('heading', { name: 'No results for “new”' })).toBeInTheDocument();
    await act(async () => { finishOld?.(response); });
    expect(screen.queryByText('Apple MacBook Air')).not.toBeInTheDocument();
    expect(input).toHaveValue('new');
  });
  it('renders screenshot shell without loading products initially and warms shared reference data', async () => {
    page(); await screen.findByRole('heading', { name: 'Search', level: 1 });
    expect(screen.getByRole('tab', { name: 'Text Search' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(vi.mocked(apiClient).mock.calls.filter(([endpoint]) => endpoint.startsWith('/api/categories') || endpoint.startsWith('/api/brands')).length).toBe(2));
    expect(vi.mocked(apiClient).mock.calls.some(([endpoint]) => endpoint.startsWith('/api/search/products'))).toBe(false);
    expect(screen.queryByText(/0 results/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Filters/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Product filters' })).not.toBeInTheDocument();
  });
  it('loads a bounded public catalog page on /products with no query', async () => {
    page('/products', true);
    expect(await screen.findByText('Apple MacBook Air')).toBeInTheDocument();
    expect(vi.mocked(apiClient).mock.calls.some(([endpoint]) => endpoint === '/api/search/products?')).toBe(true);
  });
  it('submits exactly one product request and renders canonical product card without inert actions', async () => {
    page(); fireEvent.change(screen.getByRole('combobox', { name: 'Search products' }), { target: { value: 'macbook' } });
    expect(await screen.findByTestId('product-card')).toHaveTextContent('Apple MacBook Air');
    expect(screen.getByTestId('product-card')).toHaveTextContent('999');
    expect(screen.queryByRole('button', { name: /Add .* to cart/ })).not.toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(apiClient).mock.calls.filter(([endpoint]) => endpoint.startsWith('/api/search/products'))).toHaveLength(1));
    expect(screen.getByTestId('location')).toHaveTextContent('q=macbook');
  });
  it('debounces replacements and deletions, then returns to untouched state', async () => {
    page(); const input = screen.getByRole('combobox', { name: 'Search products' });
    fireEvent.change(input, { target: { value: 'mac' } });
    fireEvent.change(input, { target: { value: 'macbook' } });
    expect(screen.getByTestId('location')).not.toHaveTextContent('q=');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('q=macbook'));
    await waitFor(() => expect(vi.mocked(apiClient).mock.calls.filter(([endpoint]) => endpoint.startsWith('/api/search/products'))).toHaveLength(1));
    fireEvent.change(input, { target: { value: 'mac' } });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('q=mac'));
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(''));
    expect(screen.queryByText(/0 results/)).not.toBeInTheDocument();
  });
  it('commits Enter immediately without a duplicate debounced request', async () => {
    page(); const input = screen.getByRole('combobox', { name: 'Search products' });
    fireEvent.change(input, { target: { value: 'sony' } });
    fireEvent.submit(input.closest('form')!);
    expect(screen.getByTestId('location')).toHaveTextContent('q=sony');
    await screen.findByText('Apple MacBook Air');
    fireEvent.submit(input.closest('form')!);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 320)); });
    expect(vi.mocked(apiClient).mock.calls.filter(([endpoint]) => endpoint.startsWith('/api/search/products'))).toHaveLength(1);
  });
  it('applies drafted filters once, counts them and removes chips independently', async () => {
    page('/products?q=sony&page=2&brand=apple&availability=available', true); await screen.findByText('Apple MacBook Air');
    fireEvent.click(screen.getByRole('button', { name: 'Filters (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Laptops' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Min price ($)' }), { target: { value: '50' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Max price ($)' }), { target: { value: '1000' } });
    expect(screen.getByTestId('location')).not.toHaveTextContent('category=');
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Filters (4)' })).toBeInTheDocument());
    expect(screen.getByTestId('location')).not.toHaveTextContent('page=2');
    expect(screen.getByTestId('location')).toHaveTextContent('minPrice=50');
    expect(screen.queryByRole('button', { name: 'Apply prices' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove category filter Laptops' }));
    expect(screen.getByRole('button', { name: 'Filters (3)' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('brand=apple');
    fireEvent.click(screen.getByRole('button', { name: /Remove price filter/ }));
    expect(screen.getByRole('button', { name: 'Filters (2)' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).not.toHaveTextContent('minPrice');
  });
  it('restores direct URL, filters and browser Back/Forward without typing history spam', async () => {
    page(['/search?q=sony&sort=relevance', '/search?q=sony&sort=price-desc'], true); await screen.findByText('Apple MacBook Air');
    expect(screen.getByRole('combobox', { name: 'Search products' })).toHaveValue('sony');
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveTextContent('Price: high to low');
    expect(screen.getByTestId('location')).toHaveTextContent('sort=price-desc');
    fireEvent.change(screen.getByRole('combobox', { name: 'Search products' }), { target: { value: 'macbook' } });
    expect(screen.getByTestId('location')).toHaveTextContent('q=sony');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('q=macbook'));
    fireEvent.click(screen.getByText('History back')); await waitFor(() => expect(screen.getByRole('combobox', { name: 'Search products' })).toHaveValue('sony'));
    fireEvent.click(screen.getByText('History forward')); await waitFor(() => expect(screen.getByRole('combobox', { name: 'Search products' })).toHaveValue('macbook'));
  });
  it('clears filters but retains query and permits filter-only discovery', async () => {
    page('/search?q=sony&brand=apple', true); await screen.findByText('Apple MacBook Air');
    fireEvent.click(screen.getByRole('button', { name: 'Filters (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByTestId('location')).toHaveTextContent('?q=sony');
    expect(screen.getByTestId('location')).not.toHaveTextContent('brand');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Laptops' }));
    expect(screen.getByTestId('location')).not.toHaveTextContent('category=laptops');
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByTestId('location')).toHaveTextContent('category=laptops');
    fireEvent.change(screen.getByRole('combobox', { name: 'Search products' }), { target: { value: '' } });
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('q='));
    expect(screen.getByTestId('location')).toHaveTextContent('category=laptops');
    fireEvent.click(screen.getByRole('button', { name: 'Remove category filter Laptops' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(''));
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
  });
  it('handles invalid direct URL without issuing product requests', async () => {
    page('/search?page=99999'); expect(await screen.findByRole('alert')).toHaveTextContent('invalid values');
    expect(vi.mocked(apiClient).mock.calls.some(([endpoint]) => endpoint.startsWith('/api/search/products'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' })); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('shows a sanitized failure with retry', async () => {
    vi.mocked(apiClient).mockImplementation(async endpoint => { if (endpoint.startsWith('/api/search/products')) throw new Error('Prisma SQL private'); return { data: [], meta: { total: 0 } } as never; });
    page('/search?q=sony'); expect(await screen.findByRole('alert')).not.toHaveTextContent(/Prisma|SQL|private/);
    expect(screen.getByRole('button', { name: 'Retry search' })).toBeInTheDocument();
  });
  it('shows useful no-results recovery', async () => {
    vi.mocked(apiClient).mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    page('/search?q=no-match'); expect(await screen.findByRole('heading', { name: 'No results for “no-match”' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear query' })).toBeInTheDocument();
  });
  it('implements local image selection/removal with no image API call', async () => {
    page(); fireEvent.mouseDown(screen.getByRole('tab', { name: 'Image Search' }), { button: 0, ctrlKey: false });
    const input = await screen.findByLabelText('Choose image');
    fireEvent.change(input, { target: { files: [new File(['text'], 'bad.txt', { type: 'text/plain' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Choose an image file.');
    fireEvent.change(input, { target: { files: [new File(['image'], 'camera.png', { type: 'image/png' })] } });
    expect(await screen.findByText('camera.png')).toBeInTheDocument();
    expect(screen.getByAltText('Selected image preview')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-image');
    expect(vi.mocked(apiClient).mock.calls.every(([endpoint]) => !endpoint.includes('image'))).toBe(true);
  });
  it('preserves visible results during a background refetch', async () => {
    let finishRefetch: ((value: typeof response) => void) | undefined;
    let calls = 0;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.startsWith('/api/search/products') && calls++ > 0) return new Promise(resolve => { finishRefetch = resolve; }) as never;
      if (endpoint.startsWith('/api/categories')) return { data: [], meta: { total: 0 } } as never;
      if (endpoint.startsWith('/api/brands')) return { data: [], meta: { total: 0 } } as never;
      return response as never;
    });
    page('/search?q=macbook');
    expect(await screen.findByText('Apple MacBook Air')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refetch results' }));
    await waitFor(() => expect(finishRefetch).toBeDefined());
    expect(screen.getByText('Apple MacBook Air')).toBeInTheDocument();
    expect(screen.queryByTestId('product-skeleton')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Search unavailable' })).not.toBeInTheDocument();
    await act(async () => { finishRefetch?.({ ...response, data: [{ ...product, name: 'Updated MacBook' }] }); });
    expect(await screen.findByText('Updated MacBook')).toBeInTheDocument();
  });
});
describe('shared Category and Brand query consumers', () => {
  it('deduplicates simultaneous consumers by query key', async () => {
    const client = createQueryClient();
    vi.mocked(apiClient).mockImplementation(async endpoint => endpoint.startsWith('/api/categories')
      ? { data: [], meta: { total: 0 } } as never : { data: [], meta: { total: 0 } } as never);
    render(<QueryClientProvider client={client}><ReferenceConsumers /></QueryClientProvider>);
    expect(await screen.findByText('References ready')).toBeInTheDocument();
    expect(vi.mocked(apiClient).mock.calls.filter(([endpoint]) => endpoint.startsWith('/api/categories'))).toHaveLength(1);
    expect(vi.mocked(apiClient).mock.calls.filter(([endpoint]) => endpoint.startsWith('/api/brands'))).toHaveLength(1);
  });
});
describe('Accessible debounced suggestions', () => {
  it('starts suggestions after the independent 175 ms debounce', async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient).mockResolvedValue({ data: [] });
    try {
      render(<QueryClientProvider client={createQueryClient()}><SearchField value="sam" onChange={vi.fn()} onSelect={vi.fn()} /></QueryClientProvider>);
      fireEvent.focus(screen.getByRole('combobox'));
      await act(async () => { await vi.advanceTimersByTimeAsync(174); });
      expect(apiClient).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(apiClient).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('debounces, navigates by keyboard, selects with Enter and closes on Escape', async () => {
    vi.mocked(apiClient).mockResolvedValue({ data: [{ id: 'one', type: 'PRODUCT', label: 'MacBook', slug: 'macbook' }] });
    const select = vi.fn(); const change = vi.fn();
    const client = createQueryClient();
    const { rerender } = render(<QueryClientProvider client={client}><SearchField value="mac" onChange={change} onSelect={select} /></QueryClientProvider>);
    fireEvent.focus(screen.getByRole('combobox')); expect(apiClient).not.toHaveBeenCalled();
    expect(await screen.findByRole('option')).toHaveTextContent('MacBook');
    expect(apiClient).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' }); expect(select).toHaveBeenCalledWith(expect.objectContaining({ label: 'MacBook' }));
    fireEvent.focus(screen.getByRole('combobox')); rerender(<QueryClientProvider client={client}><SearchField value="macb" onChange={change} onSelect={select} /></QueryClientProvider>);
    await screen.findByRole('option'); fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
  it('ignores a stale suggestion response and keeps manual input usable on failure', async () => {
    let finishOld: ((response: { data: Suggestion[] }) => void) | undefined;
    const load = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValue({ data: [{ id: 'new', type: 'BRAND', label: 'Sony', slug: 'sony' }] });
    vi.mocked(apiClient).mockImplementation(load);
    const client = createQueryClient();
    const { rerender } = render(<QueryClientProvider client={client}><SearchField value="mac" onChange={vi.fn()} onSelect={vi.fn()} /></QueryClientProvider>);
    fireEvent.focus(screen.getByRole('combobox')); await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    rerender(<QueryClientProvider client={client}><SearchField value="sony" onChange={vi.fn()} onSelect={vi.fn()} /></QueryClientProvider>);
    expect(await screen.findByRole('option')).toHaveTextContent('Sony');
    await act(async () => { finishOld?.({ data: [{ id: 'old', type: 'PRODUCT', label: 'Old Mac', slug: 'old' }] }); });
    expect(screen.queryByText('Old Mac')).not.toBeInTheDocument();
    load.mockRejectedValue(new Error('Suggestion unavailable')); rerender(<QueryClientProvider client={client}><SearchField value="fail" onChange={vi.fn()} onSelect={vi.fn()} /></QueryClientProvider>);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3)); expect(screen.getByRole('combobox')).not.toBeDisabled();
  });
});
