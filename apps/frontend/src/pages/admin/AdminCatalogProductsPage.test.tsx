import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminCatalogProductsPage } from './AdminCatalogProductsPage';
import {
  useAdminProducts, useBulkProductStatus, useCatalogOptions, useDeleteProduct, useProductStatus, type AdminProductRow,
} from '@/features/admin/products/api';

vi.mock('@/features/admin/products/api', async importOriginal => ({
  ...await importOriginal<object>(), useAdminProducts: vi.fn(), useBulkProductStatus: vi.fn(), useCatalogOptions: vi.fn(),
  useProductStatus: vi.fn(), useDeleteProduct: vi.fn(),
}));

const mutation = (overrides = {}) => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null, ...overrides });
const STAMP = '2026-11-01T10:00:00.000Z';
const product = (id: string, name: string, status: AdminProductRow['status'], categoryActive = true): AdminProductRow => ({
  id, name, sku: name.toUpperCase().replace(/\s+/g, '-'), slug: name.toLowerCase().replace(/\s+/g, '-'), price: '10.00', compareAtPrice: null,
  currency: 'USD', status, category: { id: 'cat-audio', name: 'Audio', isActive: categoryActive }, brand: null, image: null, imageCount: 0,
  inventory: null, storefrontVisible: status === 'ACTIVE' && categoryActive, createdAt: STAMP, updatedAt: STAMP, deletable: false, deleteBlocker: 'In use.',
});

const ALPHA = product('11111111-1111-4111-8111-111111111111', 'Alpha Headphones', 'ACTIVE');
const BETA = product('22222222-2222-4222-8222-222222222222', 'Beta Speaker', 'INACTIVE');
const GAMMA = product('33333333-3333-4333-8333-333333333333', 'Gamma Amp', 'ACTIVE');
const HIDDEN = product('44444444-4444-4444-8444-444444444444', 'Hidden Dock', 'INACTIVE', false);

const pageOf = (rows: AdminProductRow[], page = 1, totalPages = 1) => ({
  data: { data: rows, meta: { page, pageSize: 20, total: rows.length, totalPages } }, isPending: false, isFetching: false, isError: false,
  isPlaceholderData: false, refetch: vi.fn(),
});

function renderPage(initial = '/admin/products') {
  return render(<MemoryRouter initialEntries={[initial]}><AdminCatalogProductsPage /></MemoryRouter>);
}
const rowBox = (name: string) => screen.getByRole('checkbox', { name: `Select ${name}` });
const headerBox = () => screen.getByRole('checkbox', { name: 'Select all products on this page' });
const dialog = () => screen.getByRole('dialog');

let bulk: ReturnType<typeof mutation>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAdminProducts).mockImplementation(params => pageOf(params.page === 2 ? [GAMMA] : [ALPHA, BETA, GAMMA], params.page, 2) as never);
  vi.mocked(useCatalogOptions).mockReturnValue({ data: { data: { categories: [], brands: [], pairs: [] } } } as never);
  vi.mocked(useProductStatus).mockReturnValue(mutation() as never);
  vi.mocked(useDeleteProduct).mockReturnValue(mutation() as never);
  bulk = mutation();
  vi.mocked(useBulkProductStatus).mockReturnValue(bulk as never);
});

