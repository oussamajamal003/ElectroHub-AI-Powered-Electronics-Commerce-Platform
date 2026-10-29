import type { ProductSummary } from '@/features/products/types';

/** Task 04.4 public recommendation contract (Express `recommendation.service.ts`). */
export type RecommendationMode = 'SIMILAR_PRODUCTS' | 'YOU_MAY_ALSO_LIKE' | 'RECOMMENDED_FOR_YOU' | 'FREQUENTLY_BOUGHT_TOGETHER' | 'POPULAR_PRODUCTS';
export type RecommendationStrategy =
  | 'EMBEDDING_SIMILARITY' | 'BEHAVIOR_EMBEDDING' | 'HYBRID_EMBEDDING' | 'CO_PURCHASE' | 'MEASURED_POPULARITY'
  | 'FALLBACK_CATEGORY' | 'FALLBACK_POPULAR' | 'FALLBACK_NEW_ARRIVALS' | 'NO_DATA';
export type RecommendationSurface = 'product_detail' | 'home' | 'cart';

export interface RecommendationSection {
  mode: RecommendationMode;
  surface: RecommendationSurface;
  strategy: RecommendationStrategy;
  isPersonalized: boolean;
  isFallback: boolean;
  fallbackReason: string | null;
  modelVersion: string | null;
  embeddingVersion: string | null;
  algorithmVersion: string;
  context: { categoryName: string; categorySlug: string } | null;
  impressionToken: string | null;
  items: { rank: number; product: ProductSummary }[];
}

export interface ProductRecommendations { sections: RecommendationSection[] }
export interface PersonalRecommendations extends RecommendationSection {
  profile: { featureSpecVersion: string; signalCount: number; watermark: string } | null;
}
export interface RecommendationPreferences { personalizationEnabled: boolean; updatedAt: string | null }
export interface RecentlyViewed { personalizationEnabled: boolean; items: ProductSummary[] }
