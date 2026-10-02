import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage';
import { useCategories } from '@/features/search/queries';
import { useDeals, useProducts } from '@/features/products/queries';
import { useCart } from '@/features/cart/context';

vi.mock('@/features/search/queries', () => ({ useCategories: vi.fn() }));
vi.mock('@/features/products/queries', () => ({ useDeals: vi.fn(), useProducts: vi.fn() }));
vi.mock('@/features/cart/context', () => ({ useCart: vi.fn() }));

const renderPage = () => render(<MemoryRouter><HomePage /></MemoryRouter>);

describe('Home catalog sections', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(useCart).mockReturnValue({ addItem: vi.fn() } as unknown as ReturnType<typeof useCart>); });

  it('reserves content-shaped sections while queries load in the approved order', () => {
    vi.mocked(useCategories).mockReturnValue({ isPending: true } as ReturnType<typeof useCategories>);
    vi.mocked(useDeals).mockReturnValue({ isPending: true } as ReturnType<typeof useDeals>);
    vi.mocked(useProducts).mockReturnValue({ isPending: true } as ReturnType<typeof useProducts>);
    renderPage();

    const headings = screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent);
    expect(headings).toEqual(['Shop by Category', 'Featured Deals', 'New Arrivals']);
    expect(screen.getByRole('region', { name: 'Shopping benefits' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading categories' }).children).toHaveLength(6);
    expect(screen.getByRole('status', { name: 'Loading deals' }).children).toHaveLength(6);
    expect(screen.getByRole('status', { name: 'Loading new arrivals' }).children).toHaveLength(6);
    expect(screen.queryByText(/Loading (new arrivals|categories|deals)…/)).not.toBeInTheDocument();
  });

  it('uses section-level errors with accessible Retry buttons', () => {
    const retryCategories = vi.fn();
    const retryDeals = vi.fn();
    const retryArrivals = vi.fn();
    vi.mocked(useCategories).mockReturnValue({ isError: true, refetch: retryCategories } as unknown as ReturnType<typeof useCategories>);
    vi.mocked(useDeals).mockReturnValue({ isError: true, refetch: retryDeals } as unknown as ReturnType<typeof useDeals>);
    vi.mocked(useProducts).mockReturnValue({ isError: true, refetch: retryArrivals } as unknown as ReturnType<typeof useProducts>);
    renderPage();

    expect(screen.getByText('Unable to load categories')).toBeInTheDocument();
    expect(screen.getByText('Unable to load deals')).toBeInTheDocument();
    expect(screen.getByText('Unable to load new arrivals')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]!);
    expect(retryCategories).toHaveBeenCalledOnce();
  });
});
