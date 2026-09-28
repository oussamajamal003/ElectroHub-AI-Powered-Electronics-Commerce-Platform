import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProductCard } from './ProductCard';
import { productCardProps } from '@/features/search/api';
import type { ProductSummary } from '@/features/products/types';

const product: ProductSummary = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Apple MacBook Air 13 M3 8GB 256GB',
  slug: 'apple-macbook-air-13-m3',
  price: '999.00',
  compareAtPrice: null,
  currency: 'USD',
  availability: 'AVAILABLE',
  category: { id: '00000000-0000-4000-8000-000000000002', name: 'Laptops', slug: 'laptops' },
  brand: { id: '00000000-0000-4000-8000-000000000003', name: 'Apple', slug: 'apple' },
  primaryImage: {
    id: 'image-laptop-front',
    url: '/images/products/laptops/front.svg',
    altText: 'Generic demo laptop illustration',
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

export const WithRatingAndActions: Story = {
  args: { ...productCardProps(product), rating: 4.8, showActions: true },
};
