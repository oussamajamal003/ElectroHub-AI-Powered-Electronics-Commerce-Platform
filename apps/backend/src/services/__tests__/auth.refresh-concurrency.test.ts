process.env.OTP_HASH_SECRET = 'unit-test-secret';
import crypto from 'crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityEventType } from '@prisma/client';
import { AuthService } from '../auth.service.js';
import { AuthRepository } from '../../repositories/auth.repository.js';
import { hashPassword } from '../../utils/hash.js';
import { deferred, getModelDb, settle, type ModelEvent } from './helpers/refresh-token-model-db.js';

/**
 * Deterministic interleaving tests for refresh-token rotation, logout, replay detection and global
 * revocation. They run the real AuthService and AuthRepository against a stateful MODEL of PostgreSQL
 * transactions and advisory locks (see helpers/refresh-token-model-db.ts). They prove the repository logic
 * depends only on committed rows and takes one consistent lock; they are NOT evidence of real PostgreSQL
 * lock or isolation behaviour, which needs an isolated disposable database.
 */
vi.mock('../../lib/prisma.js', async () => {
  const { getModelDb: modelDb } = await import('./helpers/refresh-token-model-db.js');
  return { prisma: modelDb().prisma };
});

const USER_ID = '11111111-1111-4111-8111-111111111111';
const LOCK_NAMESPACE = 'user_token_lifecycle';
const db = getModelDb();

const sha = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');
const future = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const EPOCH = new Date(0).getTime();

