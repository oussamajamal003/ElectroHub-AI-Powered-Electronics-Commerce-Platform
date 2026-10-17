import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CartService, MAX_CART_LINES, cartResponse, currentCart } from '../cart.service.js';

vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../utils/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

const userId = '62a990ff-7909-4bbb-b42f-8f20b6d97af4';
const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const phone = idOf(1); const watch = idOf(2); const fixture = idOf(3);
type Row = { id: string; productId: string; quantity: number; createdAt: number };
const productRow = (id: string, overrides: Record<string, unknown> = {}) => ({ id, slug: `p-${id.slice(-2)}`, name: `Product ${id.slice(-2)}`, sku: 'S', categoryId: 'c',
  price: new Prisma.Decimal('19.99'), status: 'ACTIVE', isTestFixture: false, category: { name: 'Phones', isActive: true },
  inventory: { quantity: 50, lowStockAt: 2 }, images: [{ url: '/p.jpg', altText: 'P' }], ...overrides });

/** In-memory database. Cart lines are returned in the order Prisma would (createdAt, id), nested or separate by select. */
function memoryDatabase(initial: Row[], catalog: Map<string, ReturnType<typeof productRow>>) {
  const state = { lines: [...initial], hasCart: true };
  const sorted = () => [...state.lines].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const database = {
    cart: {
      findUnique: vi.fn(async ({ select }: { select: { items?: { select: { product?: unknown } } } }) => {
        if (!state.hasCart) return null;
        const nested = Boolean(select.items?.select.product);
        return { id: 'cart-1', items: sorted().map(line => ({ id: line.id, productId: line.productId, quantity: line.quantity,
          ...(nested ? { product: catalog.get(line.productId) } : {}) })) };
      }),
      upsert: vi.fn(async () => { state.hasCart = true; return { id: 'cart-1' }; }),
    },
    product: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; isTestFixture: boolean } }) =>
      where.id.in.map(id => catalog.get(id)).filter((row): row is ReturnType<typeof productRow> => Boolean(row) && row!.isTestFixture === where.isTestFixture)) },
    cartItem: {
      findMany: vi.fn(async () => state.lines.map(({ id, productId, quantity }) => ({ id, productId, quantity }))),
      create: vi.fn(async ({ data }: { data: { productId: string; quantity: number } }) => { state.lines.push({ id: `line-${state.lines.length + 1}`, productId: data.productId, quantity: data.quantity, createdAt: state.lines.length }); return {}; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { quantity: number } }) => { state.lines.find(line => line.id === where.id)!.quantity = data.quantity; return {}; }),
    },
    $queryRaw: vi.fn(async () => state.hasCart ? [{ id: 'cart-1' }] : []),
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation(database)),
  };
  return { database, state };
}

beforeEach(() => vi.clearAllMocks());

describe('single-read Cart response is output-identical to currentCart', () => {
  const catalog = () => new Map([[phone, productRow(phone)], [watch, productRow(watch, { price: new Prisma.Decimal('199.50'), inventory: { quantity: 1, lowStockAt: 2 } })],
    [fixture, productRow(fixture, { isTestFixture: true })]]);
  const cases: [string, Row[]][] = [
    ['empty Cart', []],
    ['two lines in creation order', [{ id: 'b', productId: watch, quantity: 2, createdAt: 2 }, { id: 'a', productId: phone, quantity: 1, createdAt: 1 }]],
    ['quantity above stock', [{ id: 'a', productId: watch, quantity: 5, createdAt: 1 }]],
    ['a disposable fixture line is projected as unavailable, as before', [{ id: 'a', productId: fixture, quantity: 1, createdAt: 1 }, { id: 'b', productId: phone, quantity: 1, createdAt: 2 }]],
  ];
  for (const [name, rows] of cases) {
    it(name, async () => {
      const { database } = memoryDatabase(rows, catalog());
      const next = await cartResponse(userId, database as never);
      const previous = (await currentCart(userId, database as never)).data;
      expect(next).toEqual(previous);
    });
  }
  it('a customer with no Cart gets the same empty projection from one read', async () => {
    const { database, state } = memoryDatabase([], catalog()); state.hasCart = false;
    expect(await cartResponse(userId, database as never)).toEqual((await currentCart(userId, database as never)).data);
    expect(database.cart.findUnique).toHaveBeenCalledTimes(2); expect(database.product.findMany).not.toHaveBeenCalled();
  });
  it('is exactly one database read, where currentCart needs two', async () => {
    const { database } = memoryDatabase([{ id: 'a', productId: phone, quantity: 1, createdAt: 1 }], catalog());
    await cartResponse(userId, database as never);
    expect(database.cart.findUnique).toHaveBeenCalledTimes(1); expect(database.product.findMany).not.toHaveBeenCalled();
  });
});

