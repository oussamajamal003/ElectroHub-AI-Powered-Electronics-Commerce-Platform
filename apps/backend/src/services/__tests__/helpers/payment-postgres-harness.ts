/**
 * Shared harness for the real-PostgreSQL payment suites in DISPOSABLE scope (see scripts/payment-pg-disposable.cjs).
 *
 * Nothing here runs unless PAYMENT_PG_TEST_INTERNAL_RUN === 'disposable'. The target is re-proved inside the test
 * process (per-run CA handshake plus server-side facts), independent of the runner that launched it, and a flag alone
 * never enables a run. The provider double emulates Stripe idempotency (same attempt identity, same result) and can
 * script the failures the specification names: reply lost after the provider acted, death before the provider call,
 * definitive capture rejection, and a stall after cancellation. It makes NO network call and never touches Stripe.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { InventoryStatus, Prisma, PrismaClient, ProductStatus, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CartService } from '../../cart.service.js';
import { InventoryService } from '../../inventory.service.js';
import { PaymentService } from '../../payment.service.js';
import { AppError } from '../../../middleware/errorHandler.js';
import { TERMINAL_PAYMENT_STATES, type Attempt, type PaymentProvider, type ProviderIntent, type ProviderRefund } from '../../payment.domain.js';

export const disposableMode = process.env.PAYMENT_PG_TEST_INTERNAL_RUN === 'disposable';

export class Barrier {
  private count = 0;
  private readonly gate = deferred();
  constructor(private readonly parties: number) {}
  async wait() {
    this.count++;
    if (this.count === this.parties) this.gate.resolve();
    await this.gate.promise;
  }
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

export function sqlState(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { code?: unknown; meta?: { code?: unknown }; cause?: { code?: unknown } };
  for (const value of [record.meta?.code, record.cause?.code, record.code]) {
    if (typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value)) return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Provider double
// ---------------------------------------------------------------------------------------------------------------
export type ProviderFault =
  | 'create-reply-lost'     // the provider created the intent, but the caller never saw the reply
  | 'capture-before'        // the process dies before the capture request reaches the provider (no effect)
  | 'capture-reply-lost'    // the provider captured, but the caller never saw the reply
  | 'capture-rejected'      // a definitive, application-level capture rejection
  | 'refund-reply-lost';    // the provider refunded, but the caller never saw the reply
type Gate = { entered: Promise<void>; release(): void };

export class HarnessProvider implements PaymentProvider {
  readonly accountId = 'acct_pg_disposable_mock';
  readonly intents = new Map<string, ProviderIntent>();
  readonly attempts = new Map<string, string>();
  readonly refunds = new Map<string, ProviderRefund>();
  private readonly refundByAttempt = new Map<string, string>();
  readonly callCounts = { account: 0, create: 0, retrieve: 0, capture: 0, cancel: 0, refund: 0, retrieveRefund: 0 };
  /** Distinct successful captures: what Stripe would have charged (idempotent per attempt identity). */
  captured = 0;
  private readonly faults = new Set<ProviderFault>();
  private stallAfterCancel: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
  private pendingStall: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;

  fail(fault: ProviderFault) { this.faults.add(fault); }
  private consume(fault: ProviderFault) { return this.faults.delete(fault); }

  async account() { this.callCounts.account++; return this.accountId; }
  async create(attempt: Attempt): Promise<ProviderIntent> {
    this.callCounts.create++;
    const existing = this.attempts.get(attempt.id);
    if (existing) return { ...this.intents.get(existing)! }; // idempotent on the attempt identity
    const id = `pi_mock_${attempt.id.replaceAll('-', '')}`;
    const intent: ProviderIntent = { id, account: this.accountId, livemode: false, amount: attempt.amountCents,
      currency: attempt.currency.toLowerCase(), captureMethod: 'manual', status: 'requires_payment_method', capturable: 0,
      received: 0, methodType: 'card', clientSecret: `mock-client-${attempt.id}`, attemptId: attempt.id,
      declined: false, card: null, captureBefore: new Date(Date.now() + 60 * 60_000) };
    this.intents.set(id, intent); this.attempts.set(attempt.id, id);
    if (this.consume('create-reply-lost')) throw new Error('Provider reply lost after create.');
    return { ...intent };
  }
  async retrieve(id: string) {
    this.callCounts.retrieve++;
    if (this.pendingStall) {
      const stall = this.pendingStall; this.pendingStall = null;
      stall.entered.resolve(); await stall.release.promise;
    }
    const intent = this.intents.get(id);
    if (!intent) throw new Error('Mock provider received an unknown intent id.');
    return { ...intent };
  }
  async capture(attempt: Attempt) {
    this.callCounts.capture++;
    if (this.consume('capture-before')) throw new Error('Process died before the capture request was sent.');
    const id = this.attempts.get(attempt.id); const intent = id ? this.intents.get(id) : undefined;
    if (!intent) throw new Error('Mock provider capture did not match its saved attempt.');
    if (this.consume('capture-rejected')) throw new AppError('The provider rejected the capture.', 409, 'PAYMENT_CAPTURE_REJECTED');
    if (intent.status !== 'succeeded') {
      this.captured++;
      this.intents.set(intent.id, { ...intent, status: 'succeeded', capturable: 0, received: attempt.amountCents });
    }
    if (this.consume('capture-reply-lost')) throw new Error('Provider reply lost after capture.');
    return { ...this.intents.get(intent.id)! };
  }
  async cancel(attempt: Attempt) {
    this.callCounts.cancel++;
    const id = this.attempts.get(attempt.id); const intent = id ? this.intents.get(id) : undefined;
    if (!intent) throw new Error('Mock provider cancel did not match its saved attempt.');
    if (intent.status !== 'canceled') this.intents.set(intent.id, { ...intent, status: 'canceled', capturable: 0, received: 0 });
    if (this.stallAfterCancel) { this.pendingStall = this.stallAfterCancel; this.stallAfterCancel = null; }
    return { ...this.intents.get(intent.id)! };
  }
  async refund(attempt: Attempt, amount: number): Promise<ProviderRefund> {
    this.callCounts.refund++;
    const known = this.refundByAttempt.get(attempt.id);
    if (known) return { ...this.refunds.get(known)! }; // idempotent on the attempt identity
    const id = `re_mock_${attempt.id.replaceAll('-', '')}`;
    const refund: ProviderRefund = { id, intentId: this.attempts.get(attempt.id)!, amount, status: 'succeeded' };
    this.refunds.set(id, refund); this.refundByAttempt.set(attempt.id, id);
    if (this.consume('refund-reply-lost')) throw new Error('Provider reply lost after refund.');
    return { ...refund };
  }
  async retrieveRefund(id: string): Promise<ProviderRefund> {
    this.callCounts.retrieveRefund++;
    const refund = this.refunds.get(id);
    if (!refund) throw new Error('Mock provider has no such refund.');
    return { ...refund };
  }
  /** The first retrieve after the next cancel() blocks until released (the runner stalls mid-compensation). */
  stallRetrieveAfterNextCancel(): Gate {
    const entered = deferred(); const release = deferred();
    this.stallAfterCancel = { entered, release };
    return { entered: entered.promise, release: release.resolve };
  }
  setStatus(attemptId: string, status: ProviderIntent['status']) {
    const id = this.attempts.get(attemptId); const intent = id ? this.intents.get(id) : undefined;
    if (!intent) throw new Error('Mock provider status update did not match its saved attempt.');
    const next = status === 'requires_capture' ? { ...intent, status, capturable: intent.amount, received: 0 }
      : status === 'succeeded' ? { ...intent, status, capturable: 0, received: intent.amount } : { ...intent, status };
    this.intents.set(id!, next);
  }
  intentFor(attemptId: string) {
    const id = this.attempts.get(attemptId); const intent = id ? this.intents.get(id) : undefined;
    if (!intent) throw new Error('Mock provider has no intent for the saved attempt.');
    return { ...intent };
  }
}

