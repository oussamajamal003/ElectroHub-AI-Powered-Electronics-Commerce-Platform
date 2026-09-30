import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import { ProductGallery } from '@/components/ui/ProductGallery';
import { Rating } from '@/components/ui/Rating';
import { ProductCard, ProductCardSkeleton } from '@/components/ui/ProductCard';
import { CategoryCard } from '@/components/ui/CategoryCard';
import { Price } from '@/components/ui/Price';
import { productCardProps } from '@/features/search/api';
import type { ProductSummary } from './types';

const fixture: ProductSummary = {
  id: 'catalog-story-product', name: 'Apple MacBook Air 13 M3 8GB 256GB', slug: 'apple-macbook-air-13-m3',
  description: 'A lightweight laptop built for everyday work and creativity.',
  price: '899.00', compareAtPrice: '999.00', discountPercent: 10, averageRating: '4.6', reviewCount: 24,
  currency: 'USD', availability: 'AVAILABLE',
  brand: { id: 'apple', name: 'Apple', slug: 'apple' },
  category: { id: 'laptops', name: 'Laptops', slug: 'laptops' },
  primaryImage: { id: 'front', url: '/images/catalog/laptops.jpg', altText: 'Representative laptop studio photograph', sortOrder: 0, isPrimary: true },
};

function CatalogState({ state }: { state: 'gallery' | 'pricing' | 'rating' | 'category' | 'specifications' | 'review' | 'loading' }) {
  if (state === 'gallery') return <div style={{ maxWidth: 560 }}><ProductGallery images={[
    { id: 'front', src: '/images/catalog/laptops.jpg', alt: 'Laptop front illustration' },
    { id: 'detail', src: '/images/catalog/laptops-detail.jpg', alt: 'Laptop alternate studio view' },
  ]} /></div>;
  if (state === 'pricing') return <Price currentPrice={899} originalPrice={999} />;
  if (state === 'rating') return <Rating value={4.6} reviewCount={24} />;
  if (state === 'category') return <div style={{ width: 260 }}><CategoryCard category={{ id: 'laptops', name: 'Laptops', slug: 'laptops', description: null,
    imageUrl: '/images/catalog/laptops.jpg', productCount: 20 }} /></div>;
  if (state === 'specifications') return <section><h3>Performance</h3><dl><dt>Chip</dt><dd>Apple M3</dd><dt>Memory</dt><dd>8GB unified</dd></dl></section>;
  if (state === 'review') return <article><strong>Catalog Reviewer 01</strong><p>★★★★★</p><p>A deterministic component-review example.</p></article>;
  return <div style={{ maxWidth: 320 }}><ProductCardSkeleton /></div>;
}

const meta = { title: 'Catalog/States', component: CatalogState, args: { state: 'gallery' },
  decorators: [Story => <MemoryRouter><Story /></MemoryRouter>] } satisfies Meta<typeof CatalogState>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Gallery: Story = { args: { state: 'gallery' } };
export const Pricing: Story = { args: { state: 'pricing' } };
export const RatingSummary: Story = { args: { state: 'rating' } };
export const CategoryEntry: Story = { args: { state: 'category' } };
export const Specifications: Story = { args: { state: 'specifications' } };
export const Review: Story = { args: { state: 'review' } };
export const Loading: Story = { args: { state: 'loading' } };
export const Product: Story = { render: () => <div style={{ maxWidth: 320 }}><ProductCard {...productCardProps(fixture)} /></div> };
