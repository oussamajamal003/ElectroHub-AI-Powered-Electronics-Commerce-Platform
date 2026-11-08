import type { authApi } from '@/features/auth/api/auth';
import type { User } from '@/features/auth/types';
import type { CartData } from '@/features/cart/types';
import type { SavedPurchase } from '@/features/checkout/PaymentPurchases';
import type { RecommendationSection } from '@/features/recommendations/types';
import type { WishlistData } from '@/features/wishlist/types';

/**
 * Typed API payloads for Playwright fakes. `tests/` is not part of `npm run typecheck`; this file is, so a contract
 * change fails typecheck here instead of an E2E run failing for an unrelated reason. Keep it free of runtime imports:
 * Playwright loads it directly and does not resolve the '@/' alias (type imports are erased).
 */

/** sessionStorage key the session restore reads as the identity hint (features/auth/sessionRestore.ts). */
export const cachedUserKey = 'electrohub:cached-user';

/** POST /api/auth/customer/refresh after rotation: the token plus the identity, so restoring the session needs no /me. */
export const refreshedSession = (user: User, accessToken = 'browser-test-token'): Awaited<ReturnType<typeof authApi.refreshSession>> =>
  ({ accessToken, user });

/** POST /api/recommendations/cart without co-purchase evidence: the backend's NO_DATA section (recommendation.service noData). */
export const emptyCartRecommendations: { data: RecommendationSection } = { data: { mode: 'FREQUENTLY_BOUGHT_TOGETHER', surface: 'cart',
  strategy: 'NO_DATA', isPersonalized: false, isFallback: true, fallbackReason: 'INSUFFICIENT_SUPPORT', modelVersion: null,
  embeddingVersion: null, algorithmVersion: 'none', context: null, impressionToken: null, items: [] } };

/** GET /api/checkout/payment-attempts for a customer with no saved purchases. */
export const noSavedPurchases: { data: SavedPurchase[] } = { data: [] };

/** GET /api/wishlist and GET /api/cart for a signed-in customer with nothing saved. */
export const emptyWishlist: { data: WishlistData } = { data: { items: [], totalItems: 0 } };
export const emptyCart: { data: CartData } = { data: { revision: 'e2e-empty', items: [], totalQuantity: 0, subtotal: '0.00', shipping: '0.00',
  total: '0.00', currency: 'USD', canCheckout: false } };
