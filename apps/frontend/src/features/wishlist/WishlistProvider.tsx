import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/AuthContext';
import { queryKeys } from '@/lib/query';
import { useSessionReadBootstrap } from '@/lib/useSessionReadBootstrap';
import { wishlistApi } from './api';
import { WishlistContext } from './context';
import { MAX_WISHLIST_ITEMS, readAuthenticatedWishlistCount, readAuthenticatedWishlistCountRevision, readWishlist, writeAuthenticatedWishlistCount, writeWishlist, WISHLIST_STORAGE_KEY } from './storage';
import type { ProductSummary } from '@/features/products/types';
import type { WishlistData, WishlistItem } from './types';

const EMPTY: WishlistData = { items: [], totalItems: 0 };
// Queries can outlive a StrictMode provider instance. Share only the in-flight
// owner guard so an abandoned stale read cannot replace an optimistic refresh hint.
const pendingAuthenticatedMutationOwners = new Set<string>();
type Intent = { saved: boolean; version: number };
type OptimisticProducts = { scope: string; items: Record<string, WishlistItem> };

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isSessionVerified, isLoggingOut: authLoggingOut, finishLogoutTransition } = useAuth();
  const location = useLocation();
  const logoutOrigin = useRef<string | null>(null);
  const logoutDeparted = useRef(false);
  if (authLoggingOut && logoutOrigin.current === null) logoutOrigin.current = location.pathname;
  if (authLoggingOut && logoutOrigin.current !== location.pathname) logoutDeparted.current = true;
  if (!authLoggingOut) { logoutOrigin.current = null; logoutDeparted.current = false; }
  const isLoggingOut = authLoggingOut && !logoutDeparted.current;
  useEffect(() => {
    if (authLoggingOut && !isAuthenticated && logoutDeparted.current) finishLogoutTransition();
  }, [authLoggingOut, isAuthenticated, location.pathname, finishLogoutTransition]);
  const client = useQueryClient();
  const countIdentity = isAuthenticated && user?.role === 'CUSTOMER' ? user.id : null;
  const identity = isSessionVerified ? countIdentity : null;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const observedIdentity = useRef(identity);
  const epochRef = useRef(0);
  if (observedIdentity.current !== identity) { observedIdentity.current = identity; epochRef.current++; }
  const [guestIds, setGuestIds] = useState(readWishlist);
  const readServerWishlist = useSessionReadBootstrap(wishlistApi.get, Boolean(countIdentity) && !authLoggingOut && guestIds.length === 0);
  const guestRef = useRef(guestIds);
  guestRef.current = guestIds;
  const [intents, setIntents] = useState<Record<string, Intent>>({});
  const intentRef = useRef<Record<string, Intent>>({});
  const documentLeaving = useRef(false);
  const [optimisticProducts, setOptimisticProducts] = useState<OptimisticProducts>({ scope: 'guest', items: {} });
  const draining = useRef(new Set<string>());
  const mergeFlight = useRef<string | null>(null);
  const attemptedMerge = useRef('');
  const previousIdentity = useRef(identity);
  const retained = useRef<WishlistData | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [unresolvedIds, setUnresolvedIds] = useState<string[]>([]);
  const [isMerging, setMerging] = useState(false);
  const [mergeApplied, setMergeApplied] = useState(false);
  useEffect(() => {
    const markLeaving = () => { documentLeaving.current = true; };
    const markActive = () => { documentLeaving.current = false; };
    window.addEventListener('beforeunload', markLeaving);
    window.addEventListener('pagehide', markLeaving);
    window.addEventListener('pageshow', markActive);
    return () => {
      window.removeEventListener('beforeunload', markLeaving);
      window.removeEventListener('pagehide', markLeaving);
      window.removeEventListener('pageshow', markActive);
    };
  }, []);
  const serverKey = queryKeys.wishlist.current(identity ?? 'unknown');
  const server = useQuery({ queryKey: serverKey, queryFn: async ({ signal }) => {
    const requestIdentity = identity;
    if (!requestIdentity) throw new Error('Wishlist identity is not ready.');
    const requestRevision = readAuthenticatedWishlistCountRevision(requestIdentity);
    const response = await readServerWishlist(signal);
    if (readAuthenticatedWishlistCountRevision(requestIdentity) !== requestRevision || Object.keys(intentRef.current).length > 0 || pendingAuthenticatedMutationOwners.has(requestIdentity)) {
      const latest = client.getQueryData<{ data: WishlistData }>(queryKeys.wishlist.current(requestIdentity));
      if (latest) return latest;
      // A read that finishes while an optimistic write is pending may predate
      // the mutation on the server. Let the mutation response publish authority.
      return response;
    }
    writeAuthenticatedWishlistCount(requestIdentity, response.data.totalItems);
    return response;
  }, staleTime: 30_000, enabled: Boolean(identity) && !isLoggingOut && (guestIds.length === 0 || Boolean(mergeError)) });
  const cachedAuthenticatedData = countIdentity
    ? client.getQueryData<{ data: WishlistData }>(queryKeys.wishlist.current(countIdentity))?.data
    : undefined;
  const guest = useQuery({ queryKey: queryKeys.wishlist.guest(JSON.stringify([...guestIds].sort())),
    queryFn: ({ signal }) => wishlistApi.validate(guestIds, signal), placeholderData: previous => previous,
    enabled: isSessionVerified && !identity && !isLoggingOut && guestIds.length > 0 });

  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === WISHLIST_STORAGE_KEY || event.key === null) setGuestIds(readWishlist()); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  useEffect(() => {
    if (previousIdentity.current === identity) return;
    previousIdentity.current = identity;
    intentRef.current = {};
    setIntents({});
    setOptimisticProducts({ scope: identity ?? 'guest', items: {} });
    setError(null);
    setMergeError(null);
    setUnresolvedIds([]);
    setMerging(false);
    setMergeApplied(false);
    mergeFlight.current = null;
    attemptedMerge.current = '';
    if (identity) retained.current = undefined;
  }, [identity]);

  const retryMerge = useCallback(async () => {
    if (!identity || mergeFlight.current === identity || isLoggingOut || !guestRef.current.length) return;
    if (Object.keys(intentRef.current).length) { setMergeError('Your wishlist is updating. Retry saved products once it finishes.'); return; }
    const snapshot = [...guestRef.current];
    const epoch = epochRef.current;
    attemptedMerge.current = `${identity}:${JSON.stringify(snapshot)}`;
    mergeFlight.current = identity;
    setMerging(true);
    setMergeApplied(false);
    setMergeError(null);
    try {
      await client.cancelQueries({ queryKey: queryKeys.wishlist.current(identity) });
      const response = await wishlistApi.reconcile(snapshot);
      if (identityRef.current !== identity || epochRef.current !== epoch) return;
      writeAuthenticatedWishlistCount(identity, response.data.totalItems);
      client.setQueryData(queryKeys.wishlist.current(identity), { data: response.data });
      retained.current = response.data;
      setMergeApplied(true);
      const rejected = new Set(response.data.unresolved.map(item => item.productId));
      const remaining = guestRef.current.filter(id => !snapshot.includes(id) || rejected.has(id));
      if (writeWishlist(remaining)) { guestRef.current = remaining; setGuestIds(remaining); }
      else setMergeError('Your wishlist was merged, but browser storage could not be updated. Retry safely.');
      setUnresolvedIds(response.data.unresolved.map(item => item.productId));
      attemptedMerge.current = `${identity}:${JSON.stringify(guestRef.current)}`;
      if (rejected.size) setMergeError('Some saved products are unavailable. Retry or remove them below.');
    } catch {
      if (identityRef.current === identity && epochRef.current === epoch) setMergeError('Your saved products could not be merged. They are still saved. Please retry.');
    } finally { if (epochRef.current === epoch) { if (mergeFlight.current === identity) mergeFlight.current = null; if (identityRef.current === identity) setMerging(false); } }
  }, [identity, client, isLoggingOut]);

  useEffect(() => {
    if (identity && guestIds.length && attemptedMerge.current !== `${identity}:${JSON.stringify(guestIds)}`) void retryMerge();
  }, [identity, guestIds, retryMerge]);

  const drain = async (owner: string) => {
    const epoch = epochRef.current;
    const drainKey = `${owner}:${epoch}`;
    if (draining.current.has(drainKey)) return;
    draining.current.add(drainKey);
    try {
      while (identityRef.current === owner && epochRef.current === epoch && Object.keys(intentRef.current).length) {
        const productId = Object.keys(intentRef.current)[0];
        if (!productId) break;
        const intent = intentRef.current[productId];
        if (!intent) continue;
        await client.cancelQueries({ queryKey: queryKeys.wishlist.current(owner) });
        try {
          const result = await (intent.saved ? wishlistApi.add(productId) : wishlistApi.remove(productId));
          if (identityRef.current !== owner || epochRef.current !== epoch) break;
          writeAuthenticatedWishlistCount(owner, result.data.totalItems);
          client.setQueryData(queryKeys.wishlist.current(owner), result);
        } catch {
          if (identityRef.current === owner && epochRef.current === epoch && intentRef.current[productId]?.version === intent.version) {
            // A hard refresh can abort the browser request after the server has
            // accepted the write. Keep the optimistic count hint for the next
            // document; its authenticated read will reconcile authoritatively.
            if (!documentLeaving.current) {
              // Roll the refresh hint back to the confirmed cache state, retaining
              // any other still-pending optimistic intents.
              const confirmed = client.getQueryData<{ data: WishlistData }>(queryKeys.wishlist.current(owner))?.data;
              if (confirmed) {
                const ids = new Set(confirmed.items.map(item => item.productId));
                for (const [pendingId, pendingIntent] of Object.entries(intentRef.current)) {
                  if (pendingId === productId && pendingIntent.version === intent.version) continue;
                  if (pendingIntent.saved) ids.add(pendingId); else ids.delete(pendingId);
                }
                writeAuthenticatedWishlistCount(owner, ids.size);
              } else {
                const optimisticCount = readAuthenticatedWishlistCount(owner);
                if (optimisticCount !== undefined) writeAuthenticatedWishlistCount(owner, Math.max(0, optimisticCount + (intent.saved ? -1 : 1)));
              }
              setError('Wishlist could not be updated. Your previous saved state was restored. Please retry.');
            }
          }
        }
        if (identityRef.current === owner && epochRef.current === epoch && intentRef.current[productId]?.version === intent.version) {
          delete intentRef.current[productId];
          setIntents({ ...intentRef.current });
        }
      }
    } finally { draining.current.delete(drainKey); pendingAuthenticatedMutationOwners.delete(owner); }
  };

  const base = !isSessionVerified ? undefined : identity ? server.data?.data : guestIds.length ? guest.data?.data : EMPTY;
  const scope = identity ?? 'guest';
  const optimisticItems = optimisticProducts.scope === scope ? optimisticProducts.items : {};
  const presentationIntents = previousIdentity.current === identity ? intents : {};
  let productIds = identity ? base?.items.map(item => item.productId) ?? [] : guestIds;
  for (const [productId, intent] of Object.entries(presentationIntents)) productIds = intent.saved ? [...new Set([...productIds, productId])] : productIds.filter(id => id !== productId);
  const toggle = (productId: string, product?: ProductSummary) => {
    if (!isSessionVerified || isLoggingOut || isMerging || (identity && guestRef.current.length && !attemptedMerge.current)) return;
    setError(null);
    const currentIds = identity ? (client.getQueryData<{ data: WishlistData }>(queryKeys.wishlist.current(identity))?.data.items.map(item => item.productId) ?? []) : guestRef.current;
    const currentlySaved = intentRef.current[productId]?.saved ?? currentIds.includes(productId);
    const intendedIds = new Set(currentIds);
    for (const [id, intent] of Object.entries(intentRef.current)) { if (intent.saved) intendedIds.add(id); else intendedIds.delete(id); }
    const count = intendedIds.size;
    if (!currentlySaved && count >= MAX_WISHLIST_ITEMS) { setError('You can save up to 50 products.'); return; }
    if (!identity) {
      const next = currentlySaved ? currentIds.filter(id => id !== productId) : [...currentIds, productId];
      if (!writeWishlist(next)) { setError('Your browser could not save this wishlist. Please try again.'); return; }
      guestRef.current = next;
      setGuestIds(next);
      if (product) setOptimisticProducts(current => ({ scope, items: { ...(current.scope === scope ? current.items : {}), [productId]: { productId, product, availability: product.availability === 'AVAILABLE' ? 'AVAILABLE' : 'OUT_OF_STOCK' } } }));
      else if (currentlySaved) setOptimisticProducts(current => { const items = { ...(current.scope === scope ? current.items : {}) }; delete items[productId]; return { scope, items }; });
    } else {
      const saved = !currentlySaved;
      // Persist the visible optimistic count synchronously, before starting the
      // request, so a hard refresh cannot resurrect the pre-click skeleton count.
      if (!writeAuthenticatedWishlistCount(identity, count + (saved ? 1 : -1))) {
        setError('Your browser could not save this wishlist state. Please try again.');
        return;
      }
      pendingAuthenticatedMutationOwners.add(identity);
      intentRef.current[productId] = { saved, version: (intentRef.current[productId]?.version ?? 0) + 1 };
      setIntents({ ...intentRef.current });
      if (product && !currentlySaved) setOptimisticProducts(current => ({ scope, items: { ...(current.scope === scope ? current.items : {}), [productId]: { productId, product, availability: product.availability === 'AVAILABLE' ? 'AVAILABLE' : 'OUT_OF_STOCK' } } }));
      else if (currentlySaved) setOptimisticProducts(current => { const items = { ...(current.scope === scope ? current.items : {}) }; delete items[productId]; return { scope, items }; });
      void drain(identity);
    }
  };
  const itemsById = new Map((base?.items ?? []).map(item => [item.productId, item]));
  for (const [productId, item] of Object.entries(optimisticItems)) if (!itemsById.has(productId)) itemsById.set(productId, item);
  const resolvedItems = productIds.flatMap(productId => { const item = itemsById.get(productId); return item ? [item] : []; });
  const data = base || resolvedItems.length ? { items: resolvedItems, totalItems: productIds.length } : undefined;
  if (identity && data && !isMerging) retained.current = data;
  const transition = identity && guestIds.length > 0 && !attemptedMerge.current;
  const mergePending = (transition || isMerging) && !mergeApplied;
  const visible = isLoggingOut ? retained.current : mergePending ? undefined : data;
  const expectedCount = transition || isMerging
    ? server.data ? new Set([...server.data.data.items.map(item => item.productId), ...guestIds]).size
      : countIdentity ? readAuthenticatedWishlistCount(countIdentity) : undefined
    : countIdentity
      ? data?.totalItems ?? cachedAuthenticatedData?.totalItems ?? readAuthenticatedWishlistCount(countIdentity)
      : productIds.length;
  const activeQuery = identity ? server : guest;
  const missingDetails = !data || productIds.some(id => !itemsById.has(id));
  // Both modes wait only for missing item data, never for a background read
  // when all current cards are already usable.
  const isLoading = !isSessionVerified || Boolean(mergePending) ||
    (!activeQuery.isError && missingDetails && (activeQuery.isPending || activeQuery.isFetching || activeQuery.isPlaceholderData));
  const totalItems = isLoggingOut ? retained.current?.totalItems ?? 0
    : mergePending || !data ? expectedCount ?? 0 : data.totalItems;
  return <WishlistContext.Provider value={{ data: visible, expectedCount, productIds: isLoggingOut ? retained.current?.items.map(item => item.productId) ?? [] : productIds,
    totalItems,
    isLoading,
    isError: identity ? server.isError : guest.isError, isLoggingOut, isMerging, error, mergeError,
    unresolved: identity ? unresolvedIds : [], pending: [...new Set([...Object.keys(presentationIntents), ...(!identity ? guestIds.filter(id => !base?.items.some(item => item.productId === id) && !optimisticItems[id]) : [])])], toggle,
    retry: async () => { await (identity ? server.refetch() : guest.refetch()); }, retryMerge,
    discardGuest: productId => { const next = guestRef.current.filter(id => id !== productId); if (writeWishlist(next)) { guestRef.current = next; setGuestIds(next); setUnresolvedIds(ids => ids.filter(id => id !== productId)); if (!next.length) setMergeError(null); } else setError('Browser storage could not be updated.'); },
  }}>{children}</WishlistContext.Provider>;
}
