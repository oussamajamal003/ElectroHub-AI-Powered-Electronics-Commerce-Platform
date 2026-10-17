import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, isAbortError } from '@/lib/api';
import { catalogSignal, queryKeys } from '@/lib/query';
import { useAuth } from '@/features/auth/context/AuthContext';
import { MAX_CART_LINES, MAX_CART_QUANTITY, clearGuestCart, readAuthenticatedCartCount, readGuestCart, writeAuthenticatedCartCount, writeGuestCart } from './storage';
import type { CartData, CartInputItem } from './types';
import { CartContext } from './context';

const EMPTY_CART: CartData = { revision: '', items: [], totalQuantity: 0, subtotal: '0.00', shipping: '0.00', total: '0.00', currency: 'USD', canCheckout: false };
const readServerCart = (signal?: AbortSignal) => apiClient<{ data: CartData }>('/api/cart', { signal });

function withoutCartItem(data: CartData | undefined, productId: string): CartData | undefined {
  if (!data) return undefined;
  const items = data.items.filter(item => item.productId !== productId);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotalCents = items.reduce((sum, item) => sum + (item.lineTotal === null ? 0 : Math.round(Number(item.lineTotal) * 100)), 0);
  const subtotal = (subtotalCents / 100).toFixed(2);
  return { ...data, items, totalQuantity, subtotal, total: subtotal,
    canCheckout: items.length > 0 && items.every(item => item.availability === 'AVAILABLE') };
}

