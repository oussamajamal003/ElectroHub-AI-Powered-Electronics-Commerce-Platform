import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ProductSummary } from '@/features/products/types';
import { RecommendationRail, type RecommendationRailProps } from './RecommendationRail';

function product(id: string, name: string): ProductSummary {
  return {
    id,
    name,
    description: null,
    slug: id,
    price: '199.00',
    compareAtPrice: null,
    discountPercent: null,
    averageRating: null,
    reviewCount: 0,
    currency: 'USD',
    availability: 'AVAILABLE',
    category: { id: 'sample-category', name: 'Sample Category', slug: 'sample-category' },
    brand: null,
    primaryImage: null,
  };
}

const products = [product('p1', 'Sample Speaker'), product('p2', 'Sample Tablet')];

function renderRail(props: Partial<RecommendationRailProps> = {}) {
  return render(
    <MemoryRouter>
      <RecommendationRail id="rail-title" title="Similar Products" products={products} {...props} />
    </MemoryRouter>,
  );
}

describe('RecommendationRail', () => {
  it('renders nothing when there are no products and the rail is neither loading nor in error', () => {
    const { container } = renderRail({ products: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('labels the section with its heading and defaults to an h2 heading', () => {
    renderRail();
    const section = screen.getByRole('region', { name: 'Similar Products' });
    expect(section).toHaveAttribute('aria-labelledby', 'rail-title');
    const heading = document.getElementById('rail-title');
    expect(heading?.tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 2, name: 'Similar Products' })).toBe(heading);
  });

  it('renders an h3 heading when headingLevel is h3', () => {
    renderRail({ headingLevel: 'h3' });
    expect(screen.getByRole('heading', { level: 3, name: 'Similar Products' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Similar Products' })).not.toBeInTheDocument();
  });

  it('shows skeleton placeholders with a loading status and aria-busy while loading', () => {
    const { container } = renderRail({ products: [], loading: true, skeletonCount: 3 });
    const status = screen.getByRole('status', { name: 'Loading Similar Products' });
    expect(status.children).toHaveLength(3);
    expect(screen.getByRole('region', { name: 'Similar Products' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('These suggestions are unavailable right now.')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="product-card"]')).toHaveLength(0);
  });

  it('shows a quiet error message with a retry button that calls onRetry when there is nothing to show', () => {
    const onRetry = vi.fn();
    renderRail({ products: [], error: true, onRetry });
    expect(screen.getByRole('status')).toHaveTextContent('These suggestions are unavailable right now.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the cards visible and omits the error text when products exist alongside an error', () => {
    renderRail({ error: true, onRetry: vi.fn() });
    expect(screen.getAllByTestId('product-card')).toHaveLength(products.length);
    expect(screen.queryByText('These suggestions are unavailable right now.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('renders the action link only when products exist', () => {
    const action = { href: '/categories/sample-category', label: 'View category' };
    const { unmount } = renderRail({ action });
    expect(screen.getByRole('link', { name: /View category/ })).toHaveAttribute('href', '/categories/sample-category');
    unmount();

    renderRail({ action, products: [], error: true });
    expect(screen.queryByRole('link', { name: /View category/ })).not.toBeInTheDocument();
  });

  it('renders one list item per product', () => {
    renderRail();
    const list = screen.getByRole('list', { name: 'Similar Products' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(products.length);
  });

  it('passes each product id to cardRef and attaches the returned ref to its list item', () => {
    const attached = vi.fn();
    const cardRef = vi.fn(() => attached);
    renderRail({ cardRef });
    expect(cardRef).toHaveBeenCalledWith('p1');
    expect(cardRef).toHaveBeenCalledWith('p2');
    expect(attached).toHaveBeenCalledWith(expect.any(HTMLLIElement));
  });
});
