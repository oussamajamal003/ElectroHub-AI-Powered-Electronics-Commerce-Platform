import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query';
import { queryKeys } from '@/lib/query';
import { apiClient } from '@/lib/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { CartProvider } from './CartProvider';
import { useCart } from './context';
import { CART_STORAGE_KEY } from './storage';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiClient: vi.fn() }));
const productId = '8f2813b4-a388-44d3-b51e-5d4c40386677';
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.mocked(useAuth).mockReturnValue({ isSessionVerified: true, isAuthenticated: false, user: null } as ReturnType<typeof useAuth>);
  vi.mocked(apiClient).mockImplementation(async (_endpoint, options) => {
    const items = (options?.data as { items: { productId: string; quantity: number }[] }).items;
    return { data: { items: items.map(item => ({ ...item, availability: 'AVAILABLE', availableQuantity: 9 })),
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0), subtotal: '1.00', shipping: '0.00', total: '1.00', currency: 'USD', canCheckout: true } } as never;
  });
});

describe('CartProvider guest adapter', () => {
  it('accepts a server-validated decrease for an out-of-stock line but rejects an increase', async () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 1, items: [{ productId, quantity: 3 }] }));
    vi.mocked(apiClient).mockImplementation(async (_endpoint, options) => {
      const items = (options?.data as { items: { productId: string; quantity: number }[] }).items;
      const firstItem = items[0];
      if (!firstItem) throw new Error('Expected a Cart item in the validation request.');
      return { data: { items: items.map(item => ({ ...item, availability: 'OUT_OF_STOCK', stockStatus: 'OUT_OF_STOCK', availableQuantity: 0,
        product: { slug: 'phone', name: 'Phone', category: 'Phones', price: '19.99', image: null }, lineTotal: (item.quantity * 19.99).toFixed(2) })),
        totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0), subtotal: (firstItem.quantity * 19.99).toFixed(2), shipping: '0.00',
        total: (firstItem.quantity * 19.99).toFixed(2), currency: 'USD', canCheckout: false } } as never;
    });
    const client = createQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><CartProvider>{children}</CartProvider></QueryClientProvider>;
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.data?.items[0]).toMatchObject({ quantity: 3, availability: 'OUT_OF_STOCK' }));

    await act(async () => { await expect(result.current.setQuantity(productId, 4)).rejects.toThrow('Product is unavailable.'); });
    expect(JSON.parse(localStorage.getItem(CART_STORAGE_KEY)!)).toEqual({ version: 1, items: [{ productId, quantity: 3 }] });

    await act(async () => { await result.current.setQuantity(productId, 2); });
    expect(result.current.data?.items[0]).toMatchObject({ quantity: 2, availability: 'OUT_OF_STOCK' });
    expect(result.current.data?.canCheckout).toBe(false);
    expect(JSON.parse(localStorage.getItem(CART_STORAGE_KEY)!)).toEqual({ version: 1, items: [{ productId, quantity: 2 }] });
  });

  it('serializes simultaneous adds and preserves both quantities', async () => {
    const client = createQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><CartProvider>{children}</CartProvider></QueryClientProvider>;
    const { result } = renderHook(() => useCart(), { wrapper });
    await act(async () => { await Promise.all([result.current.addItem(productId), result.current.addItem(productId)]); });
    await waitFor(() => expect(result.current.totalQuantity).toBe(2));
    expect(JSON.parse(localStorage.getItem(CART_STORAGE_KEY)!)).toEqual({ version: 1, items: [{ productId, quantity: 2 }] });
    expect(vi.mocked(apiClient).mock.calls.filter(([endpoint]) => endpoint === '/api/cart/validate').length).toBeGreaterThanOrEqual(2);
  });

  it('removes a guest line from cached Cart data without a loading gap or validation request', async () => {
    const secondProductId = '41f516ae-8385-4dcb-9a85-90b5dc9fe363';
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 1, items: [
      { productId, quantity: 1 }, { productId: secondProductId, quantity: 2 },
    ] }));
    vi.mocked(apiClient).mockResolvedValue({ data: {
      items: [
        { id: null, productId, quantity: 1, product: { slug: 'phone', name: 'Phone', category: 'Phones', price: '19.99', image: null }, availableQuantity: 5, availability: 'AVAILABLE', lineTotal: '19.99' },
        { id: null, productId: secondProductId, quantity: 2, product: { slug: 'tablet', name: 'Tablet', category: 'Tablets', price: '10.00', image: null }, availableQuantity: 5, availability: 'AVAILABLE', lineTotal: '20.00' },
      ],
      totalQuantity: 3, subtotal: '39.99', shipping: '0.00', total: '39.99', currency: 'USD', canCheckout: true,
    } } as never);
    const client = createQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><CartProvider>{children}</CartProvider></QueryClientProvider>;
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.data?.items).toHaveLength(2));
    const requestsBeforeRemove = vi.mocked(apiClient).mock.calls.length;

    await act(async () => { await result.current.removeItem(productId); });

    expect(result.current.data?.items.map(item => item.productId)).toEqual([secondProductId]);
    expect(result.current.data).toMatchObject({ totalQuantity: 2, subtotal: '20.00', total: '20.00', canCheckout: true });
    expect(result.current.isLoading).toBe(false);
    expect(vi.mocked(apiClient)).toHaveBeenCalledTimes(requestsBeforeRemove);
  });
});