/**
 * A database client whose next `$transaction` rejects when `shouldFail()` returns true. Used to model a local
 * write (the durable acknowledgement) failing after the provider already acted. Nothing else is altered.
 */
export function faultyDatabase(real: PrismaClient, shouldFail: () => boolean): PrismaClient {
  return new Proxy(real, { get(target, property) {
    const value = Reflect.get(target, property, target) as unknown;
    if (property === '$transaction' && typeof value === 'function') {
      return (...args: unknown[]) => {
        if (shouldFail()) return Promise.reject(new Error('Simulated local acknowledgement failure.'));
        return (value as (...call: unknown[]) => unknown).apply(target, args);
      };
    }
    return typeof value === 'function' ? (value as (...call: unknown[]) => unknown).bind(target) : value;
  } });
}

// ---------------------------------------------------------------------------------------------------------------
// Disposable target proof inside the test process
// ---------------------------------------------------------------------------------------------------------------
interface DisposableConfig { url: string; database: string; caFile: string; caPem: string }
interface PgClientLike { connect(): Promise<void>; end(): Promise<void>; query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> }
interface DisposableModule {
  validateConfiguration(env: NodeJS.ProcessEnv, options?: { scope?: 'scenarios-A-S' | 'scenarios-A-J' | 'stripe-live' }): { error?: string; config?: DisposableConfig };
  runUrl(config: DisposableConfig, schema: string): string;
  createClient(config: DisposableConfig): PgClientLike;
  verifyDisposableServer(client: PgClientLike, options: { expectedDatabase: string; allowedSchema: string | null }): Promise<unknown>;
}
const requireFromBackend = createRequire(path.join(process.cwd(), 'package.json'));

