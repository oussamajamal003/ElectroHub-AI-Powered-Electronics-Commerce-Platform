export function getProductGridSkeletonCount(pageSize: number) {
  return Math.min(10, Math.max(1, Math.floor(Number.isFinite(pageSize) ? pageSize : 10)));
}
