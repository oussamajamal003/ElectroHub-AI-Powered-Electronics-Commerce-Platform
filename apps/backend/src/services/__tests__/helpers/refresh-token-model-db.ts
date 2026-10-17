/**
 * Deterministic MODEL of the PostgreSQL behaviours that refresh-token rotation depends on.
 *
 * This is NOT PostgreSQL. It exists so concurrency interleavings can be forced exactly, with no
 * sleeps. It models only:
 *   - READ COMMITTED visibility: reads see committed rows plus the transaction's own writes.
 *   - pg_advisory_xact_lock: a per-key FIFO mutex held until the transaction commits or rolls back.
 *   - Rollback discards every write of the transaction (nothing is applied before commit).
 *   - A failed statement aborts the transaction; later statements fail with 25P02 and COMMIT of an
 *     aborted transaction silently becomes ROLLBACK (this is how PostgreSQL behaves, and why catching
 *     a statement error inside a transaction is unsafe).
 *   - The UNIQUE(tokenHash), UNIQUE(replacedByTokenHash) and no-self-replacement CHECK constraints.
 *   - The window between PostgreSQL releasing the lock and the application observing the outcome
 *     ('lockReleased' hook), which is where the original rollback-cleanup race lived.
 * Real PostgreSQL lock/transaction behaviour remains unverified by these tests.
 */
import crypto from 'crypto';

export interface TokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  isRevoked: boolean;
  familyId: string;
  replacedByTokenHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  roleId: string;
  isActive: boolean;
  emailVerifiedAt: Date;
  role: { id: string; name: string };
}

export type ModelEvent =
  | { type: 'statement'; op: string; txId: number | null }
  | { type: 'commit'; txId: number }
  | { type: 'lockReleased'; txId: number; outcome: 'commit' | 'rollback' };

type Row = Record<string, unknown>;
type Args = { where?: Row; data?: Row; select?: Record<string, boolean> };

interface Tx {
  id: number;
  overlay: Map<string, TokenRow>;
  heldKey: string | null;
  rowLocked: boolean;
  releases: Array<() => void>;
  deleted: Set<string>;
  aborted: boolean;
  lockCount: number;
}

const LOCK_NAMESPACE = 'user_token_lifecycle';

function valueEquals(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
      const op = expected as { gt?: Date; in?: unknown[] };
      if (op.gt !== undefined) return actual instanceof Date && actual.getTime() > op.gt.getTime();
      if (op.in !== undefined) return op.in.some((candidate) => valueEquals(actual, candidate));
    }
    return valueEquals(actual, expected);
  });
}

function project<T extends Row>(row: T, select?: Record<string, boolean>): Row {
  if (!select) return { ...row };
  return Object.fromEntries(Object.entries(select).filter(([, on]) => on).map(([key]) => [key, row[key]]));
}

export class RefreshTokenModelDb {
  committed = new Map<string, TokenRow>();
  users = new Map<string, UserRow>();
  securityEvents: Array<{ userId: string; type: string }> = [];
  resetTokens: Array<{ userId: string; tokenHash: string; expiresAt: Date; consumedAt: Date | null }> = [];
  /** One entry per advisory-lock acquisition. */
  lockLog: Array<{ txId: number; namespace: string; key: string }> = [];
  /** Statements attempted by a transaction after it had already failed. Must stay 0. */
  statementsAfterAbort = 0;
  /** Number of transactions that took more than one lifecycle advisory lock. Must stay 0. */
  multiLockTransactions = 0;
  /** Transactions that took a users-row lock before the advisory lock (the documented order is advisory, then row). Must stay 0. */
  lockOrderViolations = 0;
  /** One entry per users-row lock acquisition: 'share' (lifecycle) or 'update' (account deletion). */
  rowLockLog: Array<{ txId: number; mode: 'share' | 'update'; userId: string }> = [];
  hook: (event: ModelEvent) => Promise<void> | void = () => undefined;
  /** When set, the next transaction that wrote rows commits, then reports this error to the caller. */
  ambiguousCommitError: Error | null = null;

  private txCounter = 0;
  private tails = new Map<string, Promise<void>>();

  reset(): void {
    this.committed.clear();
    this.users.clear();
    this.securityEvents = [];
    this.resetTokens = [];
    this.lockLog = [];
    this.statementsAfterAbort = 0;
    this.multiLockTransactions = 0;
    this.lockOrderViolations = 0;
    this.rowLockLog = [];
    this.hook = () => undefined;
    this.ambiguousCommitError = null;
    this.txCounter = 0;
    this.tails.clear();
  }