export interface DisposableRun { schema: string; connectionString: string; database: string }

/**
 * Re-proves, in this process, that the database is the run's disposable instance. Throws before any fixture write.
 * The environment is only a claim: the proof is the verified-TLS handshake against the per-run CA plus server-side facts.
 */
export async function assertDisposableRun(): Promise<DisposableRun> {
  const scope = requireFromBackend('./scripts/payment-pg-disposable.cjs') as DisposableModule;
  // The runner names the suite; only the two PostgreSQL-only suites are valid here and each has its own exact authorization.
  const suite = process.env.PAYMENT_PG_DISPOSABLE_SCOPE === 'scenarios-A-J' ? 'scenarios-A-J' : 'scenarios-A-S';
  const validated = scope.validateConfiguration(process.env, { scope: suite });
  if (!validated.config) throw new Error('Disposable scope configuration failed before fixture writes.');
  const runId = process.env.PAYMENT_PG_DISPOSABLE_RUN_ID ?? '';
  const schema = process.env.PAYMENT_PG_DISPOSABLE_SCHEMA ?? '';
  if (!/^[a-f0-9]{12}$/.test(runId) || schema !== `pgrun_${runId}`) throw new Error('Disposable run identity is invalid.');
  const expected = scope.runUrl(validated.config, schema);
  const connectionString = process.env.PAYMENT_PG_TEST_DATABASE_URL ?? '';
  if (connectionString !== expected || process.env.DATABASE_URL !== expected || process.env.DIRECT_URL !== expected ||
      process.env.STRIPE_SECRET_KEY !== '') throw new Error('Disposable connection scope failed before fixture writes.');
  const client = scope.createClient(validated.config);
  try {
    await client.connect();
    await scope.verifyDisposableServer(client, { expectedDatabase: validated.config.database, allowedSchema: schema });
    const marker = (await client.query("SELECT obj_description(to_regnamespace($1)::oid, 'pg_namespace') AS marker", [schema])).rows[0]?.marker;
    if (marker !== `electrohub-disposable-run:${runId}`) throw new Error('Disposable run schema marker mismatch.');
  } finally {
    await client.end();
  }
  return { schema, connectionString, database: validated.config.database };
}

