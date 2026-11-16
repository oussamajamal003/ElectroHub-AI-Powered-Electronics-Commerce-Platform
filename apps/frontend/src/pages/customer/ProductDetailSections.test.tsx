import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProductDetail } from '@/features/products/types';
import { ProductDescriptionPanel } from './ProductDetailSections';

const product: ProductDetail = {
  id: 'tablet', name: 'Studio Tablet', slug: 'studio-tablet', sku: 'TAB-1', modelNumber: null,
  description: 'A compact tablet.', price: '100.00', compareAtPrice: null, discountPercent: null,
  averageRating: null, reviewCount: 0, currency: 'USD', availability: 'AVAILABLE', availableQuantity: 1,
  category: { id: 'tablets', name: 'Tablets', slug: 'tablets' }, brand: null, images: [], specifications: [],
};

const renderDescription = (overrides: Partial<ProductDetail> = {}) => render(<ProductDescriptionPanel product={{ ...product, ...overrides }} />);

describe('Product description content layout', () => {
  it('keeps short copy and actual metadata without fabricated highlights', () => {
    renderDescription();
    const section = screen.getByRole('region', { name: 'Product Description' });
    expect(within(section).getByText('A compact tablet.')).toBeInTheDocument();
    expect(within(section).getByText('TAB-1')).toBeInTheDocument();
    expect(screen.queryByTestId('description-highlights')).not.toBeInTheDocument();
    expect(screen.queryByText('Brand')).not.toBeInTheDocument();
    expect(screen.queryByText('Model')).not.toBeInTheDocument();
  });

  it('preserves paragraphs and explicit bullet lists without interpreting markup or links', () => {
    const { container } = renderDescription({ description: 'First paragraph.\nA second line.\n\nSecond paragraph.\n- USB-C connection\n• <img src=x onerror=alert(1)>\n* [Unsafe](javascript:alert(1))\n\nClosing paragraph.' });
    expect(screen.getByText('First paragraph. A second line.')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Closing paragraph.')).toBeInTheDocument();
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map(item => item.textContent)).toEqual(['USB-C connection', '<img src=x onerror=alert(1)>', '[Unsafe](javascript:alert(1))']);
    expect(container.querySelector('img, script, a')).toBeNull();
  });

  it('limits highlights to four real specifications and preserves their values', () => {
    renderDescription({ specifications: [{ group: 'Hardware', items: Array.from({ length: 6 }, (_, i) => ({ id: `spec-${i}`, group: 'Hardware', name: `Detail ${i}`, value: `Actual value ${i}`, sortOrder: i })) }] });
    const highlights = screen.getByTestId('description-highlights');
    expect(highlights.querySelectorAll('dt')).toHaveLength(4);
    expect(within(highlights).getByText('Actual value 3')).toBeInTheDocument();
    expect(within(highlights).queryByText('Actual value 4')).not.toBeInTheDocument();
    expect(screen.getByText('2 more in the Specifications tab.')).toBeInTheDocument();
  });

  it.each([null, '', ' \n  '])('shows an honest missing-description state for %s', description => {
    renderDescription({ description });
    expect(screen.getByText('No description is available.')).toBeInTheDocument();
    expect(screen.getByText('TAB-1')).toBeInTheDocument();
  });
});
