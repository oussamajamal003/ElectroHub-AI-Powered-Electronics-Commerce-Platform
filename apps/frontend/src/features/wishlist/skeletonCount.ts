const LOADING_WISHLIST_SKELETON_COUNT = 1;

export function getWishlistSkeletonCount(expectedCount: number | undefined) {
  const count = expectedCount !== undefined && Number.isFinite(expectedCount) && expectedCount >= 0
    ? Math.floor(expectedCount)
    : LOADING_WISHLIST_SKELETON_COUNT;
  return Math.min(10, Math.max(LOADING_WISHLIST_SKELETON_COUNT, count));
}