describe('refresh-token concurrency (model-based, deterministic)', () => {
  let repo: AuthRepository;
  let service: AuthService;

  /** Issues a first-generation session the way login does: authorized against the account as it is now. */
  const login = async (raw: string) => {
    const user = db.users.get(USER_ID)!;
    const issued = await repo.createSessionRefreshToken(user, sha(raw), future());
    if (!issued) throw new Error('model setup: session issuance unexpectedly refused');
    return issued;
  };
  const liveRows = () => db.rowsByUser(USER_ID).filter((row) => db.isLive(row));
  const failOnce = (match: (event: ModelEvent) => boolean, error: Error) => {
    let armed = true;
    db.hook = (event) => {
      if (armed && match(event)) {
        armed = false;
        throw error;
      }
    };
  };
  /** Pauses the first event matching `match` until `release()` is called. */
  const pauseOnce = (match: (event: ModelEvent) => boolean) => {
    const reached = deferred();
    const gate = deferred();
    let armed = true;
    db.hook = async (event) => {
      if (armed && match(event)) {
        armed = false;
        reached.resolve();
        await gate.promise;
      }
    };
    return { reached: reached.promise, release: () => gate.resolve() };
  };
  const isStatement = (op: string) => (event: ModelEvent) => event.type === 'statement' && event.op === op;
  const expectConsistentLocking = () => {
    expect(db.lockLog.length).toBeGreaterThan(0);
    expect(db.lockLog.every((entry) => entry.namespace === LOCK_NAMESPACE && entry.key === USER_ID)).toBe(true);
    expect(db.multiLockTransactions).toBe(0);
    expect(db.lockOrderViolations).toBe(0);
    expect(db.statementsAfterAbort).toBe(0);
  };

  beforeEach(() => {
    db.reset();
    db.seedUser(USER_ID);
    repo = new AuthRepository();
    service = new AuthService();
  });

  describe('durable lineage and family continuity', () => {
    it('keeps no process-local lineage state that security decisions could depend on', () => {
      expect(Object.values(AuthRepository).some((value) => value instanceof Map)).toBe(false);
      expect('recordRotationLineage' in AuthRepository.prototype).toBe(false);
    });

    it('gives each independent login its own family and every rotated successor its predecessor’s family', async () => {
      const first = await login('device-a-1');
      const second = await login('device-b-1');
      expect(first.familyId).not.toBe(second.familyId);

      expect(await repo.rotateRefreshToken(USER_ID, sha('device-a-1'), sha('device-a-2'), future())).toBe(true);

      const successor = db.byHash(sha('device-a-2'))!;
      expect(successor.familyId).toBe(first.familyId);
      expect(db.byHash(sha('device-a-1'))!.replacedByTokenHash).toBe(sha('device-a-2'));
      expect(db.byHash(sha('device-b-1'))!.familyId).toBe(second.familyId);
    });

    it('T1 → T2 → T3 share one family; logout with the oldest token revokes every generation from another instance', async () => {
      await login('other-device');
      await login('gen-1');
      const gen2 = (await service.refreshSession('gen-1')).refreshToken!;
      const gen3 = (await service.refreshSession(gen2)).refreshToken!;

      const [t1, t2, t3] = [db.byHash(sha('gen-1'))!, db.byHash(sha(gen2))!, db.byHash(sha(gen3))!];
      expect(new Set([t1.familyId, t2.familyId, t3.familyId]).size).toBe(1);
      expect([t1.replacedByTokenHash, t2.replacedByTokenHash, t3.replacedByTokenHash]).toEqual([sha(gen2), sha(gen3), null]);

      // Durable traversal: only the live generation resolves as a successor.
      expect(await repo.findRotationSuccessor(sha('gen-1'))).toBeNull();
      expect((await repo.findRotationSuccessor(sha(gen2)))?.tokenHash).toBe(sha(gen3));

      // A different AuthRepository instance holds none of the first instance's memory: state is only in the database.
      await new AuthRepository().revokeRefreshTokenFamily(sha('gen-1'));

      for (const row of [t1, t2, t3]) {
        const stored = db.byHash(row.tokenHash)!;
        expect(stored.isRevoked).toBe(true);
        expect(stored.expiresAt.getTime()).toBe(EPOCH);
      }
      const other = db.byHash(sha('other-device'))!;
      expect(db.isLive(other)).toBe(true);
      expectConsistentLocking();
    });

    it('never treats a pointer into a different family or user as a successor', async () => {
      const a = await login('fam-a');
      await login('fam-b');
      db.byHash(sha('fam-a'))!.replacedByTokenHash = sha('fam-b');
      expect(a.familyId).not.toBe(db.byHash(sha('fam-b'))!.familyId);

      expect(await repo.findRotationSuccessor(sha('fam-a'))).toBeNull();
    });
  });

  describe('F1 rollback versus logout', () => {
    it('logout that starts in the window after the rollback released the lock sees only committed state', async () => {
      await login('raw-1');
      const boom = new Error('injected failure after successor was staged');
      let logout: Promise<void> | undefined;
      let failed = false;
      db.hook = async (event) => {
        if (!failed && isStatement('refreshToken.create')(event)) {
          failed = true;
          throw boom;
        }
        // PostgreSQL has rolled back and released the lock; the rotation caller has not yet seen the error.
        if (event.type === 'lockReleased' && event.outcome === 'rollback' && !logout) {
          logout = repo.revokeRefreshTokenFamily(sha('raw-1'));
          await logout;
        }
      };

      await expect(repo.rotateRefreshToken(USER_ID, sha('raw-1'), sha('raw-2'), future())).rejects.toBe(boom);

      expect(db.byHash(sha('raw-2'))).toBeUndefined();
      expect(db.rowsByUser(USER_ID)).toHaveLength(1);
      const t1 = db.byHash(sha('raw-1'))!;
      expect(t1.isRevoked).toBe(true);
      expect(t1.expiresAt.getTime()).toBe(EPOCH);
      expect(t1.replacedByTokenHash).toBeNull();
      expect(liveRows()).toHaveLength(0);
      expectConsistentLocking();
    });
  });

  describe('F2 rollback versus refresh', () => {
    it('a refresh in the release window sees no successor and rotates from committed state', async () => {
      await login('raw-1');
      const boom = new Error('injected failure after successor was staged');
      let failed = false;
      let probed = false;
      let successorInWindow: unknown = 'unset';
      let refreshInWindow: Awaited<ReturnType<AuthService['refreshSession']>> | undefined;
      db.hook = async (event) => {
        if (!failed && isStatement('refreshToken.create')(event)) {
          failed = true;
          throw boom;
        }
        if (event.type === 'lockReleased' && event.outcome === 'rollback' && !probed) {
          probed = true;
          successorInWindow = await repo.findRotationSuccessor(sha('raw-1'));
          refreshInWindow = await service.refreshSession('raw-1');
        }
      };

      await expect(repo.rotateRefreshToken(USER_ID, sha('raw-1'), sha('rolled-back'), future())).rejects.toBe(boom);

      expect(successorInWindow).toBeNull();
      expect(refreshInWindow?.refreshToken).toEqual(expect.any(String));
      expect(db.byHash(sha('rolled-back'))).toBeUndefined();
      const live = liveRows();
      expect(live).toHaveLength(1);
      expect(live[0].tokenHash).toBe(sha(refreshInWindow!.refreshToken!));
      expect(db.byHash(sha('raw-1'))!.replacedByTokenHash).toBe(live[0].tokenHash);
      expectConsistentLocking();
    });
  });

  describe('F3 successful rotation versus logout', () => {
    it('rotation wins the lock: logout waits for the commit and then revokes the new successor too', async () => {
      await login('raw-1');
      const pause = pauseOnce(isStatement('refreshToken.create'));
      const rotation = repo.rotateRefreshToken(USER_ID, sha('raw-1'), sha('raw-2'), future());
      await pause.reached;

      let logoutSettled = false;
      const logout = repo.revokeRefreshTokenFamily(sha('raw-1')).then(() => { logoutSettled = true; });
      await settle();
      expect(logoutSettled).toBe(false);

      pause.release();
      await expect(rotation).resolves.toBe(true);
      await logout;

      expect(db.rowsByUser(USER_ID)).toHaveLength(2);
      expect(liveRows()).toHaveLength(0);
      expectConsistentLocking();
    });

    it('logout wins the lock: the waiting rotation finds the token revoked and mints nothing', async () => {
      await login('raw-1');
      const pause = pauseOnce(isStatement('refreshToken.updateMany'));
      const logout = repo.revokeRefreshTokenFamily(sha('raw-1'));
      await pause.reached;

      const refresh = service.refreshSession('raw-1');
      const outcome = refresh.then(() => 'resolved', (error: { code?: string }) => error.code);
      await settle();

      pause.release();
      await logout;

      await expect(outcome).resolves.toBe('SESSION_REVOKED');
      expect(db.rowsByUser(USER_ID)).toHaveLength(1);
      expect(liveRows()).toHaveLength(0);
      expectConsistentLocking();
    });
  });

  describe('F4 two simultaneous refreshes of the same token', () => {
    it('commits exactly one successor; the loser follows the grace contract and mints nothing', async () => {
      await login('raw-1');

      const results = await Promise.all([service.refreshSession('raw-1'), service.refreshSession('raw-1')]);

      const winners = results.filter((result) => result.refreshToken !== null);
      const losers = results.filter((result) => result.refreshToken === null);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0].accessToken).toEqual(expect.any(String));

      expect(db.rowsByUser(USER_ID)).toHaveLength(2);
      const successor = db.byHash(sha(winners[0].refreshToken!))!;
      expect(db.isLive(successor)).toBe(true);
      expect(successor.familyId).toBe(db.byHash(sha('raw-1'))!.familyId);
      expect(db.byHash(sha('raw-1'))!.replacedByTokenHash).toBe(successor.tokenHash);
      expectConsistentLocking();
    });
  });

  describe('replay detection', () => {
    it('reuse after the grace window revokes every session of the user, including the successor', async () => {
      await login('raw-1');
      await login('other-device');
      const next = (await service.refreshSession('raw-1')).refreshToken!;
      db.byHash(sha('raw-1'))!.updatedAt = new Date(Date.now() - 11_000);

      await expect(service.refreshSession('raw-1')).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });

      expect(liveRows()).toHaveLength(0);
      expect(db.byHash(sha(next))!.expiresAt.getTime()).toBe(EPOCH);
      expectConsistentLocking();
    });
  });

  describe('F6 rotation versus password change and global revocation', () => {
    const revokers: Array<[string, () => Promise<unknown>]> = [
      ['password change', () => repo.updatePasswordAndRevokeSessions(USER_ID, 'new-hash', SecurityEventType.PASSWORD_CHANGED)],
      ['revokeAllUserRefreshTokens', () => repo.revokeAllUserRefreshTokens(USER_ID)],
      ['password-reset completion', async () => {
        db.resetTokens.push({ userId: USER_ID, tokenHash: 'reset-hash', expiresAt: future(), consumedAt: null });
        expect(await repo.completePasswordReset(USER_ID, 'reset-hash', 'new-hash', new Date())).toBe(true);
      }],
    ];

    it.each(revokers)('rotation commits first, then %s revokes the successor as well', async (_name, revoke) => {
      await login('raw-1');
      const pause = pauseOnce(isStatement('refreshToken.create'));
      const rotation = repo.rotateRefreshToken(USER_ID, sha('raw-1'), sha('raw-2'), future());
      await pause.reached;

      const revocation = revoke();
      await settle();
      // Committed view while the rotation is still open: only T1 exists and is live; the successor is invisible.
      expect(liveRows().map((row) => row.tokenHash)).toEqual([sha('raw-1')]);
      expect(db.byHash(sha('raw-2'))).toBeUndefined();

      pause.release();
      await expect(rotation).resolves.toBe(true);
      await revocation;

      expect(db.byHash(sha('raw-2'))).toBeDefined();
      expect(liveRows()).toHaveLength(0);
      expectConsistentLocking();
    });

    it.each(revokers)('%s commits first, then the waiting rotation mints nothing', async (_name, revoke) => {
      await login('raw-1');
      const pause = pauseOnce(isStatement('refreshToken.updateMany'));
      const revocation = revoke();
      await pause.reached;

      const rotation = repo.rotateRefreshToken(USER_ID, sha('raw-1'), sha('raw-2'), future());
      await settle();

      pause.release();
      await revocation;
      await expect(rotation).resolves.toBe(false);

      expect(db.byHash(sha('raw-2'))).toBeUndefined();
      expect(liveRows()).toHaveLength(0);
      expectConsistentLocking();
    });
  });

  describe('session issuance versus revocation and account changes', () => {
    const EMAIL = `${USER_ID}@example.test`;
    let oldHash: string;

    beforeEach(async () => {
      oldHash = await hashPassword('old-password');
      db.users.get(USER_ID)!.passwordHash = oldHash;
    });

    /** Runs `during` after the caller's credentials were verified but before its session is inserted. */
    const interleaveBeforeIssuance = (during: () => Promise<unknown>) => {
      const issue = AuthRepository.prototype.createSessionRefreshToken;
      return vi.spyOn(AuthRepository.prototype, 'createSessionRefreshToken').mockImplementationOnce(async function (this: AuthRepository, ...args) {
        await during();
        return issue.apply(this, args);
      });
    };
    const signIn = async (password: string) => {
      const result = await service.login(EMAIL, password);
      if (!('refreshToken' in result)) throw new Error('model setup: expected a session');
      return result;
    };
    const changePassword = async (plain: string) =>
      repo.updatePasswordAndRevokeSessions(USER_ID, await hashPassword(plain), SecurityEventType.PASSWORD_CHANGED);
    const deactivateAccount = () => db.prisma.$transaction(async (tx) => {
      const client = tx as typeof db.prisma & { $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> };
      await client.$queryRaw`SELECT id FROM users WHERE id = ${USER_ID}::uuid FOR UPDATE`;
      await client.refreshToken.deleteMany({ where: { userId: USER_ID } });
      await client.user.update({ where: { id: USER_ID }, data: { isActive: false } });
    });

    it('Race 1: a login whose password was verified before a password change cannot create a surviving session', async () => {
      const spy = interleaveBeforeIssuance(() => changePassword('new-password'));

      await expect(service.login(EMAIL, 'old-password')).rejects.toThrow('Invalid credentials');

      expect(spy).toHaveBeenCalledTimes(1);
      expect(db.rowsByUser(USER_ID)).toHaveLength(0);
      expectConsistentLocking();
    });

    it('Race 1b: a login authorized before a password reset completes is refused the same way', async () => {
      interleaveBeforeIssuance(async () => {
        db.resetTokens.push({ userId: USER_ID, tokenHash: 'reset-hash', expiresAt: future(), consumedAt: null });
        await repo.completePasswordReset(USER_ID, 'reset-hash', await hashPassword('reset-password'), new Date());
      });

      await expect(service.login(EMAIL, 'old-password')).rejects.toThrow('Invalid credentials');
      expect(db.rowsByUser(USER_ID)).toHaveLength(0);
    });

    it.each([
      ['password change', () => repo.updatePasswordAndRevokeSessions(USER_ID, 'new-hash', SecurityEventType.PASSWORD_CHANGED)],
      ['global revocation', () => repo.revokeAllUserRefreshTokens(USER_ID)],
    ] as Array<[string, () => Promise<unknown>]>)('Race 2: a session issued before a %s takes the lock is revoked by it', async (_name, revoke) => {
      const pause = pauseOnce(isStatement('refreshToken.create'));
      const loginRun = signIn('old-password');
      await pause.reached; // session row staged, lifecycle lock held

      const revocation = revoke();
      await settle(); // blocked on the lock: the revocation cannot linearize before the issuance commits
      expect(db.rowsByUser(USER_ID)).toHaveLength(0);

      pause.release();
      const session = await loginRun;
      await revocation;

      expect(session.refreshToken).toEqual(expect.any(String));
      const rows = db.rowsByUser(USER_ID);
      expect(rows).toHaveLength(1);
      expect(rows[0].isRevoked).toBe(true);
      expect(rows[0].expiresAt.getTime()).toBe(EPOCH);
      expectConsistentLocking();
    });

    it('Race 3: a login authorized with the new credentials after a password change succeeds in a new family', async () => {
      const before = await login('before-change');
      await changePassword('new-password');
      expect(liveRows()).toHaveLength(0);

      const session = await signIn('new-password');

      expect(session.accessToken).toEqual(expect.any(String));
      expect(session.refreshToken).toMatch(/^[0-9a-f]{128}$/);
      expect(session.user).toMatchObject({ id: USER_ID, role: 'CUSTOMER' });
      const issued = db.byHash(sha(session.refreshToken!))!;
      expect(db.isLive(issued)).toBe(true);
      expect(issued.familyId).not.toBe(before.familyId);
      expect(issued.replacedByTokenHash).toBeNull();
      expectConsistentLocking();
    });

    it('Race 3b: two independent logins stay in independent families and logout of one keeps the other', async () => {
      const a = await signIn('old-password');
      const b = await signIn('old-password');
      expect(db.byHash(sha(a.refreshToken!))!.familyId).not.toBe(db.byHash(sha(b.refreshToken!))!.familyId);

      await service.logout(a.refreshToken!);

      expect(db.isLive(db.byHash(sha(a.refreshToken!))!)).toBe(false);
      expect(db.isLive(db.byHash(sha(b.refreshToken!))!)).toBe(true);
    });

    it('Race 4: OAuth/session establishment follows the same contract (current account succeeds, stale account is refused)', async () => {
      const session = await service.establishCustomerSession(USER_ID);
      expect(db.isLive(db.byHash(sha(session.refreshToken))!)).toBe(true);

      interleaveBeforeIssuance(() => changePassword('another-password'));
      await expect(service.establishCustomerSession(USER_ID)).rejects.toThrow('Invalid credentials');
      expect(liveRows()).toHaveLength(0); // the earlier session was revoked by the password change; no new one exists
    });

    it('a database failure while issuing a session propagates and leaves no session', async () => {
      const failure = new Error('injected failure while issuing');
      failOnce(isStatement('refreshToken.create'), failure);

      await expect(service.login(EMAIL, 'old-password')).rejects.toBe(failure);
      expect(db.rowsByUser(USER_ID)).toHaveLength(0);
      expect(db.statementsAfterAbort).toBe(0);
    });

    it('deactivation holds the user row first: the waiting issuance re-reads the committed account and is refused', async () => {
      const pause = pauseOnce(isStatement('refreshToken.deleteMany'));
      const deactivation = deactivateAccount();
      await pause.reached;

      const snapshot = { ...db.users.get(USER_ID)!, isActive: true }; // proof was built from the still-active account
      const issuance = repo.createSessionRefreshToken(snapshot, sha('late-session'), future());
      await settle();

      pause.release();
      await deactivation;

      await expect(issuance).resolves.toBeNull();
      expect(db.rowsByUser(USER_ID)).toHaveLength(0);
      expect(db.lockOrderViolations).toBe(0);
    });

    it('issuance holds the lock first: the waiting deactivation deletes the new session before committing', async () => {
      const pause = pauseOnce(isStatement('refreshToken.create'));
      const issuance = login('early-session');
      await pause.reached;

      const deactivation = deactivateAccount();
      await settle();
      expect(db.users.get(USER_ID)!.isActive).toBe(true); // blocked on the user row lock

      pause.release();
      await issuance;
      await deactivation;

      expect(db.rowsByUser(USER_ID)).toHaveLength(0);
      expect(db.users.get(USER_ID)!.isActive).toBe(false);
    });

    it('rotation holds the lifecycle locks first: a waiting deactivation removes the committed successor too', async () => {
      await login('raw-1');
      const pause = pauseOnce(isStatement('refreshToken.create'));
      const rotation = repo.rotateRefreshToken(USER_ID, sha('raw-1'), sha('raw-2'), future());
      await pause.reached;

      const deactivation = deactivateAccount();
      await settle();

      pause.release();
      await expect(rotation).resolves.toBe(true);
      await deactivation;

      expect(db.rowsByUser(USER_ID)).toHaveLength(0);
      expect(db.lockOrderViolations).toBe(0);
    });
  });

  describe('legacy cutover and old-version writers', () => {
    it('rejects a token INSERT that omits familyId (an old-version instance cannot commit a login)', async () => {
      const oldVersionInsert = db.prisma.refreshToken.create({
        data: { userId: USER_ID, tokenHash: sha('legacy-writer'), expiresAt: future() },
      });
      await expect(oldVersionInsert).rejects.toThrow(/not-null violation: familyId/);
    });

    it('an old-version rotation cannot commit: its successor INSERT fails and the revocation rolls back', async () => {
      await login('raw-1');
      await expect(db.prisma.$transaction(async (tx) => {
        const client = tx as typeof db.prisma;
        await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('user_token_lifecycle'), hashtext(${USER_ID}))`;
        await client.refreshToken.updateMany({ where: { tokenHash: sha('raw-1') }, data: { isRevoked: true } });
        await client.refreshToken.create({ data: { userId: USER_ID, tokenHash: sha('raw-2'), expiresAt: future() } });
      })).rejects.toThrow(/not-null violation/);
      expect(liveRows().map((row) => row.tokenHash)).toEqual([sha('raw-1')]);
    });

    it('password-reset completion revokes the whole user session set, successors included', async () => {
      await login('device-a');
      await login('device-b');
      const next = (await service.refreshSession('device-a')).refreshToken!;
      db.resetTokens.push({ userId: USER_ID, tokenHash: 'reset-hash', expiresAt: future(), consumedAt: null });

      expect(await repo.completePasswordReset(USER_ID, 'reset-hash', 'new-hash', new Date())).toBe(true);

      expect(liveRows()).toHaveLength(0);
      expect(db.byHash(sha(next))!.expiresAt.getTime()).toBe(EPOCH);
      expect(db.securityEvents.some((event) => event.type === 'PASSWORD_RESET')).toBe(true);
      // A consumed reset authorization cannot be replayed to revoke or change anything again.
      expect(await repo.completePasswordReset(USER_ID, 'reset-hash', 'other-hash', new Date())).toBe(false);
      expectConsistentLocking();
    });
  });

  describe('migration SQL consistency (static)', () => {
    const migration = readFileSync(
      path.resolve(process.cwd(), 'prisma/migrations/20261013000000_refresh_token_rotation_lineage/migration.sql'),
      'utf8'
    ).replace(/^--.*$/gm, '');
    const schema = readFileSync(path.resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const model = /model RefreshToken \{[\s\S]*?\r?\n\}/.exec(schema)![0].replace(/\/\/.*$/gm, '');

    it('runs every statement inside one explicit transaction, with no non-transactional statement', () => {
      const body = migration.trim();
      expect(body.startsWith('BEGIN;')).toBe(true);
      expect(body.endsWith('COMMIT;')).toBe(true);
      expect(body.match(/BEGIN;/g)).toHaveLength(1);
      expect(body.match(/COMMIT;/g)).toHaveLength(1);
      expect(body).not.toMatch(/CONCURRENTLY/i);
      expect(body).toMatch(/SET LOCAL lock_timeout/);
    });

    it('revokes every legacy row, with the logout revocation contract, before familyId becomes NOT NULL', () => {
      const update = migration.indexOf('UPDATE "refresh_tokens"');
      const notNull = migration.indexOf('SET NOT NULL');
      expect(update).toBeGreaterThan(-1);
      expect(update).toBeLessThan(notNull);
      expect(migration.slice(update, notNull)).toMatch(/"isRevoked" = true/);
      expect(migration.slice(update, notNull)).toMatch(/"expiresAt" = TIMESTAMP '1970-01-01 00:00:00'/);
      expect(migration.slice(update, notNull)).not.toMatch(/WHERE/i); // no row is skipped
    });

    it('gives familyId no default so an old-version INSERT fails, matching the Prisma schema', () => {
      expect(migration).not.toMatch(/DEFAULT\s+gen_random_uuid/i);
      expect(model).toMatch(/familyId\s+String\s+@db\.Uuid\s*\r?\n/);
      expect(model).not.toMatch(/familyId[^\r\n]*@default/);
    });

    it('matches the schema on replacedByTokenHash uniqueness and the family index', () => {
      expect(model).toMatch(/replacedByTokenHash\s+String\?\s+@unique/);
      expect(model).toMatch(/@@index\(\[familyId\]\)/);
      expect(migration).toContain('CREATE UNIQUE INDEX "refresh_tokens_replacedByTokenHash_key"');
      expect(migration).toContain('CREATE INDEX "refresh_tokens_familyId_idx"');
      expect(migration).toContain('refresh_tokens_no_self_replacement_check');
    });
  });

  describe('F7 database failures and ambiguous outcomes', () => {
    const expectOldTokenUntouched = () => {
      const t1 = db.byHash(sha('raw-1'))!;
      expect(db.isLive(t1)).toBe(true);
      expect(t1.replacedByTokenHash).toBeNull();
      expect(db.rowsByUser(USER_ID)).toHaveLength(1);
      expect(db.statementsAfterAbort).toBe(0);
    };

    it('failure before the successor is inserted rolls back and surfaces the original error', async () => {
      await login('raw-1');
      const failure = new Error('injected failure before insert');
      failOnce(isStatement('refreshToken.updateMany'), failure);

      await expect(repo.rotateRefreshToken(USER_ID, sha('raw-1'), sha('raw-2'), future())).rejects.toBe(failure);
      expectOldTokenUntouched();
    });

    it('a real constraint violation on the successor insert rolls back the old-token revocation', async () => {
      await login('raw-1');
      await login('raw-2'); // collides with the hash the rotation tries to insert
      const before = db.rowsByUser(USER_ID).length;

      await expect(repo.rotateRefreshToken(USER_ID, sha('raw-1'), sha('raw-2'), future())).rejects.toThrow(/unique violation/);

      const t1 = db.byHash(sha('raw-1'))!;
      expect(db.isLive(t1)).toBe(true);
      expect(t1.replacedByTokenHash).toBeNull();
      expect(db.rowsByUser(USER_ID)).toHaveLength(before);
      expect(db.statementsAfterAbort).toBe(0);
    });

    it('a serialization conflict at commit leaves no speculative successor and keeps the error identity', async () => {
      await login('raw-1');
      const conflict = Object.assign(new Error('could not serialize access due to concurrent update'), { code: 'P2034' });
      failOnce((event) => event.type === 'commit', conflict);

      await expect(repo.rotateRefreshToken(USER_ID, sha('raw-1'), sha('raw-2'), future())).rejects.toBe(conflict);
      expectOldTokenUntouched();
      expect(await repo.findRotationSuccessor(sha('raw-1'))).toBeNull();
    });

    it('an ambiguous commit is not reported as a definite failure, and a retry resolves from committed state', async () => {
      await login('raw-1');
      const lostAck = Object.assign(new Error('connection terminated while waiting for commit result'), { code: 'P1017' });
      db.ambiguousCommitError = lostAck;

      // The caller gets the raw infrastructure error (HTTP 5xx, cookie preserved) rather than a 401 "revoked".
      await expect(service.refreshSession('raw-1')).rejects.toBe(lostAck);
      expect(db.rowsByUser(USER_ID)).toHaveLength(2); // the commit did apply

      // Client retries with the old cookie inside the grace window: the durable successor authorizes it,
      // and neither a replay revocation nor a second successor happens.
      const retry = await service.refreshSession('raw-1');
      expect(retry.refreshToken).toBeNull();
      expect(retry.accessToken).toEqual(expect.any(String));
      expect(db.rowsByUser(USER_ID)).toHaveLength(2);
      expect(liveRows()).toHaveLength(1);
      expect(db.rowsByUser(USER_ID).every((row) => row.expiresAt.getTime() !== EPOCH)).toBe(true);
    });
  });
});
