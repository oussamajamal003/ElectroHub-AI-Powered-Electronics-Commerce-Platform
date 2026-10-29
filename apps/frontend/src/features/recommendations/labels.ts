import type { RecommendationSection } from './types';

export interface RailCopy { title: string; description: string }

/**
 * Customer-facing copy derived only from the server's strategy, so a heading can never claim more than the data behind
 * it: "Similar Products" only for learned-embedding results, "Recommended for You" only for a real personal profile,
 * "Frequently Bought Together" only for real co-purchases. Returns null for a section that must be hidden.
 */
export function railCopy(section: RecommendationSection): RailCopy | null {
  if (section.items.length === 0) return null;
  switch (section.strategy) {
    case 'EMBEDDING_SIMILARITY':
      return { title: 'Similar Products', description: 'Products that look alike, matched by our image model.' };
    case 'HYBRID_EMBEDDING':
      return { title: 'You May Also Like', description: 'Related picks from across the store, based on this product.' };
    case 'BEHAVIOR_EMBEDDING':
      return section.isPersonalized ? { title: 'Recommended for You', description: 'Based on products you viewed, saved and bought.' } : null;
    case 'CO_PURCHASE':
      return section.surface === 'cart'
        ? { title: 'Frequently Bought Together', description: 'Often ordered with items in your cart.' }
        : { title: 'Frequently Bought Together', description: 'Often ordered together with this product.' };
    case 'MEASURED_POPULARITY':
    case 'FALLBACK_POPULAR':
      return { title: 'Popular Products', description: 'In demand with shoppers over the last 30 days.' };
    case 'FALLBACK_CATEGORY':
      return section.context ? { title: `More in ${section.context.categoryName}`, description: 'Newest products in this category.' } : null;
    case 'FALLBACK_NEW_ARRIVALS':
      return { title: 'New Arrivals', description: 'The latest products in our store.' };
    default:
      return null;
  }
}
