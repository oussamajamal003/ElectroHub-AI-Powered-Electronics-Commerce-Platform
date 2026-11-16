import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useCategories } from '@/features/search/queries';
import { ShopFooterLinks } from './ShopFooterLinks';

vi.mock('@/features/search/queries', () => ({ useCategories: vi.fn() }));

const category = (name: string, slug: string, productCount: number) => ({ id: slug, name, slug, productCount, description: null, imageUrl: null });
const renderLinks = () => render(<MemoryRouter><nav aria-label="Shop"><ShopFooterLinks /></nav></MemoryRouter>);

describe('ShopFooterLinks', () => {
  it('links the eight largest live categories by real slug after All Products', () => {
    vi.mocked(useCategories).mockReturnValue({ data: [
      category('Accessories', 'accessories', 2), category('Cameras & Photography', 'cameras-photography', 8),
      category('Computer Components', 'computer-components', 15), category('Laptops', 'laptops', 49),
      category('Smartphones', 'smartphones', 31), category('Tablets', 'tablets', 28), category('Speakers & Audio', 'speakers-audio', 12),
      category('Smart Home', 'smart-home', 10), category('Storage & SSDs', 'storage-ssds', 10), category('Keyboards & Mice', 'keyboards-mice', 10),
    ] } as unknown as ReturnType<typeof useCategories>);
    renderLinks();
    const links = screen.getAllByRole('link');
    expect(links.map(link => link.textContent)).toEqual(['All Products', 'Laptops', 'Smartphones', 'Tablets', 'Computer Components',
      'Speakers & Audio', 'Keyboards & Mice', 'Smart Home', 'Storage & SSDs']);
    expect(screen.getByRole('link', { name: 'Smartphones' })).toHaveAttribute('href', '/products?category=smartphones');
    expect(screen.getByRole('link', { name: 'All Products' })).toHaveAttribute('href', '/products');
  });

  it('shows only All Products while categories load or fail, never guessed slugs', () => {
    vi.mocked(useCategories).mockReturnValue({ data: undefined, isPending: true } as unknown as ReturnType<typeof useCategories>);
    renderLinks();
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['All Products']);
  });
});
