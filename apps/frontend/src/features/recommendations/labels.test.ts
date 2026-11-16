import { describe, expect, it } from 'vitest';
import type { ProductSummary } from '@/features/products/types';
import { railCopy } from './labels';
import type { RecommendationSection, RecommendationStrategy } from './types';

const product: ProductSummary = {
  id: 'sample-1',
  name: 'Sample Laptop 13',
  description: null,
  slug: 'sample-laptop-13',
  price: '100.00',
  compareAtPrice: null,
  discountPercent: null,
  averageRating: null,
  reviewCount: 0,
  currency: 'USD',
  availability: 'AVAILABLE',
  category: { id: 'sample-category', name: 'Laptops', slug: 'laptops' },
  brand: null,
  primaryImage: null,
};

function section(overrides: Partial<RecommendationSection> = {}): RecommendationSection {
  return {
    mode: 'SIMILAR_PRODUCTS',
    surface: 'product_detail',
    strategy: 'EMBEDDING_SIMILARITY',
    isPersonalized: false,
    isFallback: false,
    fallbackReason: null,
    modelVersion: null,
    embeddingVersion: null,
    algorithmVersion: 'test-v1',
    context: null,
    impressionToken: null,
    items: [{ rank: 1, product }],
    ...overrides,
  };
}

describe('railCopy', () => {
  it.each<RecommendationStrategy>([
    'EMBEDDING_SIMILARITY', 'HYBRID_EMBEDDING', 'BEHAVIOR_EMBEDDING', 'CO_PURCHASE', 'MEASURED_POPULARITY',
    'FALLBACK_CATEGORY', 'FALLBACK_POPULAR', 'FALLBACK_NEW_ARRIVALS', 'NO_DATA',
  ])('returns null for an empty item list (%s)', strategy => {
    expect(railCopy(section({
      strategy,
      items: [],
      context: { categoryName: 'Laptops', categorySlug: 'laptops' },
      isPersonalized: true,
    }))).toBeNull();
  });

  it('returns null for NO_DATA even when items are present', () => {
    expect(railCopy(section({ strategy: 'NO_DATA' }))).toBeNull();
  });

  it('returns null for an unknown strategy (default branch)', () => {
    expect(railCopy(section({ strategy: 'UNKNOWN_STRATEGY' as RecommendationStrategy }))).toBeNull();
  });

  it('labels learned-embedding similarity as Similar Products', () => {
    expect(railCopy(section({ strategy: 'EMBEDDING_SIMILARITY' }))).toEqual({
      title: 'Similar Products',
      description: 'Products that look alike, matched by our image model.',
    });
  });

  it('labels hybrid embedding results as You May Also Like', () => {
    expect(railCopy(section({ strategy: 'HYBRID_EMBEDDING' }))).toEqual({
      title: 'You May Also Like',
      description: 'Related picks from across the store, based on this product.',
    });
  });

  it('hides a behavior-embedding section that is not personalized', () => {
    expect(railCopy(section({ strategy: 'BEHAVIOR_EMBEDDING', isPersonalized: false }))).toBeNull();
  });

  it('labels a personalized behavior-embedding section as Recommended for You', () => {
    expect(railCopy(section({ strategy: 'BEHAVIOR_EMBEDDING', isPersonalized: true }))).toEqual({
      title: 'Recommended for You',
      description: 'Based on products you viewed, saved and bought.',
    });
  });

  it('uses product-detail copy for co-purchases shown on a product page', () => {
    expect(railCopy(section({ strategy: 'CO_PURCHASE', surface: 'product_detail' }))).toEqual({
      title: 'Frequently Bought Together',
      description: 'Often ordered together with this product.',
    });
  });

  it('uses cart copy for co-purchases shown in the cart', () => {
    expect(railCopy(section({ strategy: 'CO_PURCHASE', surface: 'cart' }))).toEqual({
      title: 'Frequently Bought Together',
      description: 'Often ordered with items in your cart.',
    });
  });

  it.each<RecommendationStrategy>(['MEASURED_POPULARITY', 'FALLBACK_POPULAR'])('labels %s as Popular Products', strategy => {
    expect(railCopy(section({ strategy }))).toEqual({
      title: 'Popular Products',
      description: 'In demand with shoppers over the last 30 days.',
    });
  });

  it('labels a category fallback with the category name from context', () => {
    expect(railCopy(section({
      strategy: 'FALLBACK_CATEGORY',
      context: { categoryName: 'Headphones', categorySlug: 'headphones' },
    }))).toEqual({
      title: 'More in Headphones',
      description: 'Newest products in this category.',
    });
  });

  it('hides a category fallback that has no category context', () => {
    expect(railCopy(section({ strategy: 'FALLBACK_CATEGORY', context: null }))).toBeNull();
  });

  it('labels new-arrival fallbacks as New Arrivals', () => {
    expect(railCopy(section({ strategy: 'FALLBACK_NEW_ARRIVALS' }))).toEqual({
      title: 'New Arrivals',
      description: 'The latest products in our store.',
    });
  });
});
