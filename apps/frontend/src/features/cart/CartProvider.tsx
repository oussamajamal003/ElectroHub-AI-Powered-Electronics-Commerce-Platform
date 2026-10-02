import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { useAuth } from '@/features/auth/context/AuthContext';
import { MAX_CART_LINES, MAX_CART_QUANTITY, clearGuestCart, readGuestCart, writeGuestCart } from './storage';
import type { CartData, CartInputItem } from './types';
import { CartContext } from './context';
const EMPTY_CART: CartData = { items: [], totalQuantity: 0, subtotal: '0.00', shipping: '0.00', total: '0.00', currency: 'USD', canCheckout: false };

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
      availability: item.availability === 'LOW_STOCK' && quantity <= item.availableQuantity ? 'AVAILABLE' as const : item.availability };
  });
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotalCents = items.reduce((sum, item) => sum + (item.lineTotal === null ? 0 : Math.round(Number(item.lineTotal) * 100)), 0);
  const subtotal = (subtotalCents / 100).toFixed(2);
  return { ...data, items, totalQuantity, subtotal, total: subtotal,
    canCheckout: items.length > 0 && items.every(item => item.availability === 'AVAILABLE') };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isSessionVerified, isLoggingOut } = useAuth();
  const client = useQueryClient();
  const [guestItems, setGuestItems] = useState(readGuestCart);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergedForUser, setMergedForUser] = useState<string | null>(null);
  const [isMutating, setMutating] = useState(false);
  const [isReconciling, setReconciling] = useState(false);
  const [pendingQuantities, setPendingQuantities] = useState<Record<string, number>>({});
  const [pendingRemovals, setPendingRemovals] = useState<Record<string, true>>({});
  const pendingQuantitiesRef = useRef<Record<string, number>>({});
  const pendingRemovalsRef = useRef<Record<string, true>>({});
  const pendingQuantityVersions = useRef<Record<string, number>>({});
  const mergeInFlight = useRef(false);
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const lastServerCart = useRef<CartData | undefined>(undefined);
  const identityRef = useRef(user?.id ?? null);
  const previousIdentityRef = useRef(user?.id ?? null);
  identityRef.current = user?.id ?? null;
  const authenticated = isSessionVerified && isAuthenticated && Boolean(user);
  const guest = isSessionVerified && !isAuthenticated;
  const guestKey = JSON.stringify(guestItems);
  const serverKey = queryKeys.cart.current(user?.id ?? 'unknown');

  useEffect(() => {
    const identity = user?.id ?? null;
    if (previousIdentityRef.current === identity) return;
    if (identity) lastServerCart.current = undefined;
    previousIdentityRef.current = identity;
    pendingQuantitiesRef.current = {};
    pendingQuantityVersions.current = {};
    setPendingQuantities({});
    setMergeError(null);
    setMergedForUser(null);
  }, [user?.id]);

  useEffect(() => {
    const sync = () => setGuestItems(readGuestCart());
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const serverQuery = useQuery({ queryKey: serverKey,
    queryFn: ({ signal }) => apiClient<{ data: CartData }>('/api/cart', { signal }),
    enabled: authenticated, staleTime: 30_000 });
  if (authenticated && serverQuery.data?.data) lastServerCart.current = serverQuery.data.data;
  const guestQuery = useQuery({ queryKey: queryKeys.cart.guest(guestKey),
    queryFn: ({ signal }) => apiClient<{ data: CartData }>('/api/cart/validate', { method: 'POST', data: { items: guestItems }, signal }),
    enabled: guest && guestItems.length > 0, staleTime: 15_000 });

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
        if (identityRef.current === requestUserId) client.setQueryData(queryKeys.cart.current(requestUserId), response);
      } finally { setMutating(false); }
    });
    mutationQueue.current = operation;
    return operation;
  };

  const enqueueGuest = (operation: () => Promise<void>) => {
    const pending = mutationQueue.current.catch(() => undefined).then(async () => {
      if (identityRef.current) throw new Error('Session changed. Please try again.');
      setMutating(true);
      try { await operation(); }
      finally { setMutating(false); }
    });
    mutationQueue.current = pending;
    return pending;
  };

  const addItem = async (productId: string, quantity = 1) => {
    if (!isSessionVerified) throw new Error('Checking your session. Please try again.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_QUANTITY) throw new Error('Invalid quantity.');
    if (authenticated) return enqueueServer('/api/cart/items', 'POST', { productId, quantity });
    return enqueueGuest(async () => {
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
    });
  };

  const setQuantity = async (productId: string, quantity: number) => {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_QUANTITY) throw new Error('Invalid quantity.');
    pendingQuantitiesRef.current = { ...pendingQuantitiesRef.current, [productId]: quantity };
    const version = (pendingQuantityVersions.current[productId] ?? 0) + 1;
    pendingQuantityVersions.current = { ...pendingQuantityVersions.current, [productId]: version };
    setPendingQuantities(pendingQuantitiesRef.current);

    const operation = authenticated ? enqueueServer(`/api/cart/items/${encodeURIComponent(productId)}`, 'PATCH', { quantity }) : enqueueGuest(async () => {
      const next = readGuestCart().map(item => item.productId === productId ? { ...item, quantity } : item);
      const response = await apiClient<{ data: CartData }>('/api/cart/validate', { method: 'POST', data: { items: next } });
      const changed = response.data.items.find(item => item.productId === productId);
      if (changed?.availability !== 'AVAILABLE') throw new Error(changed?.availability === 'LOW_STOCK' ? `Only ${changed.availableQuantity} ${changed.availableQuantity === 1 ? 'item is' : 'items are'} currently available.` : 'Product is unavailable.');
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

  const authoritativeData = authenticated ? serverQuery.data?.data : guest ? guestItems.length ? guestQuery.data?.data : EMPTY_CART : undefined;
  const transitioningData = isLoggingOut ? serverQuery.data?.data ?? lastServerCart.current : undefined;
  const awaitingGuestMerge = authenticated && guestItems.length > 0 && !mergeError && mergedForUser !== user?.id;
  const hidePreMergeCart = awaitingGuestMerge || (isReconciling && mergedForUser !== user?.id);
  const visibleData = authenticated ? (hidePreMergeCart ? undefined : authoritativeData) : isLoggingOut ? transitioningData : guest ? guestItems.length ? guestQuery.data?.data : EMPTY_CART : undefined;
  const removedData = Object.keys(pendingRemovals).reduce<CartData | undefined>((current, productId) => withoutCartItem(current, productId), visibleData);
  const data = withPendingQuantities(removedData, pendingQuantities);
  const retry = async () => { if (authenticated) await serverQuery.refetch(); else if (guest) await guestQuery.refetch(); };

  return <CartContext.Provider value={{ data, totalQuantity: authenticated ? data?.totalQuantity ?? 0 : guest ? data?.totalQuantity ?? guestItems.reduce((sum, item) => sum + item.quantity, 0) : 0,
    isGuest: guest && !isLoggingOut, isLoggingOut, isLoading: !isSessionVerified || isLoggingOut || (authenticated ? serverQuery.isPending || hidePreMergeCart : guest && guestItems.length > 0 && guestQuery.isPending),
    isError: authenticated ? serverQuery.isError : guest && guestItems.length > 0 && guestQuery.isError,
    isMutating, pendingProductIds: Object.keys(pendingQuantities), pendingRemoveProductIds: Object.keys(pendingRemovals), mergeError, pendingGuestItems: authenticated ? guestItems : [], addItem, setQuantity, removeItem, retry, retryMerge, removePendingGuestItem }}>
    {children}
  </CartContext.Provider>;
}
