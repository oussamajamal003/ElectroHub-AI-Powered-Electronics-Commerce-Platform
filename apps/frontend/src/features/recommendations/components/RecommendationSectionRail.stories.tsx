import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import type { ProductSummary } from '@/features/products/types';
import type { RecommendationSection } from '../types';
import { RecommendationSectionRail } from './RecommendationSectionRail';

// Obviously-sample catalog data for Storybook only; the section is static, so no API is called.
const category = { id: 'sample-category-headphones', name: 'Sample Headphones', slug: 'sample-headphones' };

function sampleProduct(index: number, name: string, price: string): ProductSummary {
  return {
    id: `sample-section-product-${index}`,
    name,
    description: null,
    slug: `sample-section-product-${index}`,
    price,
    compareAtPrice: null,
    discountPercent: null,
    averageRating: null,
    reviewCount: 0,
    currency: 'USD',
    availability: 'AVAILABLE',
    stockStatus: 'IN_STOCK',
    availableQuantity: 5,
    purchasable: true,
    category,
    brand: null,
    primaryImage: {
      id: `sample-section-image-${index}`,
      url: '/images/catalog/headphones.jpg',
      altText: name,
      sortOrder: 0,
      isPrimary: true,
    },
  };
}

const items = [
  sampleProduct(1, 'Sample Headphones Studio', '189.00'),
  sampleProduct(2, 'Sample Headphones Commute', '129.00'),
  sampleProduct(3, 'Sample Headphones Sport', '89.00'),
];

function section(overrides: Partial<RecommendationSection>): RecommendationSection {
  return {
    mode: 'SIMILAR_PRODUCTS',
    surface: 'product_detail',
    strategy: 'EMBEDDING_SIMILARITY',
    isPersonalized: false,
    isFallback: false,
    fallbackReason: null,
    modelVersion: 'sample-model-v1',
    embeddingVersion: 'sample-embedding-v1',
    algorithmVersion: 'sample-algorithm-v1',
    context: null,
    impressionToken: null,
    items: items.map((product, index) => ({ rank: index + 1, product })),
    ...overrides,
  };
}

const meta = {
  title: 'Recommendations/RecommendationSectionRail',
  component: RecommendationSectionRail,
  decorators: [Story => <MemoryRouter><Story /></MemoryRouter>],
  args: {
    id: 'story-section-title',
    section: section({}),
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof RecommendationSectionRail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Similar: Story = {};

export const CategoryFallback: Story = {
  args: {
    section: section({
      mode: 'SIMILAR_PRODUCTS',
      strategy: 'FALLBACK_CATEGORY',
      isFallback: true,
      fallbackReason: 'sample-not-enough-signal',
      context: { categoryName: 'Sample Headphones', categorySlug: 'sample-headphones' },
    }),
  },
};

export const FrequentlyBoughtTogether: Story = {
  args: {
    section: section({
      mode: 'FREQUENTLY_BOUGHT_TOGETHER',
      strategy: 'CO_PURCHASE',
    }),
  },
};

/** NO_DATA has no copy, so the section renders nothing (no empty heading, no tracking). */
export const NoData: Story = {
  args: {
    section: section({ strategy: 'NO_DATA', items: [] }),
  },
};