  seedUser(id: string): UserRow {
    const user: UserRow = {
      id,
      email: `${id}@example.test`,
      firstName: 'Test',
      lastName: 'User',
      passwordHash: 'hash',
      roleId: 'role-1',
      isActive: true,
      emailVerifiedAt: new Date(),
      role: { id: 'role-1', name: 'CUSTOMER' },
    };
    this.users.set(id, user);
    return user;
  }

  rowsByUser(userId: string): TokenRow[] {
    return [...this.committed.values()].filter((row) => row.userId === userId);
  }

  byHash(tokenHash: string): TokenRow | undefined {
    return [...this.committed.values()].find((row) => row.tokenHash === tokenHash);
  }

  isLive(row: TokenRow, now = new Date()): boolean {
    return !row.isRevoked && row.expiresAt.getTime() > now.getTime();
  }

  private async fire(event: ModelEvent): Promise<void> {
    await this.hook(event);
  }

  private visible(tx: Tx | null): TokenRow[] {
    const merged = new Map(this.committed);
    if (tx) {
      for (const [id, row] of tx.overlay) merged.set(id, row);
      for (const id of tx.deleted) merged.delete(id);
    }
    return [...merged.values()];
  }

  private assertUnique(candidate: TokenRow, tx: Tx | null): void {
    for (const other of this.visible(tx)) {
      if (other.id === candidate.id) continue;
      if (other.tokenHash === candidate.tokenHash) throw new Error('unique violation: tokenHash');
      if (candidate.replacedByTokenHash !== null && other.replacedByTokenHash === candidate.replacedByTokenHash) {
        throw new Error('unique violation: replacedByTokenHash');
      }
    }
    if (candidate.replacedByTokenHash !== null && candidate.replacedByTokenHash === candidate.tokenHash) {
      throw new Error('check violation: refresh_tokens_no_self_replacement_check');
    }
  }

  private async statement<T>(tx: Tx | null, op: string, run: () => T): Promise<T> {
    if (tx?.aborted) {
      this.statementsAfterAbort += 1;
      throw new Error('25P02: current transaction is aborted, commands ignored until end of transaction block');
    }
    try {
      const result = run();
      await this.fire({ type: 'statement', op, txId: tx?.id ?? null });
      return result;
    } catch (error) {
      if (tx) tx.aborted = true;
      throw error;
    }
  }