function withPendingQuantities(data: CartData | undefined, quantities: Record<string, number>): CartData | undefined {
  if (!data || Object.keys(quantities).length === 0) return data;
  const items = data.items.map(item => {
    const quantity = quantities[item.productId];
    if (quantity === undefined || !item.product) return item;
    const priceCents = Math.round(Number(item.product.price) * 100);
    return { ...item, quantity, lineTotal: ((priceCents * quantity) / 100).toFixed(2),
      availability: item.availability === 'LOW_STOCK' || item.availability === 'AVAILABLE'
        ? quantity > item.availableQuantity ? 'LOW_STOCK' as const : 'AVAILABLE' as const : item.availability };
  });
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotalCents = items.reduce((sum, item) => sum + (item.lineTotal === null ? 0 : Math.round(Number(item.lineTotal) * 100)), 0);
  const subtotal = (subtotalCents / 100).toFixed(2);
  return { ...data, items, totalQuantity, subtotal, total: subtotal,
    canCheckout: items.length > 0 && items.every(item => item.availability === 'AVAILABLE') };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isSessionVerified, isLoggingOut, sessionUnavailable, retrySession } = useAuth();
  const authenticated = Boolean(isSessionVerified && isAuthenticated && user?.role === 'CUSTOMER');
  const guest = isSessionVerified && !isAuthenticated;
  const client = useQueryClient();
  const [guestItems, setGuestItems] = useState(readGuestCart);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergedForUser, setMergedForUser] = useState<string | null>(null);
  const [isMutating, setMutating] = useState(false);
  const [isReconciling, setReconciling] = useState(false);
  const [pendingQuantities, setPendingQuantities] = useState<Record<string, number>>({});
  const [pendingRemovals, setPendingRemovals] = useState<Record<string, true>>({});
  const [pendingAdditions, setPendingAdditions] = useState<Record<string, number>>({});
  const pendingQuantitiesRef = useRef<Record<string, number>>({});
  const pendingRemovalsRef = useRef<Record<string, true>>({});
  const pendingAdditionsRef = useRef<Record<string, number>>({});
  const pendingAdditionBatches = useRef<Map<string, {
    targetQuantity: number;
    scheduled: boolean;
    resolvers: Array<() => void>;
    rejecters: Array<(err: unknown) => void>;
  }>>(new Map());
  const pendingQuantityVersions = useRef<Record<string, number>>({});
  const authoritativeMutationReady = useRef(0);
  const mergeInFlight = useRef(false);
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const lastServerCart = useRef<CartData | undefined>(undefined);
  const identityRef = useRef(user?.id ?? null);
  const previousIdentityRef = useRef(user?.id ?? null);
  identityRef.current = user?.id ?? null;
  const guestKey = JSON.stringify(guestItems);
  const serverKey = queryKeys.cart.current(user?.id ?? 'unknown');
  const cachedCartCount = user?.id ? readAuthenticatedCartCount(user.id) : undefined;

  useEffect(() => {
    const identity = user?.id ?? null;
    if (previousIdentityRef.current === identity) return;
    if (identity) lastServerCart.current = undefined;
    previousIdentityRef.current = identity;
    authoritativeMutationReady.current = 0;
    pendingQuantitiesRef.current = {};
    pendingQuantityVersions.current = {};
    pendingAdditionsRef.current = {};
    setPendingQuantities({});
    setPendingAdditions({});
    setMergeError(null);
    setMergedForUser(null);
  }, [user?.id]);

  useEffect(() => {
    const sync = () => setGuestItems(readGuestCart());
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const serverQuery = useQuery({
    queryKey: serverKey,
    queryFn: context => readServerCart(catalogSignal(context)),
    enabled: authenticated && !isLoggingOut,
    staleTime: 30_000,
  });
  if (authenticated && serverQuery.data?.data) {
    lastServerCart.current = serverQuery.data.data;
    if (user?.id) writeAuthenticatedCartCount(user.id, serverQuery.data.data.totalQuantity);
  }
  const guestQuery = useQuery({
    queryKey: queryKeys.cart.guest(guestKey),
    queryFn: ({ signal }) => apiClient<{ data: CartData }>('/api/cart/validate', { method: 'POST', data: { items: guestItems }, signal }),
    enabled: guest && !isLoggingOut && guestItems.length > 0,
    staleTime: 15_000,
  });
  const refetchServerCart = serverQuery.refetch;
  const refetchGuestCart = guestQuery.refetch;

  const retryMerge = useCallback(async () => {
    if (!authenticated || !user || guestItems.length === 0 || mergeInFlight.current) return;
    const requestUserId = user.id;
    mergeInFlight.current = true;
    setReconciling(true);
    setMergeError(null);
    setMergedForUser(null);
    try {
      let response: { data: CartData };
      try {
        response = await apiClient<{ data: CartData }>('/api/cart/reconcile', { method: 'POST', data: { items: guestItems } });
      } catch {
        response = await apiClient<{ data: CartData }>('/api/cart');
        if (!guestItems.every(item => (response.data.items.find(line => line.productId === item.productId)?.quantity ?? 0) >= item.quantity)) {
          throw new Error('Saved items were not merged.');
        }
      }
      if (identityRef.current !== requestUserId) return;
      await client.cancelQueries({ queryKey: queryKeys.cart.current(requestUserId) });
      if (identityRef.current !== requestUserId) return;
      client.setQueryData(queryKeys.cart.current(requestUserId), response, { updatedAt: Date.now() });
      setMergedForUser(requestUserId);
      if (!clearGuestCart()) {
        setMergeError('Your items were added, but saved items could not be cleared on this device. Retry to clear them.');
        return;
      }
      setGuestItems([]);
      setMergeError(null);
    } catch {
      if (identityRef.current === requestUserId) setMergeError('Your saved items could not be added. Remove unavailable saved items or retry.');
    } finally { mergeInFlight.current = false; setReconciling(false); }
  }, [authenticated, user, guestItems, client]);

  useEffect(() => {
    if (authenticated && !serverQuery.isPending && !isReconciling && guestItems.length > 0 && !mergeError) void retryMerge();
  }, [authenticated, serverQuery.isPending, isReconciling, guestItems.length, mergeError, retryMerge]);

  const saveGuest = (items: CartInputItem[]) => {
    if (!writeGuestCart(items)) throw new Error('Cart could not be saved on this device.');
    setGuestItems(items);
  };

  const enqueueServer = (path: string, method: 'POST' | 'PATCH' | 'DELETE', data?: object) => {
    const requestUserId = user?.id;
    const operation = mutationQueue.current.catch(() => undefined).then(async () => {
      if (!requestUserId || identityRef.current !== requestUserId) throw new Error('Session changed. Please try again.');
      setMutating(true);
      try {
        await client.cancelQueries({ queryKey: queryKeys.cart.current(requestUserId) });
        const response = await apiClient<{ data: CartData }>(path, { method, data });
        // A read started during the POST may predate its commit. Cancel that
        // observer before publishing the authoritative mutation snapshot.
        await client.cancelQueries({ queryKey: queryKeys.cart.current(requestUserId) });
        if (identityRef.current === requestUserId) {
          client.setQueryData(queryKeys.cart.current(requestUserId), response);
          writeAuthenticatedCartCount(requestUserId, response.data.totalQuantity);
          authoritativeMutationReady.current = Date.now();
        }
      } finally { setMutating(false); }
    });
    mutationQueue.current = operation.catch(() => undefined);
    return operation;
  };

  const enqueueGuest = (operation: () => Promise<void>) => {
    const pending = mutationQueue.current.catch(() => undefined).then(async () => {
      if (identityRef.current) throw new Error('Session changed. Please try again.');
      setMutating(true);
      try { await operation(); }
      finally { setMutating(false); }
    });
    mutationQueue.current = pending.catch(() => undefined);
    return pending;
  };

  const flushAdditionBatch = async (productId: string) => {
    const batch = pendingAdditionBatches.current.get(productId);
    if (!batch) return;
    pendingAdditionBatches.current.delete(productId);
    const batchQuantity = batch.targetQuantity;
    const resolvers = batch.resolvers;
    const rejecters = batch.rejecters;

    try {
      await enqueueServer('/api/cart/items', 'POST', { productId, quantity: batchQuantity });
      const next = { ...pendingAdditionsRef.current };
      next[productId] = Math.max(0, (next[productId] ?? 0) - batchQuantity);
      if (next[productId] === 0) delete next[productId];
      pendingAdditionsRef.current = next;
      setPendingAdditions(next);
      resolvers.forEach(res => res());
    } catch (error) {
      const next = { ...pendingAdditionsRef.current };
      next[productId] = Math.max(0, (next[productId] ?? 0) - batchQuantity);
      if (next[productId] === 0) delete next[productId];
      pendingAdditionsRef.current = next;
      setPendingAdditions(next);
      // Report the failure immediately; never hold the caller's "Adding…" state behind a cart read.
      rejecters.forEach(rej => rej(error));
      if (authenticated && user && identityRef.current === user.id && !client.getQueryData(queryKeys.cart.current(user.id))) {
        void refetchServerCart({ cancelRefetch: false });
      }
    }
  };

  const addItem = async (productId: string, quantity = 1) => {
    if (!isSessionVerified) throw new Error('Checking your session. Please try again.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_QUANTITY) throw new Error('Invalid quantity.');

    const currentLine = dataWithQuantities?.items.find(item => item.productId === productId);
    const currentPending = pendingAdditionsRef.current[productId] ?? 0;
    const nextTotal = (currentLine?.quantity ?? 0) + currentPending + quantity;
    if (nextTotal > MAX_CART_QUANTITY) throw new Error('Quantity is too large.');

    const currentLinesCount = (data?.items.length ?? 0) + (!currentLine && currentPending === 0 ? 1 : 0);
    if (!currentLine && currentPending === 0 && currentLinesCount > MAX_CART_LINES) throw new Error('Cart is full.');

    if (currentLine?.availableQuantity !== undefined && nextTotal > currentLine.availableQuantity) {
      const left = Math.max(0, currentLine.availableQuantity - ((currentLine.quantity ?? 0) + currentPending));
      throw new Error(left > 0 ? `Only ${left} ${left === 1 ? 'item is' : 'items are'} currently available.` : 'Product is unavailable.');
    }

    pendingAdditionsRef.current = {
      ...pendingAdditionsRef.current,
      [productId]: currentPending + quantity,
    };
    setPendingAdditions({ ...pendingAdditionsRef.current });

    if (!authenticated) {
      try {
        await enqueueGuest(async () => {
          const current = readGuestCart();
          const existing = current.find(item => item.productId === productId);
          if (!existing && current.length >= MAX_CART_LINES) throw new Error('Cart is full.');
          const nextQuantity = (existing?.quantity ?? 0) + quantity;
          if (nextQuantity > MAX_CART_QUANTITY) throw new Error('Quantity is too large.');
          const next = existing ? current.map(item => item.productId === productId ? { ...item, quantity: nextQuantity } : item) : [...current, { productId, quantity }];
          const response = await apiClient<{ data: CartData }>('/api/cart/validate', { method: 'POST', data: { items: next } });
          const changed = response.data.items.find(item => item.productId === productId);
          if (changed?.availability !== 'AVAILABLE') throw new Error(changed?.availability === 'LOW_STOCK' ? `Only ${changed.availableQuantity} ${changed.availableQuantity === 1 ? 'item is' : 'items are'} currently available.` : 'Product is unavailable.');
          saveGuest(next);
          client.setQueryData(queryKeys.cart.guest(JSON.stringify(next)), response);
          authoritativeMutationReady.current = Date.now();
        });
      } finally {
        const next = { ...pendingAdditionsRef.current };
        next[productId] = Math.max(0, (next[productId] ?? 0) - quantity);
        if (next[productId] === 0) delete next[productId];
        pendingAdditionsRef.current = next;
        setPendingAdditions(next);
      }
      return;
    }

    return new Promise<void>((resolve, reject) => {
      let batch = pendingAdditionBatches.current.get(productId);
      if (!batch) {
        batch = {
          targetQuantity: 0,
          scheduled: false,
          resolvers: [],
          rejecters: [],
        };
        pendingAdditionBatches.current.set(productId, batch);
      }
      batch.targetQuantity += quantity;
      batch.resolvers.push(resolve);
      batch.rejecters.push(reject);

      if (!batch.scheduled) {
        batch.scheduled = true;
        queueMicrotask(() => {
          void flushAdditionBatch(productId);
        });
      }
    });
  };

  const setQuantity = async (productId: string, quantity: number) => {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_QUANTITY) throw new Error('Invalid quantity.');
    pendingQuantitiesRef.current = { ...pendingQuantitiesRef.current, [productId]: quantity };
    const version = (pendingQuantityVersions.current[productId] ?? 0) + 1;
    pendingQuantityVersions.current = { ...pendingQuantityVersions.current, [productId]: version };
    setPendingQuantities(pendingQuantitiesRef.current);

    const operation = authenticated ? enqueueServer(`/api/cart/items/${encodeURIComponent(productId)}`, 'PATCH', { quantity }) : enqueueGuest(async () => {
      const current = readGuestCart();
      const currentQuantity = current.find(item => item.productId === productId)?.quantity;
      const isDecrease = currentQuantity !== undefined && quantity < currentQuantity;
      const next = current.map(item => item.productId === productId ? { ...item, quantity } : item);
      const response = await apiClient<{ data: CartData }>('/api/cart/validate', { method: 'POST', data: { items: next } });
      const changed = response.data.items.find(item => item.productId === productId);
      if (!isDecrease && changed?.availability !== 'AVAILABLE') throw new Error(changed?.availability === 'LOW_STOCK' ? `Only ${changed.availableQuantity} ${changed.availableQuantity === 1 ? 'item is' : 'items are'} currently available.` : 'Product is unavailable.');
      saveGuest(next);
      client.setQueryData(queryKeys.cart.guest(JSON.stringify(next)), response);
    });

    try {
      await operation;
    } finally {
      if (pendingQuantityVersions.current[productId] === version) {
        const remaining = { ...pendingQuantitiesRef.current };
        delete remaining[productId];
        pendingQuantitiesRef.current = remaining;
        const versions = { ...pendingQuantityVersions.current };
        delete versions[productId];
        pendingQuantityVersions.current = versions;
        setPendingQuantities(remaining);
      }
    }
  };

  const removeItem = async (productId: string) => {
    if (pendingRemovalsRef.current[productId]) return;
    if (authenticated) {
      pendingRemovalsRef.current = { ...pendingRemovalsRef.current, [productId]: true };
      setPendingRemovals(pendingRemovalsRef.current);
      try { await enqueueServer(`/api/cart/items/${encodeURIComponent(productId)}`, 'DELETE'); }
      finally {
        const remaining = { ...pendingRemovalsRef.current };
        delete remaining[productId];
        pendingRemovalsRef.current = remaining;
        setPendingRemovals(remaining);
      }
      return;
    }
    const stored = readGuestCart();
    const remaining = stored.filter(item => item.productId !== productId);
    if (remaining.length === stored.length) return;
    const nextData = withoutCartItem(guestQuery.data?.data, productId);
    if (!writeGuestCart(remaining)) throw new Error('Cart could not be saved on this device.');
    setGuestItems(remaining);
    if (nextData) client.setQueryData(queryKeys.cart.guest(JSON.stringify(remaining)), { data: nextData });
  };

  const removePendingGuestItem = (productId: string) => {
    saveGuest(guestItems.filter(item => item.productId !== productId));
    setMergeError(null);
  };

  async function submitCheckout<T>(operation: () => Promise<{ cart: CartData; result: T }>): Promise<T> {
    const requestUserId = user?.id;
    const purchase = mutationQueue.current.catch(() => undefined).then(async () => {
      if (!authenticated || !requestUserId || identityRef.current !== requestUserId) throw new Error('Session changed. Please sign in again.');
      setMutating(true);
      try {
        await client.cancelQueries({ queryKey: queryKeys.cart.current(requestUserId) });
        const response = await operation();
        if (identityRef.current !== requestUserId) throw new Error('Session changed. Restore your order after signing in.');
        await client.cancelQueries({ queryKey: queryKeys.cart.current(requestUserId) });
        client.setQueryData(queryKeys.cart.current(requestUserId), { data: response.cart });
        lastServerCart.current = response.cart;
        return response.result;
      } finally { setMutating(false); }
    });
    mutationQueue.current = purchase.catch(() => undefined);
    return purchase;
  }

  const authoritativeData = authenticated ? serverQuery.data?.data : guest ? guestItems.length ? guestQuery.data?.data : EMPTY_CART : undefined;
  const transitioningData = isLoggingOut ? serverQuery.data?.data ?? lastServerCart.current : undefined;
  const awaitingGuestMerge = authenticated && guestItems.length > 0 && !mergeError && mergedForUser !== user?.id;
  const hidePreMergeCart = awaitingGuestMerge || (isReconciling && mergedForUser !== user?.id);
  const visibleData = authenticated ? (hidePreMergeCart ? undefined : authoritativeData) : isLoggingOut ? transitioningData : guest ? guestItems.length ? guestQuery.data?.data : EMPTY_CART : undefined;
  const removedData = Object.keys(pendingRemovals).reduce<CartData | undefined>((current, productId) => withoutCartItem(current, productId), visibleData);
  const dataWithQuantities = withPendingQuantities(removedData, pendingQuantities);
  // Unconfirmed additions never enter the rendered Cart: the badge, Cart page and totals all come from the
  // same server-confirmed snapshot. Pending adds only drive the Add to Cart button's loading state.
  const data = dataWithQuantities;
  const isServerCartError = Boolean(serverQuery.error && !isAbortError(serverQuery.error));
  const isGuestCartError = Boolean(guestQuery.error && !isAbortError(guestQuery.error));

  useEffect(() => {
    if (authenticated && serverQuery.error && isAbortError(serverQuery.error)) {
      void refetchServerCart({ cancelRefetch: false });
    } else if (guest && guestItems.length > 0 && guestQuery.error && isAbortError(guestQuery.error)) {
      void refetchGuestCart({ cancelRefetch: false });
    }
  }, [authenticated, guest, guestItems.length, serverQuery.error, guestQuery.error, refetchServerCart, refetchGuestCart]);

  const retry = useCallback(async (options?: { onlyIfStale?: boolean }) => {
    // No session verdict yet: retry the bounded restore; Cart reads start once identity is known.
    if (!isSessionVerified && sessionUnavailable) { retrySession(); return; }
    if (options?.onlyIfStale) {
      const state = client.getQueryState(authenticated ? queryKeys.cart.current(user?.id ?? 'unknown') : queryKeys.cart.guest(guestKey));
      if (state?.fetchStatus === 'fetching' || (state?.status === 'success' && Date.now() - state.dataUpdatedAt < (authenticated ? 30_000 : 15_000))) return;
    }
    if (authenticated) await refetchServerCart({ cancelRefetch: false });
    else if (guest) await refetchGuestCart({ cancelRefetch: false });
  }, [authenticated, guest, client, user?.id, guestKey, refetchServerCart, refetchGuestCart, isSessionVerified, sessionUnavailable, retrySession]);

  const validateRoute = useCallback(async () => {
    // A successful mutation already returned the authoritative Cart snapshot.
    const mutationAt = authoritativeMutationReady.current;
    authoritativeMutationReady.current = 0;
    const state = client.getQueryState(authenticated ? queryKeys.cart.current(user?.id ?? 'unknown') : queryKeys.cart.guest(guestKey));
    if (mutationAt > 0 && Date.now() - mutationAt < (authenticated ? 30_000 : 15_000) && state?.status === 'success') return;
    if (authenticated) await refetchServerCart({ cancelRefetch: false });
    else if (guest) await refetchGuestCart({ cancelRefetch: false });
  }, [authenticated, guest, client, user?.id, guestKey, refetchServerCart, refetchGuestCart]);

  const fallbackQuantity = authenticated
    ? cachedCartCount ?? 0
    : guest
      ? guestItems.reduce((sum, item) => sum + item.quantity, 0)
      : user?.role === 'CUSTOMER'
        ? cachedCartCount ?? 0
        : guestItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalQuantity = data?.totalQuantity ?? fallbackQuantity;
  const isAddPending = Object.keys(pendingAdditions).length > 0;
  const pendingProductIds = [...new Set([...Object.keys(pendingQuantities), ...Object.keys(pendingAdditions)])];
  const isLoading = (!isSessionVerified && !sessionUnavailable) || isLoggingOut || (authenticated ? (!serverQuery.data && serverQuery.isPending) || hidePreMergeCart : guest && guestItems.length > 0 && guestQuery.isPending);

  return <CartContext.Provider value={{ data, totalQuantity,
    isGuest: guest && !isLoggingOut, isLoggingOut, isLoading,
    isError: (!isSessionVerified && sessionUnavailable) || (authenticated ? isServerCartError : guest && guestItems.length > 0 && isGuestCartError),
    isMutating: isMutating || isAddPending, isAddPending, pendingAdditions, pendingProductIds, pendingRemoveProductIds: Object.keys(pendingRemovals), mergeError, pendingGuestItems: authenticated ? guestItems : [], addItem, setQuantity, removeItem, retry, validateRoute, retryMerge, removePendingGuestItem, submitCheckout }}>
    {children}
  </CartContext.Provider>;
}
