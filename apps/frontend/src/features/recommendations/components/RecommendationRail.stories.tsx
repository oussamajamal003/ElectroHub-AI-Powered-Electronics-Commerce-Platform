import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import type { ProductSummary } from '@/features/products/types';
import { RecommendationRail } from './RecommendationRail';

// Obviously-sample catalog data for Storybook only; no real customer or merchant data.
const category = { id: 'sample-category-laptops', name: 'Sample Laptops', slug: 'sample-laptops' };

function sampleProduct(index: number, name: string, price: string): ProductSummary {
  return {
    id: `sample-product-${index}`,
    name,
    description: 'Sample product for component previews.',
    slug: `sample-product-${index}`,
    price,
    compareAtPrice: null,
    discountPercent: null,
    averageRating: null,
    reviewCount: 0,
    currency: 'USD',
    availability: 'AVAILABLE',
    stockStatus: 'IN_STOCK',
    availableQuantity: 8,
    purchasable: true,
    category,
    brand: null,
    primaryImage: {
      id: `sample-image-${index}`,
      url: '/images/catalog/laptops.jpg',
      altText: name,
      sortOrder: 0,
      isPrimary: true,
    },
  };
}

const fourProducts = [
  sampleProduct(1, 'Sample Laptop 13 Basic', '649.00'),
  sampleProduct(2, 'Sample Laptop 14 Plus', '799.00'),
  sampleProduct(3, 'Sample Laptop 15 Pro', '999.00'),
  sampleProduct(4, 'Sample Laptop 16 Studio', '1249.00'),
];

const twoProducts = fourProducts.slice(0, 2);

const meta = {
  title: 'Recommendations/RecommendationRail',
  component: RecommendationRail,
  decorators: [Story => <MemoryRouter><Story /></MemoryRouter>],
  args: {
    id: 'story-rail-title',
    title: 'Similar Products',
    description: 'Products that look alike, matched by our image model.',
    products: fourProducts,
    onAddToCart: async () => undefined,
    onToggleWishlist: () => undefined,
    onRetry: () => undefined,
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof RecommendationRail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ThreeColumns: Story = {
  args: {
    columns: 3,
    products: fourProducts.slice(0, 3),
  },
};

export const Loading: Story = {
  args: {
    products: [],
    loading: true,
    skeletonCount: 4,
  },
};

export const Unavailable: Story = {
  args: {
    products: [],
    error: true,
    onRetry: () => undefined,
  },
};

export const WithAction: Story = {
  args: {
    action: { href: '/categories/sample-laptops', label: 'View category' },
  },
};

export const FewItems: Story = {
  args: {
    products: twoProducts,
  },
};