describe('CartProvider authenticated quantity updates', () => {
  it('never makes an optimistic over-stock quantity checkout-valid', async () => {
    const user = { id: '62a990ff-7909-4bbb-b42f-8f20b6d97af4' };
    vi.mocked(useAuth).mockReturnValue({ isSessionVerified: true, isAuthenticated: true, user } as ReturnType<typeof useAuth>);
    let rejectUpdate!: (error: Error) => void;
    vi.mocked(apiClient).mockImplementation(() => new Promise((_resolve, reject) => { rejectUpdate = reject; }));
    const client = createQueryClient();
    client.setQueryData(queryKeys.cart.current(user.id), { data: { items: [{ id: 'line-1', productId, quantity: 2,
      product: { slug: 'phone', name: 'Phone', category: 'Phones', price: '19.99', image: null }, availableQuantity: 3, availability: 'AVAILABLE', lineTotal: '39.98' }],
      totalQuantity: 2, subtotal: '39.98', total: '39.98', shipping: '0.00', currency: 'USD', canCheckout: true } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><CartProvider>{children}</CartProvider></QueryClientProvider>;
    const { result } = renderHook(() => useCart(), { wrapper });
    let update!: Promise<void>;
    act(() => { update = result.current.setQuantity(productId, 4); });
    expect(result.current.data?.items[0]).toMatchObject({ quantity: 4, availability: 'LOW_STOCK' });
    expect(result.current.data?.canCheckout).toBe(false);
    await waitFor(() => expect(rejectUpdate).toBeDefined());
    await act(async () => { rejectUpdate(new Error('Stock conflict')); await expect(update).rejects.toThrow(); });
    expect(result.current.data?.items[0]?.quantity).toBe(2);
  });
  const user = { id: '62a990ff-7909-4bbb-b42f-8f20b6d97af4' };
  const cart = (quantity: number) => ({ data: { items: [{ id: 'line-1', productId, quantity,
    product: { slug: 'phone', name: 'Phone', category: 'Phones', price: '19.99', image: null },
    availableQuantity: 5, availability: 'AVAILABLE' as const, lineTotal: (quantity * 19.99).toFixed(2) }],
    totalQuantity: quantity, subtotal: (quantity * 19.99).toFixed(2), shipping: '0.00',
    total: (quantity * 19.99).toFixed(2), currency: 'USD' as const, canCheckout: true } });

  it.each([1, 3])('shows quantity %i and totals before the server responds', async quantity => {
    vi.mocked(useAuth).mockReturnValue({ isSessionVerified: true, isAuthenticated: true, user } as ReturnType<typeof useAuth>);
    let resolveUpdate!: (value: ReturnType<typeof cart>) => void;
    vi.mocked(apiClient).mockImplementation(() => new Promise(resolve => { resolveUpdate = resolve as typeof resolveUpdate; }));
    const client = createQueryClient();
    client.setQueryData(queryKeys.cart.current(user.id), cart(2));
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><CartProvider>{children}</CartProvider></QueryClientProvider>;
    const { result } = renderHook(() => useCart(), { wrapper });
    let update!: Promise<void>;
    act(() => { update = result.current.setQuantity(productId, quantity); });
    expect(result.current.data?.items[0]?.quantity).toBe(quantity);
    expect(result.current.totalQuantity).toBe(quantity);
    expect(result.current.data?.subtotal).toBe((quantity * 19.99).toFixed(2));
    expect(result.current.pendingProductIds).toEqual([productId]);
    await waitFor(() => expect(resolveUpdate).toBeTypeOf('function'));
    await act(async () => { resolveUpdate(cart(quantity)); await update; });
    expect(result.current.pendingProductIds).toEqual([]);
  });

  it('rolls back the line, total, and badge after a rejected update', async () => {
    vi.mocked(useAuth).mockReturnValue({ isSessionVerified: true, isAuthenticated: true, user } as ReturnType<typeof useAuth>);
    let rejectUpdate!: (error: Error) => void;
    vi.mocked(apiClient).mockImplementation(() => new Promise((_resolve, reject) => { rejectUpdate = reject; }));
    const client = createQueryClient();
    client.setQueryData(queryKeys.cart.current(user.id), cart(2));
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><CartProvider>{children}</CartProvider></QueryClientProvider>;
    const { result } = renderHook(() => useCart(), { wrapper });
    let update!: Promise<void>;
    act(() => { update = result.current.setQuantity(productId, 3); });
    expect(result.current.totalQuantity).toBe(3);
    await waitFor(() => expect(rejectUpdate).toBeTypeOf('function'));
    await act(async () => { rejectUpdate(new Error('Update failed.')); await update.catch(() => undefined); });
    expect(result.current.data?.items[0]?.quantity).toBe(2);
    expect(result.current.totalQuantity).toBe(2);
    expect(result.current.data?.subtotal).toBe('39.98');
    expect(result.current.pendingProductIds).toEqual([]);
  });

  it('accepts rapid quantity changes immediately and serializes every server write', async () => {
    vi.mocked(useAuth).mockReturnValue({ isSessionVerified: true, isAuthenticated: true, user } as ReturnType<typeof useAuth>);
    const responses: Array<() => void> = [];
    const requestedQuantities: number[] = [];
    vi.mocked(apiClient).mockImplementation((endpoint, options) => {
      if (endpoint === '/api/cart') return Promise.resolve(cart(2) as never);
      return new Promise(resolve => {
        const requested = (options?.data as { quantity: number }).quantity;
        requestedQuantities.push(requested);
        responses.push(() => resolve(cart(requested) as never));
      });
    });
    const client = createQueryClient();
    client.setQueryData(queryKeys.cart.current(user.id), cart(2));
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><CartProvider>{children}</CartProvider></QueryClientProvider>;
    const { result } = renderHook(() => useCart(), { wrapper });
    let updates!: Promise<void>[];
    act(() => {
      updates = [result.current.setQuantity(productId, 3), result.current.setQuantity(productId, 4), result.current.setQuantity(productId, 5)];
    });
    expect(result.current.data?.items[0]?.quantity).toBe(5);
    expect(result.current.totalQuantity).toBe(5);
    await waitFor(() => expect(responses).toHaveLength(1));
    await act(async () => { responses.shift()!(); });
    await waitFor(() => expect(responses).toHaveLength(1));
    await act(async () => { responses.shift()!(); });
    await waitFor(() => expect(responses).toHaveLength(1));
    await act(async () => { responses.shift()!(); await Promise.all(updates); });
    expect(result.current.data?.items[0]?.quantity).toBe(5);
    expect(result.current.pendingProductIds).toEqual([]);
    expect(requestedQuantities).toEqual([3, 4, 5]);
    expect(vi.mocked(apiClient)).toHaveBeenCalledTimes(3);
  });

  it('applies rapid decreases in order and keeps the latest intended quantity', async () => {
    vi.mocked(useAuth).mockReturnValue({ isSessionVerified: true, isAuthenticated: true, user } as ReturnType<typeof useAuth>);
    const requests: number[] = [];
    vi.mocked(apiClient).mockImplementation((endpoint, options) => {
      if (endpoint === '/api/cart') return Promise.resolve(cart(5) as never);
      const requested = (options?.data as { quantity: number }).quantity;
      requests.push(requested);
      return Promise.resolve(cart(requested) as never);
    });
    const client = createQueryClient();
    client.setQueryData(queryKeys.cart.current(user.id), cart(5));
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><CartProvider>{children}</CartProvider></QueryClientProvider>;
    const { result } = renderHook(() => useCart(), { wrapper });
    await act(async () => { await Promise.all([result.current.setQuantity(productId, 4), result.current.setQuantity(productId, 3), result.current.setQuantity(productId, 2)]); });
    expect(requests).toEqual([4, 3, 2]);
    expect(result.current.data?.items[0]?.quantity).toBe(2);
    expect(result.current.totalQuantity).toBe(2);
  });

  it('optimistically removes once, updates totals immediately, and restores the Cart on failure', async () => {
    vi.mocked(useAuth).mockReturnValue({ isSessionVerified: true, isAuthenticated: true, user } as ReturnType<typeof useAuth>);
    const secondProductId = '41f516ae-8385-4dcb-9a85-90b5dc9fe363';
    const original = { data: { items: [
      { id: 'line-1', productId, quantity: 1, product: { slug: 'phone', name: 'Phone', category: 'Phones', price: '19.99', image: null }, availableQuantity: 5, availability: 'AVAILABLE' as const, lineTotal: '19.99' },
      { id: 'line-2', productId: secondProductId, quantity: 2, product: { slug: 'tablet', name: 'Tablet', category: 'Tablets', price: '10.00', image: null }, availableQuantity: 5, availability: 'AVAILABLE' as const, lineTotal: '20.00' },
    ], totalQuantity: 3, subtotal: '39.99', shipping: '0.00', total: '39.99', currency: 'USD' as const, canCheckout: true } };
    let rejectRemove!: (error: Error) => void;
    vi.mocked(apiClient).mockImplementation((endpoint) => endpoint === '/api/cart' ? Promise.resolve(original as never) : new Promise((_resolve, reject) => { rejectRemove = reject; }));
    const client = createQueryClient();
    client.setQueryData(queryKeys.cart.current(user.id), original);
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><CartProvider>{children}</CartProvider></QueryClientProvider>;
    const { result } = renderHook(() => useCart(), { wrapper });
    let removal!: Promise<void>;
    act(() => { removal = result.current.removeItem(productId); void result.current.removeItem(productId); });
    expect(result.current.data?.items.map(item => item.productId)).toEqual([secondProductId]);
    expect(result.current.totalQuantity).toBe(2);
    expect(result.current.data?.subtotal).toBe('20.00');
    expect(result.current.pendingRemoveProductIds).toEqual([productId]);
    await waitFor(() => expect(rejectRemove).toBeTypeOf('function'));
    expect(vi.mocked(apiClient).mock.calls.filter(([endpoint]) => endpoint === `/api/cart/items/${productId}`)).toHaveLength(1);
    await act(async () => { rejectRemove(new Error('Remove failed')); await removal.catch(() => undefined); });
    expect(result.current.data?.items.map(item => item.productId)).toEqual([productId, secondProductId]);
    expect(result.current.totalQuantity).toBe(3);
    expect(result.current.data?.subtotal).toBe('39.99');
    expect(result.current.pendingRemoveProductIds).toEqual([]);
  });
});

describe('CartProvider guest reconciliation transition', () => {
  const user = { id: '62a990ff-7909-4bbb-b42f-8f20b6d97af4' };
  it('hides stale quantity, installs the merged response immediately, and ignores an older Cart GET', async () => {
    vi.mocked(useAuth).mockReturnValue({ isSessionVerified: true, isAuthenticated: true, user } as ReturnType<typeof useAuth>);
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 1, items: [{ productId, quantity: 9 }] }));
    const makeCart = (quantity: number) => ({ data: { items: [{ id: 'line-1', productId, quantity,
      product: { slug: 'phone', name: 'Phone', category: 'Phones', price: '19.99', image: null },
      availableQuantity: 10, availability: 'AVAILABLE' as const, lineTotal: (quantity * 19.99).toFixed(2) }],
      totalQuantity: quantity, subtotal: (quantity * 19.99).toFixed(2), shipping: '0.00',
      total: (quantity * 19.99).toFixed(2), currency: 'USD' as const, canCheckout: true } });
    let resolveReconcile!: (value: ReturnType<typeof makeCart>) => void;
    let resolveOlderGet!: (value: ReturnType<typeof makeCart>) => void;
    let reconcileCalls = 0;
    vi.mocked(apiClient).mockImplementation(endpoint => {
      if (endpoint === '/api/cart/reconcile') {
        reconcileCalls++;
        return new Promise(resolve => { resolveReconcile = resolve as typeof resolveReconcile; });
      }
      return new Promise(resolve => { resolveOlderGet = resolve as typeof resolveOlderGet; });
    });
    const client = createQueryClient();
    client.setQueryData(queryKeys.cart.current(user.id), makeCart(7));
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><CartProvider>{children}</CartProvider></QueryClientProvider>;
    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => expect(resolveReconcile).toBeTypeOf('function'));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();

    let olderRefresh!: Promise<void>;
    act(() => { olderRefresh = result.current.retry(); });
    await waitFor(() => expect(resolveOlderGet).toBeTypeOf('function'));
    expect(localStorage.getItem(CART_STORAGE_KEY)).not.toBeNull();
    await act(async () => { resolveReconcile(makeCart(9)); });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data?.items[0]?.quantity).toBe(9);
    });
    expect(result.current.totalQuantity).toBe(9);
    expect(result.current.data?.subtotal).toBe('179.91');
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
    expect(reconcileCalls).toBe(1);

    await act(async () => { resolveOlderGet(makeCart(7)); await olderRefresh; });
    expect(result.current.data?.items[0]?.quantity).toBe(9);
    expect(result.current.totalQuantity).toBe(9);
  });
});