  private async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(key, previous.then(() => next));
    await previous;
    return release;
  }

  private refreshTokenApi(tx: Tx | null) {
    return {
      findUnique: async ({ where, select }: Args) =>
        this.statement(tx, 'refreshToken.findUnique', () => {
          const row = this.visible(tx).find((candidate) => matches(candidate as unknown as Row, where));
          return row ? project(row as unknown as Row, select) : null;
        }),
      findFirst: async ({ where, select }: Args) =>
        this.statement(tx, 'refreshToken.findFirst', () => {
          const row = this.visible(tx).find((candidate) => matches(candidate as unknown as Row, where));
          return row ? project(row as unknown as Row, select) : null;
        }),
      create: async ({ data }: Args) =>
        this.statement(tx, 'refreshToken.create', () => {
          const now = new Date();
          // "familyId" is NOT NULL with no default (migration 20261013000000): an old-version INSERT must fail.
          if (typeof data!.familyId !== 'string') throw new Error('not-null violation: familyId');
          const row: TokenRow = {
            id: crypto.randomUUID(),
            userId: String(data!.userId),
            tokenHash: String(data!.tokenHash),
            expiresAt: data!.expiresAt as Date,
            isRevoked: false,
            familyId: data!.familyId,
            replacedByTokenHash: (data!.replacedByTokenHash as string | null | undefined) ?? null,
            createdAt: now,
            updatedAt: now,
          };
          this.assertUnique(row, tx);
          if (tx) tx.overlay.set(row.id, row);
          else this.committed.set(row.id, row);
          return { ...row };
        }),
      deleteMany: async ({ where }: Args) =>
        this.statement(tx, 'refreshToken.deleteMany', () => {
          const doomed = this.visible(tx).filter((row) => matches(row as unknown as Row, where));
          for (const row of doomed) {
            if (tx) tx.deleted.add(row.id);
            else this.committed.delete(row.id);
          }
          return { count: doomed.length };
        }),
      updateMany: async ({ where, data }: Args) =>
        this.statement(tx, 'refreshToken.updateMany', () => {
          let count = 0;
          for (const row of this.visible(tx)) {
            if (!matches(row as unknown as Row, where)) continue;
            const updated: TokenRow = { ...row, ...(data as Partial<TokenRow>), updatedAt: new Date() };
            this.assertUnique(updated, tx);
            if (tx) tx.overlay.set(updated.id, updated);
            else this.committed.set(updated.id, updated);
            count += 1;
          }
          return { count };
        }),
    };
  }

  private clientFor(tx: Tx | null) {
    return {
      refreshToken: this.refreshTokenApi(tx),
      user: {
        findUnique: async ({ where, select }: Args) => {
          const user = [...this.users.values()].find((candidate) => matches(candidate as unknown as Row, where));
          return user ? project(user as unknown as Row, select) : null;
        },
        update: async ({ where, data }: Args) => {
          const user = [...this.users.values()].find((candidate) => matches(candidate as unknown as Row, where));
          if (!user) throw new Error('user not found');
          Object.assign(user, data);
          return { ...user };
        },
      },
      securityEvent: {
        create: async ({ data }: Args) => {
          this.securityEvents.push({ userId: String(data!.userId), type: String(data!.type) });
          return {};
        },
      },
      oAuthAccount: { findFirst: async () => null },
      passwordResetToken: {
        updateMany: async ({ where }: Args) => {
          const matching = this.resetTokens.filter((token) => matches(token as unknown as Row, where));
          matching.forEach((token) => { token.consumedAt = new Date(); });
          return { count: matching.length };
        },
      },
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        if (!sql.includes('pg_advisory_xact_lock') || !sql.includes(LOCK_NAMESPACE) || !tx) {
          throw new Error('model: only in-transaction lifecycle advisory locks are supported');
        }
        if (tx.aborted) {
          this.statementsAfterAbort += 1;
          throw new Error('25P02: current transaction is aborted');
        }
        tx.lockCount += 1;
        if (tx.lockCount > 1) this.multiLockTransactions += 1;
        const key = String(values[0]);
        this.lockLog.push({ txId: tx.id, namespace: LOCK_NAMESPACE, key });
        if (tx.rowLocked) this.lockOrderViolations += 1;
        tx.releases.push(await this.acquire(key));
        tx.heldKey = key;
        return 1;
      },
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        const mode = /FOR SHARE/.test(sql) ? 'share' : /FOR UPDATE/.test(sql) ? 'update' : null;
        if (!tx || !mode || !/FROM users/.test(sql)) throw new Error('model: only in-transaction users row locks are supported');
        if (tx.aborted) {
          this.statementsAfterAbort += 1;
          throw new Error('25P02: current transaction is aborted');
        }
        const userId = String(values[0]);
        // Lifecycle transactions must already hold the advisory lock; deletion takes the row lock first and never the advisory lock.
        if (mode === 'share' && tx.lockCount === 0) this.lockOrderViolations += 1;
        tx.rowLocked = true;
        this.rowLockLog.push({ txId: tx.id, mode, userId });
        tx.releases.push(await this.acquire(`row:${userId}`));
        return [{ id: userId }];
      },
    };
  }

  readonly prisma = {
    ...this.clientFor(null),
    $transaction: async <T>(callback: (client: unknown) => Promise<T>): Promise<T> => {
      const tx: Tx = { id: ++this.txCounter, overlay: new Map(), heldKey: null, rowLocked: false, releases: [], deleted: new Set(), aborted: false, lockCount: 0 };
      const releaseLock = () => {
        while (tx.releases.length > 0) tx.releases.pop()!();
      };

      let result: T;
      try {
        result = await callback(this.clientFor(tx));
      } catch (error) {
        releaseLock();
        await this.fire({ type: 'lockReleased', txId: tx.id, outcome: 'rollback' });
        throw error;
      }

      if (tx.aborted) {
        // COMMIT on an aborted transaction is turned into ROLLBACK by PostgreSQL without an error.
        releaseLock();
        await this.fire({ type: 'lockReleased', txId: tx.id, outcome: 'rollback' });
        return result;
      }

      try {
        await this.fire({ type: 'commit', txId: tx.id });
      } catch (error) {
        releaseLock();
        await this.fire({ type: 'lockReleased', txId: tx.id, outcome: 'rollback' });
        throw error;
      }

      const wrote = tx.overlay.size > 0 || tx.deleted.size > 0;
      for (const [id, row] of tx.overlay) this.committed.set(id, row);
      for (const id of tx.deleted) this.committed.delete(id);
      releaseLock();
      await this.fire({ type: 'lockReleased', txId: tx.id, outcome: 'commit' });

      if (wrote && this.ambiguousCommitError) {
        const error = this.ambiguousCommitError;
        this.ambiguousCommitError = null;
        throw error;
      }
      return result;
    },
  };
}

let singleton: RefreshTokenModelDb | null = null;

export function getModelDb(): RefreshTokenModelDb {
  singleton ??= new RefreshTokenModelDb();
  return singleton;
}

/** A promise whose resolution the test controls; used as an explicit barrier instead of sleeping. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Lets already-queued microtasks/promise continuations run so "is X blocked yet?" assertions are exact. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}
