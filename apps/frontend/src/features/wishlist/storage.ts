export const WISHLIST_STORAGE_KEY = 'electrohub.wishlist.v1';
export const MAX_WISHLIST_ITEMS = 50;
const AUTHENTICATED_COUNT_STORAGE_PREFIX = 'electrohub.wishlist.auth-count.v1:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface AuthenticatedCountMetadata { version: 1; count: number; revision: number }

function authenticatedCountKey(userId: string): string | null {
  return userId.trim() ? `${AUTHENTICATED_COUNT_STORAGE_PREFIX}${encodeURIComponent(userId)}` : null;
}

export function normalizeWishlist(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('productIds' in value) || !Array.isArray(value.productIds)) return [];
  return [...new Set(value.productIds.filter((id): id is string => typeof id === 'string' && uuid.test(id))
    .map(id => id.toLowerCase()))].slice(0, MAX_WISHLIST_ITEMS);
}
export function readWishlist(): string[] {
  try { return normalizeWishlist(JSON.parse(localStorage.getItem(WISHLIST_STORAGE_KEY) ?? 'null')); } catch { return []; }
}
export function writeWishlist(productIds: string[]): boolean {
  if (productIds.length > MAX_WISHLIST_ITEMS || productIds.some(id => !uuid.test(id)) || new Set(productIds).size !== productIds.length) return false;
  try {
    if (productIds.length) localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify({ productIds }));
    else localStorage.removeItem(WISHLIST_STORAGE_KEY);
    return true;
  } catch { return false; }
}

function readAuthenticatedWishlistCountMetadata(userId: string): AuthenticatedCountMetadata | undefined {
  const key = authenticatedCountKey(userId);
  if (!key) return undefined;
  try {
    const value = sessionStorage.getItem(key);
    if (value === null) return undefined;
    if (/^\d+$/.test(value)) {
      const count = Number(value);
      if (Number.isSafeInteger(count) && count <= MAX_WISHLIST_ITEMS) return { version: 1, count, revision: 0 };
      return undefined;
    }
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const metadata = parsed as Partial<AuthenticatedCountMetadata>;
    if (metadata.version !== 1 || !Number.isSafeInteger(metadata.count) || metadata.count! < 0 || metadata.count! > MAX_WISHLIST_ITEMS ||
      !Number.isSafeInteger(metadata.revision) || metadata.revision! < 0) return undefined;
    return metadata as AuthenticatedCountMetadata;
  } catch { return undefined; }
}

export function readAuthenticatedWishlistCount(userId: string): number | undefined {
  return readAuthenticatedWishlistCountMetadata(userId)?.count;
}

export function readAuthenticatedWishlistCountRevision(userId: string): number {
  return readAuthenticatedWishlistCountMetadata(userId)?.revision ?? 0;
}

export function writeAuthenticatedWishlistCount(userId: string, count: number): boolean {
  const key = authenticatedCountKey(userId);
  if (!key || !Number.isSafeInteger(count) || count < 0 || count > MAX_WISHLIST_ITEMS) return false;
  try {
    const revision = Math.max(Date.now(), (readAuthenticatedWishlistCountMetadata(userId)?.revision ?? 0) + 1);
    sessionStorage.setItem(key, JSON.stringify({ version: 1, count, revision } satisfies AuthenticatedCountMetadata));
    return true;
  } catch { return false; }
}
