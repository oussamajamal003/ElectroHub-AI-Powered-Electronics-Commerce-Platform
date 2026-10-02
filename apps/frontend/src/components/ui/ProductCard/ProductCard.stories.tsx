import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProductCard } from './ProductCard';
import { productCardProps } from '@/features/search/api';
import type { ProductSummary } from '@/features/products/types';

const product: ProductSummary = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Apple MacBook Air 13 M3 8GB 256GB',
  description: 'A lightweight laptop built for everyday work and creativity.',
  slug: 'apple-macbook-air-13-m3',
  price: '999.00',
  compareAtPrice: null,
  discountPercent: null,
  averageRating: null,
  reviewCount: 0,
  currency: 'USD',
  availability: 'AVAILABLE',
  category: { id: '00000000-0000-4000-8000-000000000002', name: 'Laptops', slug: 'laptops' },
  brand: { id: '00000000-0000-4000-8000-000000000003', name: 'Apple', slug: 'apple' },
  primaryImage: {
    id: 'image-laptop-front',
    url: '/images/catalog/laptops.jpg',
    altText: 'Representative laptop studio photograph',
    sortOrder: 0,
    isPrimary: true,
  },
};

const meta = {
  title: 'Components/ProductCard',
  component: ProductCard,
  args: productCardProps(product),
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ProductCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongTitle: Story = {
  args: { title: 'Apple MacBook Air 13 M3 with a Demonstration Title Long Enough to Exercise Wrapping' },
};

export const Discounted: Story = { args: { ...productCardProps({ ...product,
  price: '899.00', compareAtPrice: '999.00', discountPercent: 10, averageRating: '4.6', reviewCount: 28 }) } };

export const NoReviews: Story = { args: { ...productCardProps(product), rating: null, reviewCount: 0 } };

export const Unavailable: Story = { args: { ...productCardProps({ ...product,
  availability: 'UNAVAILABLE', averageRating: null, reviewCount: 0 }) } };

export const OutOfStock: Story = { args: { ...productCardProps({ ...product, availability: 'UNAVAILABLE' }) } };

export const WithRatingAndActions: Story = {
  args: { ...productCardProps(product), rating: 4.8, showActions: true, onAddToCart: async () => undefined },
};
export const AddToCart: Story = { args: { ...productCardProps(product), onAddToCart: async () => undefined } };
export const Added: Story = { args: { ...productCardProps(product), onAddToCart: async () => undefined },
  play: async ({ canvasElement }) => { canvasElement.querySelector<HTMLButtonElement>('button[aria-label^="Add "]')?.click(); } };
export const AddPending: Story = { args: { ...productCardProps(product), onAddToCart: () => new Promise<void>(() => undefined) },
  play: async ({ canvasElement }) => { canvasElement.querySelector<HTMLButtonElement>('button[aria-label^="Add "]')?.click(); } };