describe('AdminCatalogProductsPage selection', () => {
  it('selects single rows, shows indeterminate on the header and selects or clears the whole page from it', () => {
    renderPage();
    expect(headerBox()).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(rowBox('Alpha Headphones'));
    expect(screen.getByRole('status')).toHaveTextContent('1 selected on this page');
    expect(headerBox()).toHaveAttribute('aria-checked', 'mixed');

    fireEvent.click(headerBox());
    expect(screen.getByRole('status')).toHaveTextContent('3 selected on this page');
    expect(headerBox()).toHaveAttribute('aria-checked', 'true');
    expect(rowBox('Gamma Amp')).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(headerBox());
    expect(screen.getByRole('status')).not.toHaveTextContent('selected on this page');
    expect(rowBox('Beta Speaker')).toHaveAttribute('aria-checked', 'false');
  });

  it('shows the action toolbar only with a selection and explains why an action is unavailable', () => {
    renderPage();
    expect(screen.queryByRole('group', { name: 'Actions for selected products' })).toBeNull();

    fireEvent.click(rowBox('Beta Speaker'));
    const group = screen.getByRole('group', { name: 'Actions for selected products' });
    expect(within(group).getByRole('button', { name: 'Archive' })).toBeDisabled();
    expect(within(group).getByText('None of the selected products is published.')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Reactivate' })).toBeEnabled();
    expect(within(group).getByRole('button', { name: 'Archive' })).toHaveAttribute('aria-describedby', 'archive-reason');

    fireEvent.click(within(group).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('group', { name: 'Actions for selected products' })).toBeNull();
  });

  it('explains a reactivation blocked by a hidden category', () => {
    vi.mocked(useAdminProducts).mockReturnValue(pageOf([HIDDEN]) as never);
    renderPage();
    fireEvent.click(rowBox('Hidden Dock'));
    const group = screen.getByRole('group', { name: 'Actions for selected products' });
    expect(within(group).getByRole('button', { name: 'Reactivate' })).toBeDisabled();
    expect(within(group).getByText('Their category is hidden. Make it visible before reactivating.')).toBeInTheDocument();
  });

  it('clears the selection on page change and announces it', () => {
    renderPage();
    fireEvent.click(rowBox('Alpha Headphones'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByRole('group', { name: 'Actions for selected products' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Selection cleared because the page, search, filters or sort changed.');
    expect(screen.getByRole('checkbox', { name: 'Select Gamma Amp' })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('AdminCatalogProductsPage bulk status', () => {
  it('archives only eligible rows and sends each row with its version', () => {
    renderPage();
    fireEvent.click(rowBox('Alpha Headphones'));
    fireEvent.click(rowBox('Beta Speaker'));
    fireEvent.click(rowBox('Gamma Amp'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Actions for selected products' })).getByRole('button', { name: 'Archive' }));

    expect(dialog()).toHaveTextContent('Archive 2 products?');
    expect(dialog()).toHaveTextContent('1 selected product is not eligible and will be skipped: already unpublished.');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Archive' }));
    expect(bulk.mutate).toHaveBeenCalledTimes(1);
    expect(bulk.mutate).toHaveBeenCalledWith({ status: 'INACTIVE', items: [
      { id: ALPHA.id, expectedUpdatedAt: STAMP }, { id: GAMMA.id, expectedUpdatedAt: STAMP },
    ] }, expect.any(Object));
  });

  it('ignores a second confirmation while the request is in flight', () => {
    const { rerender } = renderPage();
    fireEvent.click(rowBox('Alpha Headphones'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Actions for selected products' })).getByRole('button', { name: 'Archive' }));
    // The first confirmation starts the request; the hook then reports pending, as TanStack Query would.
    bulk.mutate.mockImplementation(() => { bulk.isPending = true; });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Archive' }));
    expect(bulk.mutate).toHaveBeenCalledTimes(1);

    rerender(<MemoryRouter initialEntries={['/admin/products']}><AdminCatalogProductsPage /></MemoryRouter>);
    expect(within(dialog()).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Archive' }));
    expect(bulk.mutate).toHaveBeenCalledTimes(1);
  });

  it('reports a partial result per product, clears the selection and keeps the failed name and reason', () => {
    bulk.mutate.mockImplementation((_variables: unknown, options: { onSuccess: (response: unknown) => void }) => options.onSuccess({ data: {
      results: [
        { id: ALPHA.id, outcome: 'UPDATED', message: 'Archived.' },
        { id: GAMMA.id, outcome: 'CONFLICT', message: 'This product changed since you opened it. Reload and try again.' },
      ],
      summary: { updated: 1, unchanged: 0, conflict: 1, notFound: 0, rejected: 0 },
    } }));
    renderPage();
    fireEvent.click(rowBox('Alpha Headphones'));
    fireEvent.click(rowBox('Gamma Amp'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Actions for selected products' })).getByRole('button', { name: 'Archive' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Archive' }));

    const report = screen.getByRole('region', { name: 'Bulk update result' });
    expect(within(report).getByRole('status')).toHaveTextContent('1 product archived. 1 product could not be changed.');
    expect(within(report).getByText('Gamma Amp')).toBeInTheDocument();
    expect(within(report).getByText(/This product changed since you opened it/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Actions for selected products' })).toBeNull();
  });
});