/**
 * Live (real Stripe Test Mode) suite on a disposable database: re-proves, in this process, that the application's database is the
 * run's disposable instance (public schema, database-level marker), before any write. The Stripe key must be a Test Mode key.
 */
export async function assertDisposableLive(): Promise<{ database: string }> {
  const scope = requireFromBackend('./scripts/payment-pg-disposable.cjs') as DisposableModule;
  const validated = scope.validateConfiguration(process.env, { scope: 'stripe-live' });
  if (!validated.config) throw new Error('Disposable live-suite configuration failed before fixture writes.');
  const runId = process.env.PAYMENT_PG_DISPOSABLE_RUN_ID ?? '';
  if (!/^[a-f0-9]{12}$/.test(runId)) throw new Error('Disposable run identity is invalid.');
  const url = validated.config.url;
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (process.env.DATABASE_URL !== url || process.env.DIRECT_URL !== url || !key.startsWith('sk_test_') || /(?:sk|rk|pk)_live_/i.test(key)) {
    throw new Error('Disposable live-suite connection scope failed before fixture writes.');
  }
  const client = scope.createClient(validated.config);
  try {
    await client.connect();
    await scope.verifyDisposableServer(client, { expectedDatabase: validated.config.database, allowedSchema: 'public' });
    const marker = (await client.query("SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database()")).rows[0]?.marker;
    if (marker !== `electrohub-disposable-run:${runId}`) throw new Error('Disposable database marker mismatch.');
  } finally {
    await client.end();
  }
  return { database: validated.config.database };
}

export function createDatabase(connectionString: string, schema: string): PrismaClient {
  const tlsUrl = connectionString ? new URL(connectionString) : null;
  for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) tlsUrl?.searchParams.delete(name);
  const adapter = new PrismaPg({ connectionString: tlsUrl?.toString() ?? '', max: 4, min: 0, connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000, statement_timeout: 30_000, lock_timeout: 5_000, ssl: { rejectUnauthorized: true } }, { schema });
  return new PrismaClient({ adapter, log: ['error'] });
}