describe('add keeps its limits and error precedence on the combined line read', () => {
  const catalog = () => new Map([[phone, productRow(phone)], [watch, productRow(watch)]]);
  const fullCart = (): Row[] => Array.from({ length: MAX_CART_LINES }, (_, index) => ({ id: `l${index}`, productId: idOf(100 + index), quantity: 1, createdAt: index }));
  it('rejects a new line when the Cart already has the maximum number of lines', async () => {
    const { database } = memoryDatabase(fullCart(), catalog());
    await expect(new CartService(database as never).add(userId, { productId: phone, quantity: 1 })).rejects.toMatchObject({ statusCode: 409, code: 'CART_FULL' });
    expect(database.cartItem.create).not.toHaveBeenCalled(); expect(database.product.findMany).not.toHaveBeenCalled();
  });
  it('still increases an EXISTING line when the Cart is at the line maximum', async () => {
    const rows = fullCart(); rows[0] = { id: 'l0', productId: phone, quantity: 1, createdAt: 0 };
    const full = catalog(); for (const row of rows) if (!full.has(row.productId)) full.set(row.productId, productRow(row.productId)); // every line has a Product (foreign key)
    const { database, state } = memoryDatabase(rows, full);
    await new CartService(database as never).add(userId, { productId: phone, quantity: 2 });
    expect(state.lines.find(line => line.id === 'l0')!.quantity).toBe(3); expect(database.cartItem.create).not.toHaveBeenCalled();
  });
  it('rejects an oversized combined quantity before validating the product or writing', async () => {
    const { database } = memoryDatabase([{ id: 'a', productId: phone, quantity: 998, createdAt: 1 }], catalog());
    await expect(new CartService(database as never).add(userId, { productId: phone, quantity: 2 })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CART_QUANTITY' });
    expect(database.product.findMany).not.toHaveBeenCalled(); expect(database.cartItem.update).not.toHaveBeenCalled();
  });
  it('a customer without a Cart gets one created and locked once, then the line is added', async () => {
    const { database, state } = memoryDatabase([], catalog()); state.hasCart = false;
    const result = await new CartService(database as never).add(userId, { productId: phone, quantity: 1 });
    expect(database.cart.upsert).toHaveBeenCalledTimes(1); expect(database.$queryRaw).toHaveBeenCalledTimes(2);
    expect(result.items).toMatchObject([{ productId: phone, quantity: 1 }]);
  });
  it('an existing Cart is never upserted', async () => {
    const { database } = memoryDatabase([], catalog());
    await new CartService(database as never).add(userId, { productId: phone, quantity: 1 });
    expect(database.cart.upsert).not.toHaveBeenCalled();
  });
});

describe('concurrent adds cannot lose an update: the Cart lock is taken before any line is read', () => {
  /** Serializes transactions on the Cart row exactly like SELECT ... FOR UPDATE held until commit. */
  function lockingDatabase(initial: Row[]) {
    const catalog = new Map([[phone, productRow(phone)]]);
    const { database, state } = memoryDatabase(initial, catalog);
    let holder: Promise<void> = Promise.resolve(); const events: string[] = []; let txCounter = 0;
    const yieldTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));
    const tx = (id: number, release: () => void, acquired: Promise<void>) => ({
      ...database,
      $queryRaw: vi.fn(async () => { await acquired; events.push(`tx${id}:lock`); await yieldTurn(); return [{ id: 'cart-1' }]; }),
      cartItem: { ...database.cartItem,
        findMany: vi.fn(async () => { events.push(`tx${id}:read`); await yieldTurn(); return state.lines.map(({ id: lineId, productId, quantity }) => ({ id: lineId, productId, quantity })); }),
        update: vi.fn(async (args: { where: { id: string }; data: { quantity: number } }) => { await yieldTurn(); events.push(`tx${id}:write`); return database.cartItem.update(args); }),
      },
      release,
    });
    const client = { ...database,
      $transaction: vi.fn(async (operation: (client: unknown) => Promise<unknown>) => {
        const id = ++txCounter; const previous = holder; let release!: () => void;
        holder = new Promise<void>(resolve => { release = resolve; });
        const lockTurn = previous; // queued behind the current holder; only takes effect when the lock query runs
        try { return await operation(tx(id, release, lockTurn)); } finally { release(); events.push(`tx${id}:commit`); }
      }) };
    return { client, state, events };
  }
  it('two simultaneous adds of the same product both count', async () => {
    const { client, state, events } = lockingDatabase([{ id: 'a', productId: phone, quantity: 1, createdAt: 1 }]);
    const service = new CartService(client as never);
    await Promise.all([service.add(userId, { productId: phone, quantity: 1 }), service.add(userId, { productId: phone, quantity: 1 })]);
    expect(state.lines[0]!.quantity).toBe(3);
    for (const id of [1, 2]) expect(events.indexOf(`tx${id}:lock`)).toBeLessThan(events.indexOf(`tx${id}:read`));
    expect(events.indexOf('tx1:commit')).toBeLessThan(events.indexOf('tx2:read')); // the second reads only after the first committed
  });
});
