import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { createQueryClient, queryKeys } from '@/lib/query';
import { useAuth } from '@/features/auth/context/AuthContext';
import { wishlistApi } from './api';
import { WishlistProvider } from './WishlistProvider';
import { useWishlist } from './context';
import { readAuthenticatedWishlistCount, writeAuthenticatedWishlistCount, writeWishlist, WISHLIST_STORAGE_KEY } from './storage';
import { wishlistProduct } from './fixtures';
import type { WishlistData } from './types';
vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./api', () => ({ wishlistApi: { get: vi.fn(), validate: vi.fn(), add: vi.fn(), remove: vi.fn(), reconcile: vi.fn() } }));
const first = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const second = '41f516ae-8385-4dcb-9a85-90b5dc9fe363';
const data = (ids: string[]): { data: WishlistData } => ({ data: { items: ids.map(productId => ({ productId, product: null, availability: 'UNAVAILABLE' })), totalItems: ids.length } });
const auth = (id: string | null, isLoggingOut = false, isSessionVerified = true) => {
  const customer = { id: id ?? 'owner', role: 'CUSTOMER', email: 'wishlist@example.invalid', firstName: 'Wish', lastName: 'Customer' };
  vi.mocked(useAuth).mockReturnValue({ isAuthenticated: Boolean(id), isSessionVerified, isLoggingOut,
    isLoading: false, isInitializing: false, rememberedUser: null,
    finishLogoutTransition: vi.fn(), clearSession: vi.fn(), finishGoogle: async () => undefined,
    login: async () => ({}), register: async () => ({}), verifyEmail: async () => ({}),
    updateProfile: async () => ({}), verifyEmailChange: async () => customer, logout: async () => undefined,
    user: id ? customer : null });
};
function setup(id: string | null = null, isSessionVerified = true) {
  auth(id, false, isSessionVerified); const client = createQueryClient(); client.setDefaultOptions({ queries: { retry: false } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter><QueryClientProvider client={client}><WishlistProvider>{children}</WishlistProvider></QueryClientProvider></MemoryRouter>;
  return { client, ...renderHook(() => useWishlist()!, { wrapper }) };
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear();
  vi.mocked(wishlistApi.validate).mockImplementation(async ids => data(ids));
  vi.mocked(wishlistApi.get).mockResolvedValue(data([]));
});
it('guest hearts change immediately, persist and synchronize cross-tab changes', async () => {
  const { result } = setup(); act(() => result.current.toggle(first));
  expect(result.current.productIds).toEqual([first]); expect(result.current.totalItems).toBe(1);
  writeWishlist([second]); act(() => window.dispatchEvent(new StorageEvent('storage', { key: WISHLIST_STORAGE_KEY })));
  expect(result.current.productIds).toEqual([second]);
  act(() => result.current.toggle(second)); expect(result.current.totalItems).toBe(0);
});
it('marks guest Products as pending until bulk hydration supplies current details', async () => {
  writeWishlist([first]);
  let finishHydration!: (value: { data: WishlistData }) => void;
  vi.mocked(wishlistApi.validate).mockImplementation(() => new Promise(resolve => { finishHydration = resolve; }));
  const { result } = setup();
  await waitFor(() => expect(finishHydration).toBeTypeOf('function'));
  expect(result.current.pending).toContain(first);
  await act(async () => finishHydration(data([first])));
  await waitFor(() => expect(result.current.pending).not.toContain(first));
});
it('adds a ProductSummary immediately to a usable guest Wishlist without a partial skeleton state', async () => {
  const addedProduct = { ...wishlistProduct, id: second, slug: 'second-product', name: 'Second product' };
  writeWishlist([first]);
  vi.mocked(wishlistApi.validate).mockImplementation(async ids => ({ data: { items: ids.map(productId => ({
    productId, product: productId === first ? wishlistProduct : null, availability: 'AVAILABLE' as const,
  })), totalItems: ids.length } }));
  const { result } = setup(); await waitFor(() => expect(result.current.data?.items[0]?.product?.id).toBe(first));
  act(() => result.current.toggle(second, addedProduct));
  expect(result.current.productIds).toEqual([first, second]);
  expect(result.current.isLoading).toBe(false);
  expect(result.current.data?.items.map(item => item.product?.name)).toEqual([wishlistProduct.name, addedProduct.name]);
  expect(result.current.pending).not.toContain(second);
});
it('rapid authenticated intents stay immediate and latest intent wins over a slow response', async () => {
  let resolveAdd!: (value: { data: WishlistData }) => void;
  vi.mocked(wishlistApi.add).mockImplementation(() => new Promise(resolve => { resolveAdd = resolve; }));
  vi.mocked(wishlistApi.remove).mockResolvedValue(data([]));
  const { result } = setup('owner'); await waitFor(() => expect(result.current.data).toBeDefined());
  act(() => result.current.toggle(first)); expect(result.current.productIds).toEqual([first]);
  await waitFor(() => expect(resolveAdd).toBeTypeOf('function'));
  act(() => result.current.toggle(first)); expect(result.current.totalItems).toBe(0);
  await act(async () => resolveAdd(data([first])));
  await waitFor(() => expect(wishlistApi.remove).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(result.current.pending).toEqual([])); expect(result.current.totalItems).toBe(0);
});
it('final intent failure rolls back only wishlist state', async () => {
  vi.mocked(wishlistApi.add).mockRejectedValue(new Error('private backend detail'));
  const { result, client } = setup('owner'); client.setQueryData(['cart', 'sentinel'], { unchanged: true });
  await waitFor(() => expect(result.current.data).toBeDefined());
  act(() => result.current.toggle(first));
  await waitFor(() => expect(result.current.error).toContain('restored'));
  expect(result.current.totalItems).toBe(0); expect(result.current.error).not.toContain('private');
  expect(client.getQueryData(['cart', 'sentinel'])).toEqual({ unchanged: true });
});
it('installs union cache before clearing storage and reconciles once', async () => {
  writeWishlist([first]); vi.mocked(wishlistApi.get).mockResolvedValue(data([second]));
  let resolveMerge!: (value: { data: WishlistData & { unresolved: [] } }) => void;
  vi.mocked(wishlistApi.reconcile).mockImplementation(() => new Promise(resolve => { resolveMerge = resolve; }));
  const { result, client } = setup('owner');
  await waitFor(() => expect(wishlistApi.reconcile).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem(WISHLIST_STORAGE_KEY)).not.toBeNull();
  expect(result.current.data).toBeUndefined();
  await act(async () => resolveMerge({ data: { ...data([second, first]).data, unresolved: [] } }));
  await waitFor(() => expect(result.current.productIds).toEqual([second, first]));
  expect(client.getQueryData(queryKeys.wishlist.current('owner'))).toMatchObject(data([second, first]));
  expect(localStorage.getItem(WISHLIST_STORAGE_KEY)).toBeNull(); expect(result.current.mergeError).toBeNull();
  expect(wishlistApi.reconcile).toHaveBeenCalledTimes(1);
});
it('shows authoritative merged count and cards immediately when reconciliation succeeds', async () => {
  const third = '62a990ff-7909-4bbb-b42f-8f20b6d97af4';
  writeWishlist([first]);
  writeAuthenticatedWishlistCount('owner', 2);
  vi.mocked(wishlistApi.get).mockResolvedValue(data([second, third]));
  let resolveMerge!: (value: { data: WishlistData & { unresolved: [] } }) => void;
  vi.mocked(wishlistApi.reconcile).mockImplementation(() => new Promise(resolve => { resolveMerge = resolve; }));
  const { result } = setup('owner');
  await waitFor(() => expect(wishlistApi.reconcile).toHaveBeenCalledTimes(1));
  expect(result.current.expectedCount).toBe(2);
  expect(wishlistApi.get).not.toHaveBeenCalled();
  await act(async () => resolveMerge({ data: { ...data([second, third, first]).data, unresolved: [] } }));
  expect(result.current.data?.totalItems).toBe(3);
  expect(result.current.totalItems).toBe(3);
  expect(result.current.isLoading).toBe(false);
  expect(result.current.productIds).toEqual([second, third, first]);
  expect(wishlistApi.get).not.toHaveBeenCalled();
});
it('failed merge preserves both sources and retry succeeds', async () => {
  writeWishlist([first]); vi.mocked(wishlistApi.get).mockResolvedValue(data([second]));
  vi.mocked(wishlistApi.reconcile).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({ data: { ...data([second, first]).data, unresolved: [] } });
  const { result } = setup('owner'); await waitFor(() => expect(result.current.mergeError).toContain('still saved'));
  expect(result.current.productIds).toEqual([second]); expect(localStorage.getItem(WISHLIST_STORAGE_KEY)).not.toBeNull();
  expect(result.current.unresolved).toEqual([]);
  await act(async () => result.current.retryMerge()); expect(result.current.productIds).toEqual([second, first]); expect(result.current.mergeError).toBeNull();
});
it('keeps unresolved guest IDs after a partial union', async () => {
  writeWishlist([first, second]); vi.mocked(wishlistApi.reconcile).mockResolvedValue({ data: { ...data([first]).data, unresolved: [{ productId: second, reason: 'UNAVAILABLE' }] } });
  const { result } = setup('owner'); await waitFor(() => expect(result.current.unresolved).toEqual([second]));
  expect(JSON.parse(localStorage.getItem(WISHLIST_STORAGE_KEY)!)).toEqual({ productIds: [second] });
  act(() => result.current.discardGuest(second)); expect(result.current.mergeError).toBeNull();
  expect(localStorage.getItem(WISHLIST_STORAGE_KEY)).toBeNull(); expect(result.current.unresolved).toEqual([]);
});
it('does not race a retry union against a pending authenticated write', async () => {
  const third = '62a990ff-7909-4bbb-b42f-8f20b6d97af4';
  writeWishlist([first]); vi.mocked(wishlistApi.get).mockResolvedValue(data([second]));
  vi.mocked(wishlistApi.reconcile).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({ data: { ...data([second, third, first]).data, unresolved: [] } });
  let resolveAdd!: (value: { data: WishlistData }) => void;
  vi.mocked(wishlistApi.add).mockImplementation(() => new Promise(resolve => { resolveAdd = resolve; }));
  const { result } = setup('owner'); await waitFor(() => expect(result.current.mergeError).toContain('still saved'));
  act(() => result.current.toggle(third)); await waitFor(() => expect(resolveAdd).toBeTypeOf('function'));
  await act(async () => result.current.retryMerge()); expect(wishlistApi.reconcile).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(WISHLIST_STORAGE_KEY)).not.toBeNull();
  await act(async () => resolveAdd(data([second, third])));
  await waitFor(() => expect(result.current.pending).toEqual([]));
  await act(async () => result.current.retryMerge()); expect(result.current.productIds).toEqual([second, third, first]);
  expect(localStorage.getItem(WISHLIST_STORAGE_KEY)).toBeNull();
});
it('logout retains presentation without copying server products and guest remains separate', async () => {
  vi.mocked(wishlistApi.get).mockResolvedValue(data([first]));
  const { result, rerender } = setup('owner'); await waitFor(() => expect(result.current.totalItems).toBe(1));
  auth(null, true); rerender(); expect(result.current.data?.totalItems).toBe(1); expect(result.current.isLoggingOut).toBe(true);
  expect(localStorage.getItem(WISHLIST_STORAGE_KEY)).toBeNull(); auth(null); rerender(); expect(result.current.totalItems).toBe(0);
});
it('fresh cache renders immediately and background refresh preserves content', async () => {
  const { result, client } = setup('owner'); await waitFor(() => expect(result.current.data).toBeDefined());
  act(() => client.setQueryData(queryKeys.wishlist.current('owner'), data([first])));
  await waitFor(() => expect(result.current.productIds).toEqual([first]));
  vi.mocked(wishlistApi.get).mockImplementation(() => new Promise(() => undefined));
  act(() => { void result.current.retry(); }); expect(result.current.productIds).toEqual([first]); expect(result.current.isLoading).toBe(false);
});
it('uses the last confirmed user-scoped count for authenticated refresh skeletons', async () => {
  writeAuthenticatedWishlistCount('owner', 3);
  let finishRequest!: (value: { data: WishlistData }) => void;
  vi.mocked(wishlistApi.get).mockImplementation(() => new Promise(resolve => { finishRequest = resolve; }));
  const { result } = setup('owner');
  expect(result.current.isLoading).toBe(true);
  expect(result.current.expectedCount).toBe(3);
  expect(result.current.totalItems).toBe(3);
  await act(async () => finishRequest(data([first, second])));
  await waitFor(() => expect(result.current.expectedCount).toBe(2));
  expect(readAuthenticatedWishlistCount('owner')).toBe(2);
});
it('uses cached authenticated identity before session verification on the first render', () => {
  writeAuthenticatedWishlistCount('owner', 3);
  const { result } = setup('owner', false);
  expect(result.current.isLoading).toBe(true);
  expect(result.current.expectedCount).toBe(3);
  expect(result.current.totalItems).toBe(3);
  expect(result.current.data).toBeUndefined();
  expect(wishlistApi.get).not.toHaveBeenCalled();
});
it('overlaps the protected read with user verification and consumes it once after verification', async () => {
  writeAuthenticatedWishlistCount('owner', 3);
  let finishRead!: (value: { data: WishlistData }) => void;
  vi.mocked(wishlistApi.get).mockImplementation(() => new Promise(resolve => { finishRead = resolve; }));
  const { result, rerender, client } = setup('owner', false);
  act(() => window.dispatchEvent(new Event('electrohub:session-token-ready')));
  expect(wishlistApi.get).toHaveBeenCalledTimes(1);
  await act(async () => finishRead(data([first, second])));
  expect(result.current.data).toBeUndefined();
  expect(result.current.isLoading).toBe(true);
  expect(client.getQueryData(queryKeys.wishlist.current('owner'))).toBeUndefined();
  auth('owner'); rerender();
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.totalItems).toBe(2);
  expect(wishlistApi.get).toHaveBeenCalledTimes(1);
});
it('assigns bootstrap data only to the verified identity, never the remembered owner', async () => {
  vi.mocked(wishlistApi.get).mockResolvedValue(data([first]));
  const { result, rerender, client } = setup('remembered-owner', false);
  act(() => window.dispatchEvent(new Event('electrohub:session-token-ready')));
  auth('verified-owner'); rerender();
  await waitFor(() => expect(result.current.totalItems).toBe(1));
  expect(client.getQueryData(queryKeys.wishlist.current('remembered-owner'))).toBeUndefined();
  expect(client.getQueryData(queryKeys.wishlist.current('verified-owner'))).toMatchObject(data([first]));
  expect(wishlistApi.get).toHaveBeenCalledTimes(1);
});
it('discards a bootstrap read when the restored session proves invalid', async () => {
  vi.mocked(wishlistApi.get).mockResolvedValue(data([first]));
  const { result, rerender, client } = setup('owner', false);
  act(() => window.dispatchEvent(new Event('electrohub:session-token-ready')));
  act(() => window.dispatchEvent(new Event('electrohub:session-expired')));
  auth(null); rerender();
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.totalItems).toBe(0);
  expect(client.getQueryData(queryKeys.wishlist.current('owner'))).toBeUndefined();
});
it.each([undefined, 0])('distinguishes unknown from confirmed-empty count metadata (%s)', count => {
  if (count !== undefined) writeAuthenticatedWishlistCount('owner', count);
  const { result } = setup('owner', false);
  expect(result.current.expectedCount).toBe(count);
  expect(result.current.isLoading).toBe(true);
  expect(result.current.data).toBeUndefined();
});
it('publishes zero-to-one refresh metadata before notifying cache consumers', async () => {
  vi.mocked(wishlistApi.add).mockResolvedValue(data([first]));
  const { result, client, unmount } = setup('owner');
  await waitFor(() => expect(result.current.data?.totalItems).toBe(0));
  const observed: (number | undefined)[] = [];
  const unsubscribe = client.getQueryCache().subscribe(event => {
    const value = event.query.state.data as { data?: WishlistData } | undefined;
    if (value?.data?.totalItems === 1) observed.push(readAuthenticatedWishlistCount('owner'));
  });
  act(() => result.current.toggle(first));
  await waitFor(() => expect(result.current.pending).toEqual([]));
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every(count => count === 1)).toBe(true);
  unsubscribe(); unmount();
  const refreshed = setup('owner', false);
  expect(refreshed.result.current.expectedCount).toBe(1);
  expect(refreshed.result.current.isLoading).toBe(true);
  expect(refreshed.result.current.data).toBeUndefined();
});
it.each([null, 'owner'])('uses current presented membership for immediate counts in both modes (%s)', async owner => {
  vi.mocked(wishlistApi.get).mockResolvedValue(data([]));
  let finishAdd!: (value: { data: WishlistData }) => void;
  vi.mocked(wishlistApi.add).mockImplementation(() => new Promise(resolve => { finishAdd = resolve; }));
  const { result } = setup(owner);
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  act(() => result.current.toggle(first, wishlistProduct));
  expect(result.current.data?.totalItems).toBe(1);
  expect(result.current.totalItems).toBe(1);
  expect(result.current.expectedCount).toBe(1);
  expect(result.current.isLoading).toBe(false);
  if (owner) {
    await waitFor(() => expect(finishAdd).toBeTypeOf('function'));
    await act(async () => finishAdd(data([first])));
    expect(readAuthenticatedWishlistCount(owner)).toBe(1);
  }
});
it('persists the confirmed add count for the next authenticated refresh immediately with the cache update', async () => {
  const third = '62a990ff-7909-4bbb-b42f-8f20b6d97af4';
  vi.mocked(wishlistApi.get).mockResolvedValue(data([first, second]));
  vi.mocked(wishlistApi.add).mockResolvedValue(data([first, second, third]));
  const { result, unmount } = setup('owner');
  await waitFor(() => expect(result.current.totalItems).toBe(2));
  act(() => result.current.toggle(third));
  await waitFor(() => expect(result.current.pending).toEqual([]));
  expect(readAuthenticatedWishlistCount('owner')).toBe(3);
  unmount();
  const refreshed = setup('owner', false);
  expect(refreshed.result.current.isLoading).toBe(true);
  expect(refreshed.result.current.expectedCount).toBe(3);
});
it('does not let a GET started during Add overwrite the confirmed cache or count metadata', async () => {
  const third = '62a990ff-7909-4bbb-b42f-8f20b6d97af4';
  vi.mocked(wishlistApi.get).mockResolvedValueOnce(data([first, second]));
  let resolveAdd!: (value: { data: WishlistData }) => void;
  let resolveStaleGet!: (value: { data: WishlistData }) => void;
  vi.mocked(wishlistApi.add).mockImplementation(() => new Promise(resolve => { resolveAdd = resolve; }));
  const { result, client } = setup('owner');
  await waitFor(() => expect(result.current.totalItems).toBe(2));
  act(() => result.current.toggle(third));
  await waitFor(() => expect(resolveAdd).toBeTypeOf('function'));
  vi.mocked(wishlistApi.get).mockImplementationOnce(() => new Promise(resolve => { resolveStaleGet = resolve; }));
  let finishRefetch!: Promise<void>;
  act(() => { finishRefetch = result.current.retry().then(() => undefined); });
  await waitFor(() => expect(resolveStaleGet).toBeTypeOf('function'));
  await act(async () => resolveAdd(data([first, second, third])));
  await waitFor(() => expect(readAuthenticatedWishlistCount('owner')).toBe(3));
  await act(async () => { resolveStaleGet(data([first, second])); await finishRefetch; });
  expect(client.getQueryData<{ data: WishlistData }>(queryKeys.wishlist.current('owner'))?.data.totalItems).toBe(3);
  expect(result.current.totalItems).toBe(3);
  expect(readAuthenticatedWishlistCount('owner')).toBe(3);
});
it('persists the confirmed Remove count for the next authenticated refresh', async () => {
  vi.mocked(wishlistApi.get).mockResolvedValue(data([first, second, '62a990ff-7909-4bbb-b42f-8f20b6d97af4']));
  vi.mocked(wishlistApi.remove).mockResolvedValue(data([first, second]));
  const { result, unmount } = setup('owner');
  await waitFor(() => expect(result.current.totalItems).toBe(3));
  act(() => result.current.toggle('62a990ff-7909-4bbb-b42f-8f20b6d97af4'));
  await waitFor(() => expect(result.current.pending).toEqual([]));
  expect(result.current.totalItems).toBe(2);
  expect(readAuthenticatedWishlistCount('owner')).toBe(2);
  unmount();
  const refreshed = setup('owner', false);
  expect(refreshed.result.current.totalItems).toBe(2);
  expect(refreshed.result.current.expectedCount).toBe(2);
});
it.each([
  { label: 'remove', initial: [first, second], productId: second, expected: [first], mutation: 'remove' as const },
  { label: 'add', initial: [first], productId: second, expected: [first, second], mutation: 'add' as const },
])('persists the optimistic $label count before its request settles for an immediate refresh', async ({ initial, productId, expected, mutation }) => {
  vi.mocked(wishlistApi.get).mockResolvedValue(data(initial));
  let finishMutation!: (value: { data: WishlistData }) => void;
  vi.mocked(wishlistApi[mutation]).mockImplementation(() => new Promise(resolve => { finishMutation = resolve; }));
  const current = setup('owner');
  await waitFor(() => expect(current.result.current.totalItems).toBe(initial.length));

  act(() => current.result.current.toggle(productId));
  expect(current.result.current.productIds).toEqual(expected);
  expect(readAuthenticatedWishlistCount('owner')).toBe(expected.length);
  await waitFor(() => expect(finishMutation).toBeTypeOf('function'));

  current.unmount();
  const refreshed = setup('owner', false);
  expect(refreshed.result.current.isLoading).toBe(true);
  expect(refreshed.result.current.expectedCount).toBe(expected.length);
  expect(refreshed.result.current.totalItems).toBe(expected.length);
  refreshed.unmount();

  await act(async () => finishMutation(data(expected)));
  expect(readAuthenticatedWishlistCount('owner')).toBe(expected.length);
});
it.each([
  { label: 'remove', initial: [first, second], productId: second, expected: [first], mutation: 'remove' as const },
  { label: 'add', initial: [first], productId: second, expected: [first, second], mutation: 'add' as const },
])('does not let a stale read overwrite the pending optimistic $label count', async ({ initial, productId, expected, mutation }) => {
  vi.mocked(wishlistApi.get).mockResolvedValueOnce(data(initial));
  let finishMutation!: (value: { data: WishlistData }) => void;
  let finishStaleRead!: (value: { data: WishlistData }) => void;
  vi.mocked(wishlistApi[mutation]).mockImplementation(() => new Promise(resolve => { finishMutation = resolve; }));
  const { result } = setup('owner');
  await waitFor(() => expect(result.current.totalItems).toBe(initial.length));

  act(() => result.current.toggle(productId));
  await waitFor(() => expect(finishMutation).toBeTypeOf('function'));
  expect(readAuthenticatedWishlistCount('owner')).toBe(expected.length);
  vi.mocked(wishlistApi.get).mockImplementationOnce(() => new Promise(resolve => { finishStaleRead = resolve; }));
  let refetch!: Promise<void>;
  act(() => { refetch = result.current.retry().then(() => undefined); });
  await waitFor(() => expect(finishStaleRead).toBeTypeOf('function'));
  await act(async () => { finishStaleRead(data(initial)); await refetch; });
  expect(readAuthenticatedWishlistCount('owner')).toBe(expected.length);
  expect(result.current.expectedCount).toBe(expected.length);

  await act(async () => finishMutation(data(expected)));
  expect(readAuthenticatedWishlistCount('owner')).toBe(expected.length);
});
it('preserves the optimistic count when refresh aborts a pending Add request', async () => {
  vi.mocked(wishlistApi.get).mockResolvedValue(data([]));
  let rejectAdd!: (error: Error) => void;
  vi.mocked(wishlistApi.add).mockImplementation(() => new Promise((_resolve, reject) => { rejectAdd = reject; }));
  const current = setup('owner');
  await waitFor(() => expect(current.result.current.isLoading).toBe(false));
  act(() => current.result.current.toggle(first, wishlistProduct));
  await waitFor(() => expect(rejectAdd).toBeTypeOf('function'));
  act(() => window.dispatchEvent(new Event('pagehide')));
  await act(async () => rejectAdd(new Error('request aborted during refresh')));
  await waitFor(() => expect(current.result.current.pending).toEqual([]));
  expect(readAuthenticatedWishlistCount('owner')).toBe(1);
  current.unmount();
  const refreshed = setup('owner', false);
  expect(refreshed.result.current.isLoading).toBe(true);
  expect(refreshed.result.current.expectedCount).toBe(1);
  refreshed.unmount();
});
it('restores three refresh skeletons after a confirmed four-to-three removal', async () => {
  const ids = [first, second, '62a990ff-7909-4bbb-b42f-8f20b6d97af4', '00000000-0000-4000-8000-000000000004'];
  vi.mocked(wishlistApi.get).mockResolvedValue(data(ids));
  vi.mocked(wishlistApi.remove).mockResolvedValue(data(ids.slice(0, 3)));
  const { result, unmount } = setup('owner');
  await waitFor(() => expect(result.current.totalItems).toBe(4));
  act(() => result.current.toggle(ids[3]!));
  await waitFor(() => expect(result.current.pending).toEqual([]));
  expect(readAuthenticatedWishlistCount('owner')).toBe(3);
  unmount();
  const refreshed = setup('owner', false);
  expect(refreshed.result.current.expectedCount).toBe(3);
  expect(refreshed.result.current.isLoading).toBe(true);
});
it('does not reuse another user count and safely ignores malformed count metadata', () => {
  writeAuthenticatedWishlistCount('first-owner', 8);
  expect(readAuthenticatedWishlistCount('second-owner')).toBeUndefined();
  sessionStorage.setItem('electrohub.wishlist.auth-count.v1:second-owner', 'not-a-count');
  expect(readAuthenticatedWishlistCount('second-owner')).toBeUndefined();
});
it('another authenticated identity never receives the previous account cache', async () => {
  vi.mocked(wishlistApi.get).mockResolvedValueOnce(data([first])).mockResolvedValueOnce(data([second]));
  const { result, rerender } = setup('first-owner'); await waitFor(() => expect(result.current.productIds).toEqual([first]));
  const staleIntent = '62a990ff-7909-4bbb-b42f-8f20b6d97af4';
  vi.mocked(wishlistApi.add).mockImplementation(() => new Promise(() => undefined));
  act(() => result.current.toggle(staleIntent)); expect(result.current.productIds).toContain(staleIntent);
  auth('second-owner'); rerender(); expect(result.current.productIds).not.toContain(first);
  expect(result.current.productIds).not.toContain(staleIntent); expect(result.current.pending).not.toContain(staleIntent);
  await waitFor(() => expect(result.current.productIds).toEqual([second])); expect(localStorage.getItem(WISHLIST_STORAGE_KEY)).toBeNull();
});
it('storage clear failure preserves guest IDs without automatically looping reconciliation', async () => {
  writeWishlist([first]); vi.mocked(wishlistApi.reconcile).mockResolvedValue({ data: { ...data([first]).data, unresolved: [] } });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage denied'); });
  const { result } = setup('owner'); await waitFor(() => expect(result.current.mergeError).toContain('browser storage'));
  await waitFor(() => expect(result.current.isMerging).toBe(false));
  expect(wishlistApi.reconcile).toHaveBeenCalledTimes(1); expect(localStorage.getItem(WISHLIST_STORAGE_KEY)).not.toBeNull();
  expect(result.current.unresolved).toEqual([]);
});
it('late mutation from an earlier login cannot replace a later same-user session', async () => {
  let resolveAdd!: (value: { data: WishlistData }) => void;
  vi.mocked(wishlistApi.add).mockImplementation(() => new Promise(resolve => { resolveAdd = resolve; }));
  const { result, rerender, client } = setup('owner'); await waitFor(() => expect(result.current.data).toBeDefined());
  act(() => result.current.toggle(first)); await waitFor(() => expect(resolveAdd).toBeTypeOf('function'));
  vi.mocked(wishlistApi.get).mockResolvedValue(data([second]));
  auth(null); rerender(); auth('owner'); rerender();
  act(() => client.setQueryData(queryKeys.wishlist.current('owner'), data([second])));
  await waitFor(() => expect(result.current.productIds).toEqual([second]));
  await act(async () => resolveAdd(data([first]))); expect(result.current.productIds).toEqual([second]);
});