/** Run-schema identity checks shared by the disposable guard blocks. Every public financial relation must be absent. */
export async function assertRunSchemaIsolation(db: PrismaClient, schema: string) {
  const rows = await db.$queryRaw<Array<{ db: string; schema: string; schemas: string[]; path: string }>>(Prisma.sql`
    SELECT current_database()::text AS db, current_schema()::text AS schema, current_schemas(false)::text[] AS schemas, current_setting('search_path') AS path`);
  const row = rows[0];
  if (!row || row.schema !== schema || row.path !== schema || row.schemas.length !== 1 || row.schemas[0] !== schema) {
    throw new Error('Disposable run schema pinning failed before fixture writes.');
  }
  // Absence is read from the catalog: Prisma's pg adapter reports 42P01 as a generic "No such table" error without the
  // SQLSTATE, so probing with SELECT cannot distinguish "absent" from other failures.
  for (const table of ['payment_attempts', 'payment_work', 'orders', 'payments', 'carts', 'cart_items']) {
    const found = await db.$queryRaw<Array<{ rel: string | null }>>(Prisma.sql`SELECT to_regclass(${`public."${table}"`})::text AS rel`);
    if (found.length !== 1 || found[0]?.rel !== null) throw new Error('The public schema is not empty; the run is not isolated.');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Fixtures and lifecycle helpers (current submitted-purchase lifecycle: setup -> submit -> authorize -> process)
// ---------------------------------------------------------------------------------------------------------------
export const checkoutAddress = { recipient: 'Disposable Acceptance', line1: '1 Test Avenue', city: 'Seoul',
  postalCode: '04524', country: 'South Korea', phone: '+821012345678' };

export interface Context { db: PrismaClient; cart: CartService; inventory: InventoryService }
export function createContext(db: PrismaClient): Context {
  return { db, cart: new CartService(db), inventory: new InventoryService() };
}

export async function makeCustomer(db: PrismaClient) {
  const role = await db.role.upsert({ where: { name: UserRole.CUSTOMER }, create: { name: UserRole.CUSTOMER }, update: {} });
  const unique = randomUUID().replaceAll('-', '');
  const user = await db.user.create({ data: { roleId: role.id, email: `pg-lifecycle-${unique}@example.invalid`,
    firstName: 'Postgres', lastName: 'Lifecycle' } });
  return user.id;
}

export async function makeProduct(db: PrismaClient, stock: number) {
  const unique = randomUUID().replaceAll('-', '');
  const category = await db.category.create({ data: { name: `PG lifecycle ${unique}`, slug: `pg-lifecycle-${unique}` } });
  const product = await db.product.create({ data: { categoryId: category.id, sku: `PGL-${unique}`, name: `Disposable lifecycle product`,
    slug: `pgl-${unique}`, price: new Prisma.Decimal('12.34'), status: ProductStatus.ACTIVE, storefrontVisible: true, isTestFixture: false,
    images: { create: { url: 'https://example.invalid/payment-lifecycle-fixture.png', isPrimary: true } },
    inventory: { create: { quantity: stock, lowStockAt: 1, status: stock > 0 ? InventoryStatus.IN_STOCK : InventoryStatus.OUT_OF_STOCK } } },
  select: { id: true } });
  return product.id;
}

export function checkoutRequest(expectedRevision: string) {
  return { shipping: checkoutAddress, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision } as const;
}

export async function startPurchase(context: Context, userId: string, productId: string, provider: HarnessProvider, quantity = 1) {
  await context.cart.add(userId, { productId, quantity });
  const activeCart = await context.cart.get(userId);
  const payment = new PaymentService(context.db, provider, context.inventory);
  const setup = await payment.setup(userId, randomUUID(), checkoutRequest(activeCart.revision));
  const attempt = await context.db.paymentAttempt.findUnique({ where: { id: setup.attemptId }, include: { items: true } });
  if (!attempt) throw new Error('PaymentService.setup did not persist its checkout attempt.');
  return { payment, setup, attempt, userId, productId };
}

/**
 * A historical (pre-ownership) attempt: its items carry no cart-line generation marker, so the guarded legacy commit path
 * (no submit step, Cart cleared at commit, Cart restoration at compensation) applies. The columns are nullable by design.
 */
export async function startLegacyPurchase(context: Context, userId: string, lines: Array<{ productId: string; quantity: number }>, provider: HarnessProvider) {
  for (const line of lines) await context.cart.add(userId, line);
  const activeCart = await context.cart.get(userId);
  const payment = new PaymentService(context.db, provider, context.inventory);
  const setup = await payment.setup(userId, randomUUID(), checkoutRequest(activeCart.revision));
  await context.db.paymentAttemptItem.updateMany({ where: { attemptId: setup.attemptId }, data: { snapshotCartItemId: null, sourceCartItemId: null } });
  const attempt = await context.db.paymentAttempt.findUniqueOrThrow({ where: { id: setup.attemptId }, include: { items: true } });
  return { payment, setup, attempt, userId };
}

/** The customer's explicit final action followed by the provider authorizing the intent. */
export async function submitAndAuthorize(purchase: Awaited<ReturnType<typeof startPurchase>>, provider: HarnessProvider) {
  await purchase.payment.submit(purchase.userId, purchase.attempt.id);
  provider.setStatus(purchase.attempt.id, 'requires_capture');
}

const TERMINAL = new Set<string>(TERMINAL_PAYMENT_STATES);
/** Drives the durable worker the way the runner would: make due work claimable, process, stop at a terminal state. */
export async function settle(db: PrismaClient, payment: PaymentService, attemptId: string, rounds = 6) {
  for (let round = 0; round < rounds; round++) {
    await db.paymentWork.updateMany({ where: { attemptId, state: 'READY' }, data: { nextRunAt: new Date(Date.now() - 1_000) } });
    await payment.process(attemptId);
    const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (TERMINAL.has(attempt.state)) return attempt;
  }
  return db.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
}
