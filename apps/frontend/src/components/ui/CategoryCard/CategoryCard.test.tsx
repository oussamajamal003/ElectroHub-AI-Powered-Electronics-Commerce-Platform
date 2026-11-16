import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Category } from '@/features/products/types';
import { CategoryCard } from './CategoryCard';

const category: Category = { id: 'cameras', name: 'Cameras & Photography', slug: 'cameras-photography', description: null,
  imageUrl: '/images/catalog/expansion/category-cameras-photography.webp', productCount: 8 };
const renderCard = (overrides: Partial<Category> = {}) =>
  render(<MemoryRouter><CategoryCard category={{ ...category, ...overrides }} /></MemoryRouter>);

describe('CategoryCard', () => {
  it('links to the slug-filtered catalog and shows the live count', () => {
    renderCard();
    const link = screen.getByRole('link', { name: /Cameras & Photography/ });
    expect(link).toHaveAttribute('href', '/products?category=cameras-photography');
    expect(link).toHaveTextContent('8 products');
    expect(link.querySelector('img')).toHaveAttribute('src', category.imageUrl);
  });

  it('uses singular wording for one product', () => {
    renderCard({ productCount: 1 });
    expect(screen.getByText('1 product')).toBeInTheDocument();
  });

  it('replaces a missing or failed image with a neutral tile instead of a broken image', () => {
    const { container, unmount } = renderCard();
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('category-image-fallback')).toBeInTheDocument();
    unmount();
    renderCard({ imageUrl: null });
    expect(screen.getByTestId('category-image-fallback')).toBeInTheDocument();
  });
});
