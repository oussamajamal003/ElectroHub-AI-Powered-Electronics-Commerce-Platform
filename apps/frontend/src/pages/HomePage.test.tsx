import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage';
import { useCategories } from '@/features/search/queries';
import { useDeals, useProducts } from '@/features/products/queries';
import { useCart } from '@/features/cart/context';
import { useAuth } from '@/features/auth/context/AuthContext';
import { usePersonalRecommendations, useRecommendationPreferences } from '@/features/recommendations/queries';

vi.mock('@/features/search/queries', () => ({ useCategories: vi.fn() }));
vi.mock('@/features/products/queries', () => ({ useDeals: vi.fn(), useProducts: vi.fn() }));
vi.mock('@/features/cart/context', async importOriginal => ({ ...await importOriginal<typeof import('@/features/cart/context')>(), useCart: vi.fn() }));
vi.mock('@/features/recommendations/queries', () => import('@/test/recommendationQueriesMock'));
vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn(() => ({ user: null, isAuthenticated: false, isSessionVerified: true })) }));

const renderPage = () => render(<MemoryRouter><HomePage /></MemoryRouter>);

describe('Home catalog sections', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(useAuth).mockReturnValue({ user: null, isAuthenticated: false, isSessionVerified: true } as ReturnType<typeof useAuth>); vi.mocked(useCart).mockReturnValue({ addItem: vi.fn() } as unknown as ReturnType<typeof useCart>); });

  it('waits for session verification before requesting private recommendations', () => {
    vi.mocked(useCategories).mockReturnValue({ isPending: true } as ReturnType<typeof useCategories>);
    vi.mocked(useDeals).mockReturnValue({ isPending: true } as ReturnType<typeof useDeals>);
    vi.mocked(useProducts).mockReturnValue({ isPending: true } as ReturnType<typeof useProducts>);
    const cached = { user: { id: 'user-1', role: 'CUSTOMER' }, isAuthenticated: true, isSessionVerified: false } as ReturnType<typeof useAuth>;
    vi.mocked(useAuth).mockReturnValue(cached);
    const { rerender } = renderPage();
    expect(usePersonalRecommendations).toHaveBeenLastCalledWith(undefined, 4);
    expect(useRecommendationPreferences).toHaveBeenLastCalledWith(undefined);
    // Session restoring is not "no recommendations": the neutral skeleton is already reserved, without any personal data.
    expect(screen.getByRole('status', { name: 'Loading recommendations' })).toBeInTheDocument();
    vi.mocked(useAuth).mockReturnValue({ ...cached, isAuthenticated: false, user: null, isSessionVerified: true });
    rerender(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.queryByRole('status', { name: 'Loading recommendations' })).not.toBeInTheDocument();
    vi.mocked(useAuth).mockReturnValue({ ...cached, isSessionVerified: true });
    rerender(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(usePersonalRecommendations).toHaveBeenLastCalledWith('user-1', 4);
    expect(useRecommendationPreferences).toHaveBeenLastCalledWith('user-1');
  });

  it('reserves content-shaped sections while queries load in the approved order', () => {
    vi.mocked(useCategories).mockReturnValue({ isPending: true } as ReturnType<typeof useCategories>);
    vi.mocked(useDeals).mockReturnValue({ isPending: true } as ReturnType<typeof useDeals>);
    vi.mocked(useProducts).mockReturnValue({ isPending: true } as ReturnType<typeof useProducts>);
    renderPage();

    const headings = screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent);
    expect(headings).toEqual(['Shop by Category', 'Featured Deals', 'New Arrivals']);
    expect(screen.getByRole('region', { name: 'Shopping benefits' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading categories' }).children).toHaveLength(8);
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

  it('shows the eight largest real categories first and reveals every storefront category on request', () => {
    const counts: Array<[string, number]> = [['Accessories', 2], ['Cameras & Photography', 8], ['Computer Components', 15], ['Gaming', 3], ['Headphones', 3],
      ['Keyboards & Mice', 10], ['Laptops', 49], ['Monitors', 3], ['Networking & Wi-Fi', 8], ['Printers & Scanners', 6], ['Smart Home', 10],
      ['Smartphones', 31], ['Smartwatches', 8], ['Speakers & Audio', 12], ['Storage & SSDs', 10], ['Tablets', 28]];
    const data = counts.map(([name, productCount]) => ({ id: name, name, productCount, description: null, imageUrl: '/images/catalog/test.webp',
      slug: name.toLowerCase().replace(/[^a-z]+/g, '-') }));
    vi.mocked(useCategories).mockReturnValue({ data, isPending: false, isError: false } as unknown as ReturnType<typeof useCategories>);
    vi.mocked(useDeals).mockReturnValue({ isPending: true } as ReturnType<typeof useDeals>);
    vi.mocked(useProducts).mockReturnValue({ isPending: true } as ReturnType<typeof useProducts>);
    renderPage();

    const grid = () => document.getElementById('home-category-grid')!;
    const names = () => within(grid()).getAllByRole('link').map(link => link.textContent?.replace(/\d+ products?$/, ''));
    expect(names()).toEqual(['Laptops', 'Smartphones', 'Tablets', 'Computer Components', 'Speakers & Audio', 'Keyboards & Mice', 'Smart Home', 'Storage & SSDs']);
    expect(within(grid()).getByRole('link', { name: /Laptops/ })).toHaveAttribute('href', '/products?category=laptops');
    expect(within(grid()).getByRole('link', { name: /Laptops/ })).toHaveTextContent('49 products');

    const toggle = screen.getByRole('button', { name: 'View all 16 categories' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'home-category-grid');
    fireEvent.click(toggle);
    expect(names()).toHaveLength(16);
    expect(within(grid()).getByRole('link', { name: /Cameras & Photography/ })).toHaveAttribute('href', '/products?category=cameras-photography');
    expect(screen.getByRole('button', { name: 'Show fewer categories' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer categories' }));
    expect(names()).toHaveLength(8);
  });

  it('shows an empty state and no toggle when the API has no storefront categories', () => {
    vi.mocked(useCategories).mockReturnValue({ data: [], isPending: false, isError: false } as unknown as ReturnType<typeof useCategories>);
    vi.mocked(useDeals).mockReturnValue({ isPending: true } as ReturnType<typeof useDeals>);
    vi.mocked(useProducts).mockReturnValue({ isPending: true } as ReturnType<typeof useProducts>);
    renderPage();
    expect(screen.getByText('No categories are available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View all/ })).not.toBeInTheDocument();
  });
});
