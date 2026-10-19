/**
 * Task 03.8 commerce email dispatcher: claims due outbox rows under a database lease, journals a STARTED attempt BEFORE any
 * provider call, sends outside every transaction, and acknowledges only while its lease token is still current.
 *
 * Guarantee: one durable event per key and one active claim per event, not exactly-once inbox delivery. An attempt whose outcome
 * is unknown (crash, timeout, lost acknowledgement) becomes UNCERTAIN and is never resent automatically.
 *
 * Lock order: outbox row, then its attempt rows. No Order/Payment/Cart/inventory row is ever locked here.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { MAX_RETRY_AGE_MS, MAX_SEND_ATTEMPTS, TEMPLATE_VERSION, classifySendResult, commerceEmailSnapshot, retryDelayMs,
  type CommerceEmailSnapshot, type ProviderSendResult, type RenderContext, type RenderedCommerceEmail, type SendClassification } from './commerce-email.domain.js';
import { DB_NOW } from './commerce-email.producer.js';
import type { CommerceEmailConfig } from './commerce-email.config.js';
import { logSafely } from '../utils/logger.js';

export interface OutgoingCommerceEmail { to: string; subject: string; html: string; text: string; tags: string[] }
export interface CommerceEmailTransport { readonly name: 'BREVO' | 'CAPTURE'; send(message: OutgoingCommerceEmail): Promise<ProviderSendResult> }
export type Renderer = (snapshot: CommerceEmailSnapshot, context: RenderContext, templateVersion: string) => RenderedCommerceEmail;

/** Provider pause after an account/configuration rejection: stop all commerce sends instead of burning every event's budget. */
export const PROVIDER_PAUSE_MS = 5 * 60_000;
/** Proven-not-accepted codes that are permanent for the event (everything else proven-not-accepted is retryable). */
const PERMANENT_CODES = new Set(['PROVIDER_REJECTED']);

interface Claim { id: string; leaseToken: string }
type Settled = 'ACCEPTED' | 'RETRY_WAIT' | 'FAILED' | 'UNCERTAIN' | 'SUPPRESSED' | 'RELEASED' | 'STALE' | 'LOST';

/** Writes a rendered message to a restricted local directory. Disposable/test fixtures only (enforced by the runner). */
export function captureTransport(directory: string): CommerceEmailTransport {
  return { name: 'CAPTURE', async send(message) {
    const messageId = `capture-${randomUUID()}`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, `${messageId}.json`), JSON.stringify({ messageId, ...message }), { mode: 0o600 });
    return { success: true, messageId };
  } };
}

export class CommerceEmailDispatcher {
  private pausedUntil = 0;
  constructor(private readonly db: PrismaClient, private readonly transport: CommerceEmailTransport, private readonly render: Renderer,
    private readonly config: Pick<CommerceEmailConfig, 'sendMode' | 'allowedRecipients' | 'origin' | 'batchSize' | 'concurrency' | 'leaseMs'>,
    private readonly workerInstanceId: string = randomUUID(), private readonly now: () => number = Date.now) {}

  get paused() { return this.now() < this.pausedUntil; }

  /** One bounded pass: recover expired leases, claim at most one batch, send with bounded concurrency. */
  async runBatch(): Promise<{ claimed: number; recovered: number; outcomes: Settled[] }> {
    const recovered = await this.recoverExpired();
    if (this.paused || !this.sendingEnabled()) return { claimed: 0, recovered, outcomes: [] };
    const claims = await this.claim();
    const outcomes: Settled[] = [];
    let next = 0;
    const lane = async () => { while (next < claims.length) outcomes.push(await this.process(claims[next++]!)); };
    await Promise.all(Array.from({ length: Math.min(this.config.concurrency, claims.length) }, lane));
    return { claimed: claims.length, recovered, outcomes };
  }

  private sendingEnabled() {
    return this.config.sendMode !== 'disabled' && Boolean(this.config.origin) && (this.config.sendMode !== 'allowlist' || this.config.allowedRecipients.length > 0);
  }

  /** Short transaction: FOR UPDATE SKIP LOCKED, deterministic order, database time, fresh token per row. Commits before any rendering. */
  async claim(limit = this.config.batchSize): Promise<Claim[]> {
    const allowlist = this.config.sendMode === 'allowlist' ? Prisma.sql`AND "recipient" IN (${Prisma.join(this.config.allowedRecipients)})` : Prisma.empty;
    return this.db.$queryRaw<Claim[]>(Prisma.sql`
      WITH due AS (
        SELECT "id" FROM "commerce_email_outbox"
        WHERE "dispatchState" IN ('READY', 'RETRY_WAIT') AND "nextAttemptAt" <= ${DB_NOW}
          AND "createdAt" > ${DB_NOW} - make_interval(secs => ${MAX_RETRY_AGE_MS / 1000}::float8) ${allowlist}
        ORDER BY "nextAttemptAt", "createdAt", "id"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      UPDATE "commerce_email_outbox" o SET "dispatchState" = 'LEASED', "leaseToken" = gen_random_uuid(),
        "leaseUntil" = ${DB_NOW} + make_interval(secs => ${this.config.leaseMs / 1000}::float8), "updatedAt" = ${DB_NOW}
      FROM due WHERE o."id" = due."id"
      RETURNING o."id", o."leaseToken"::text AS "leaseToken"`);
  }

  async process(claim: Claim): Promise<Settled> {
    const row = await this.db.commerceEmailOutbox.findUnique({ where: { id: claim.id }, select: { type: true, orderId: true, recipient: true,
      snapshot: true, templateVersion: true, createdAt: true, leaseToken: true } });
    if (!row || row.leaseToken !== claim.leaseToken) return 'LOST';
    const log = { outboxId: claim.id, type: row.type, orderId: row.orderId, templateVersion: row.templateVersion, workerInstanceId: this.workerInstanceId };
    if (this.paused) return this.release(claim);
    const parsed = commerceEmailSnapshot.safeParse(row.snapshot);
    let message: RenderedCommerceEmail | null = null;
    if (parsed.success && parsed.data.type === row.type && row.recipient) {
      try { message = this.render(parsed.data, { origin: this.config.origin! }, row.templateVersion); } catch { message = null; }
    }
    // Quarantine: an unrenderable event is never sent, and never retried into a provider call.
    if (!message || !row.recipient) return this.quarantine(claim, parsed.success ? 'RENDER_FAILED' : 'SNAPSHOT_INVALID', log);
    if (this.config.sendMode === 'allowlist' && !this.config.allowedRecipients.includes(row.recipient)) return this.release(claim);

    const started = await this.startAttempt(claim);
    if (typeof started === 'string') return started;
    const startedAt = this.now();
    logSafely('info', 'Commerce email send attempt.', { event: 'email_send_attempt', ...log, attemptNumber: started.attemptNumber,
      queueAgeMs: startedAt - row.createdAt.getTime() });
    let result: ProviderSendResult;
    try {
      result = await this.transport.send({ to: row.recipient, subject: message.subject, html: message.html, text: message.text,
        tags: ['commerce', row.type.toLowerCase()] });
    } catch { result = { success: false }; } // Unknown transport failure: classified UNCERTAIN, never retried blindly.
    const classification = classifySendResult(result);
    const durationMs = this.now() - startedAt;
    if (classification.kind === 'PAUSE') this.pausedUntil = this.now() + PROVIDER_PAUSE_MS;
    let settled: Settled;
    try { settled = await this.acknowledge(claim, started, classification); }
    catch {
      // The provider may have accepted; the STARTED journal row survives and expired-lease recovery resolves it to UNCERTAIN.
      logSafely('error', 'Commerce email acknowledgement failed.', { event: 'email_send_uncertain', ...log, attemptNumber: started.attemptNumber,
        errorCode: 'ACKNOWLEDGEMENT_FAILED', durationMs });
      return 'UNCERTAIN';
    }
    const fields = { ...log, attemptNumber: started.attemptNumber, durationMs, errorCode: 'code' in classification ? classification.code : null,
      httpStatus: 'httpStatus' in classification ? classification.httpStatus ?? null : null, settled };
    if (settled === 'ACCEPTED') logSafely('info', 'Commerce email accepted by provider.', { event: 'email_provider_accepted', ...fields });
    else if (settled === 'RETRY_WAIT') logSafely('warn', 'Commerce email retry scheduled.', { event: 'email_retry_scheduled', ...fields });
    else if (settled === 'UNCERTAIN') logSafely('error', 'Commerce email send outcome uncertain.', { event: 'email_send_uncertain', ...fields });
    else if (settled === 'FAILED') logSafely('error', 'Commerce email delivery failed.', { event: 'email_delivery_failed', ...fields });
    else logSafely('warn', 'Commerce email acknowledgement was stale.', { event: 'email_ack_stale', ...fields });
    if (classification.kind === 'PAUSE') logSafely('error', 'Commerce email sending paused: provider account or configuration rejected.', {
      event: 'email_worker_unavailable', workerInstanceId: this.workerInstanceId, errorCode: classification.code, pausedForMs: PROVIDER_PAUSE_MS });
    return settled;
  }

  /** Revalidates the live lease and records STARTED (attemptCount+1) in one short transaction. Only after this commits may the provider be called. */
  private async startAttempt(claim: Claim): Promise<{ attemptId: string; attemptNumber: number } | Settled> {
    return this.db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ state: string; leaseToken: string | null; live: boolean; attemptCount: number; active: boolean | null }[]>(Prisma.sql`
        SELECT o."dispatchState"::text AS "state", o."leaseToken"::text AS "leaseToken", o."leaseUntil" > ${DB_NOW} AS "live", o."attemptCount",
          u."isActive" AS "active"
        FROM "commerce_email_outbox" o LEFT JOIN "users" u ON u."id" = o."userId"
        WHERE o."id" = ${claim.id}::uuid FOR UPDATE OF o`);
      const row = rows[0];
      if (!row || row.state !== 'LEASED' || row.leaseToken !== claim.leaseToken || !row.live) return 'LOST';
      // A deactivated/deleted account never receives further commerce mail, even for events created while it was active.
      if (row.active !== true) {
        await tx.$executeRaw(Prisma.sql`UPDATE "commerce_email_outbox" SET "dispatchState" = 'SUPPRESSED', "suppressionReason" = 'ACCOUNT_INACTIVE',
          "leaseToken" = NULL, "leaseUntil" = NULL, "updatedAt" = ${DB_NOW} WHERE "id" = ${claim.id}::uuid`);
        return 'SUPPRESSED';
      }
      if (row.attemptCount >= MAX_SEND_ATTEMPTS) {
        await tx.$executeRaw(Prisma.sql`UPDATE "commerce_email_outbox" SET "dispatchState" = 'FAILED', "failedAt" = ${DB_NOW},
          "lastErrorCode" = 'RETRY_BUDGET_EXHAUSTED', "leaseToken" = NULL, "leaseUntil" = NULL, "updatedAt" = ${DB_NOW} WHERE "id" = ${claim.id}::uuid`);
        return 'FAILED';
      }
      const attemptId = randomUUID(); const attemptNumber = row.attemptCount + 1;
      await tx.$executeRaw(Prisma.sql`INSERT INTO "commerce_email_attempts" ("id", "outboxId", "attemptNumber", "leaseToken", "startedAt", "outcome")
        VALUES (${attemptId}::uuid, ${claim.id}::uuid, ${attemptNumber}, ${claim.leaseToken}::uuid, ${DB_NOW}, 'STARTED')`);
      await tx.$executeRaw(Prisma.sql`UPDATE "commerce_email_outbox" SET "attemptCount" = ${attemptNumber}, "updatedAt" = ${DB_NOW}
        WHERE "id" = ${claim.id}::uuid`);
      return { attemptId, attemptNumber };
    });
  }

  /**
   * Records the attempt's own outcome (a fact about that request, keyed by its identity), then changes the event only while this worker's
   * lease is current and unexpired. A stale worker cannot overwrite a newer claim or an accepted/terminal state.
   */
  private async acknowledge(claim: Claim, started: { attemptId: string; attemptNumber: number }, result: SendClassification): Promise<Settled> {
    return this.db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ state: string; leaseToken: string | null; live: boolean; expired: boolean }[]>(Prisma.sql`
        SELECT "dispatchState"::text AS "state", "leaseToken"::text AS "leaseToken", "leaseUntil" > ${DB_NOW} AS "live",
          "createdAt" + make_interval(secs => ${MAX_RETRY_AGE_MS / 1000}::float8) <= ${DB_NOW} AS "expired"
        FROM "commerce_email_outbox" WHERE "id" = ${claim.id}::uuid FOR UPDATE`);
      const outcome = result.kind === 'ACCEPTED' ? 'ACCEPTED' : result.kind === 'UNCERTAIN' ? 'UNCERTAIN' : 'REJECTED';
      await tx.$executeRaw(Prisma.sql`UPDATE "commerce_email_attempts" SET "outcome" = ${outcome}::"CommerceEmailAttemptOutcome", "finishedAt" = ${DB_NOW},
        "providerMessageId" = ${result.kind === 'ACCEPTED' ? result.messageId : null},
        "httpStatus" = ${'httpStatus' in result ? result.httpStatus ?? null : null}, "errorCode" = ${'code' in result ? result.code : null}
        WHERE "id" = ${started.attemptId}::uuid AND "outcome" = 'STARTED'`);
      const row = rows[0];
      if (!row || row.state !== 'LEASED' || row.leaseToken !== claim.leaseToken || !row.live) return 'STALE';
      return this.settle(tx, claim.id, result, started.attemptNumber, row.expired);
    });
  }

  private async settle(tx: Prisma.TransactionClient, id: string, result: SendClassification, attemptNumber: number, expired: boolean): Promise<Settled> {
    const clear = Prisma.sql`"leaseToken" = NULL, "leaseUntil" = NULL, "updatedAt" = ${DB_NOW}`;
    if (result.kind === 'ACCEPTED') {
      await tx.$executeRaw(Prisma.sql`UPDATE "commerce_email_outbox" SET "dispatchState" = 'ACCEPTED', "provider" = ${this.transport.name},
        "providerMessageId" = ${result.messageId}, "acceptedAt" = ${DB_NOW}, "lastErrorCode" = NULL, ${clear} WHERE "id" = ${id}::uuid`);
      return 'ACCEPTED';
    }
    if (result.kind === 'UNCERTAIN') {
      await tx.$executeRaw(Prisma.sql`UPDATE "commerce_email_outbox" SET "dispatchState" = 'UNCERTAIN', "uncertainAt" = ${DB_NOW},
        "lastErrorCode" = ${result.code}, ${clear} WHERE "id" = ${id}::uuid`);
      return 'UNCERTAIN';
    }
    if (result.kind === 'PERMANENT' || attemptNumber >= MAX_SEND_ATTEMPTS || expired) {
      const code = result.kind === 'PERMANENT' ? result.code : expired ? 'RETRY_AGE_EXCEEDED' : 'RETRY_BUDGET_EXHAUSTED';
      await tx.$executeRaw(Prisma.sql`UPDATE "commerce_email_outbox" SET "dispatchState" = 'FAILED', "failedAt" = ${DB_NOW},
        "lastErrorCode" = ${code}, ${clear} WHERE "id" = ${id}::uuid`);
      return 'FAILED';
    }
    const delay = result.kind === 'PAUSE' ? PROVIDER_PAUSE_MS : retryDelayMs(attemptNumber, result.retryAfterMs);
    await tx.$executeRaw(Prisma.sql`UPDATE "commerce_email_outbox" SET "dispatchState" = 'RETRY_WAIT',
      "nextAttemptAt" = ${DB_NOW} + make_interval(secs => ${delay / 1000}::float8), "lastErrorCode" = ${result.code}, ${clear} WHERE "id" = ${id}::uuid`);
    return 'RETRY_WAIT';
  }

  /** Returns an unstarted claim to READY without consuming send budget. Conditional on this worker's token and no started attempt. */
  private async release(claim: Claim): Promise<Settled> {
    const count = await this.db.$executeRaw(Prisma.sql`UPDATE "commerce_email_outbox" SET "dispatchState" = 'READY', "leaseToken" = NULL,
      "leaseUntil" = NULL, "updatedAt" = ${DB_NOW}
      WHERE "id" = ${claim.id}::uuid AND "dispatchState" = 'LEASED' AND "leaseToken" = ${claim.leaseToken}::uuid
        AND NOT EXISTS (SELECT 1 FROM "commerce_email_attempts" a WHERE a."outboxId" = ${claim.id}::uuid AND a."leaseToken" = ${claim.leaseToken}::uuid)`);
    return count ? 'RELEASED' : 'LOST';
  }

  private async quarantine(claim: Claim, code: string, log: Record<string, unknown>): Promise<Settled> {
    const count = await this.db.$executeRaw(Prisma.sql`UPDATE "commerce_email_outbox" SET "dispatchState" = 'FAILED', "failedAt" = ${DB_NOW},
      "lastErrorCode" = ${code}, "leaseToken" = NULL, "leaseUntil" = NULL, "updatedAt" = ${DB_NOW}
      WHERE "id" = ${claim.id}::uuid AND "dispatchState" = 'LEASED' AND "leaseToken" = ${claim.leaseToken}::uuid`);
    if (count) logSafely('error', 'Commerce email quarantined without a provider call.', { event: 'email_delivery_failed', ...log, errorCode: code });
    return count ? 'FAILED' : 'LOST';
  }

  /**
   * Expired leases. No attempt under that lease → READY (nothing was sent, no budget consumed). An unresolved STARTED attempt → UNCERTAIN
   * (the request may have reached the provider; never resent automatically). A journaled outcome from a stale worker is applied as recorded.
   */
  async recoverExpired(limit = this.config.batchSize): Promise<number> {
    return this.db.$transaction(async tx => {
      const expired = await tx.$queryRaw<Claim[]>(Prisma.sql`
        SELECT "id", "leaseToken"::text AS "leaseToken" FROM "commerce_email_outbox"
        WHERE "dispatchState" = 'LEASED' AND "leaseUntil" <= ${DB_NOW}
        ORDER BY "leaseUntil", "id" LIMIT ${limit} FOR UPDATE SKIP LOCKED`);
      for (const claim of expired) {
        const attempt = await tx.commerceEmailAttempt.findFirst({ where: { outboxId: claim.id, leaseToken: claim.leaseToken },
          orderBy: { attemptNumber: 'desc' }, select: { id: true, attemptNumber: true, outcome: true, providerMessageId: true, errorCode: true } });
        if (!attempt) {
          await tx.$executeRaw(Prisma.sql`UPDATE "commerce_email_outbox" SET "dispatchState" = 'READY', "leaseToken" = NULL, "leaseUntil" = NULL,
            "updatedAt" = ${DB_NOW} WHERE "id" = ${claim.id}::uuid`);
          continue;
        }
        if (attempt.outcome === 'STARTED') {
          await tx.$executeRaw(Prisma.sql`UPDATE "commerce_email_attempts" SET "outcome" = 'UNCERTAIN', "finishedAt" = ${DB_NOW},
            "errorCode" = 'LEASE_EXPIRED_AFTER_START' WHERE "id" = ${attempt.id}::uuid AND "outcome" = 'STARTED'`);
        }
        const result: SendClassification = attempt.outcome === 'ACCEPTED' && attempt.providerMessageId ? { kind: 'ACCEPTED', messageId: attempt.providerMessageId }
          : attempt.outcome === 'REJECTED' && attempt.errorCode
            ? PERMANENT_CODES.has(attempt.errorCode) ? { kind: 'PERMANENT', code: attempt.errorCode } : { kind: 'RETRY', code: attempt.errorCode }
            : { kind: 'UNCERTAIN', code: attempt.outcome === 'STARTED' ? 'SEND_OUTCOME_UNKNOWN' : attempt.errorCode ?? 'SEND_OUTCOME_UNKNOWN' };
        const ageRows = await tx.$queryRaw<{ expired: boolean }[]>(Prisma.sql`SELECT "createdAt" + make_interval(secs => ${MAX_RETRY_AGE_MS / 1000}::float8) <= ${DB_NOW}
          AS "expired" FROM "commerce_email_outbox" WHERE "id" = ${claim.id}::uuid`);
        const settled = await this.settle(tx, claim.id, result, attempt.attemptNumber, ageRows[0]?.expired ?? true);
        if (settled === 'UNCERTAIN') logSafely('error', 'Commerce email send outcome uncertain after lease expiry.', { event: 'email_send_uncertain',
          outboxId: claim.id, attemptNumber: attempt.attemptNumber, workerInstanceId: this.workerInstanceId, errorCode: result.kind === 'UNCERTAIN' ? result.code : null });
      }
      return expired.length;
    });
  }
}

/**
 * Bounded operational snapshot: counts by state, oldest due age, expired leases. Opaque numbers only. With an allowlist (test mode),
 * `allowlistExcluded` counts due events the worker will deliberately never claim because their recipient is not on the list, so a
 * customer who "got no email" can be told apart from a dead worker.
 */
export async function commerceEmailHealth(db: PrismaClient, allowlist: readonly string[] = []) {
  const rows = await db.$queryRaw<{ state: string; count: bigint }[]>(Prisma.sql`
    SELECT "dispatchState"::text AS "state", count(*) AS "count" FROM "commerce_email_outbox" GROUP BY "dispatchState"`);
  const [due] = await db.$queryRaw<{ oldestDueMs: number | null; expiredLeases: bigint; staleReady: bigint }[]>(Prisma.sql`
    SELECT (EXTRACT(EPOCH FROM (${DB_NOW} - min("nextAttemptAt") FILTER (WHERE "dispatchState" IN ('READY', 'RETRY_WAIT') AND "nextAttemptAt" <= ${DB_NOW}))) * 1000)::float8 AS "oldestDueMs",
      count(*) FILTER (WHERE "dispatchState" = 'LEASED' AND "leaseUntil" <= ${DB_NOW}) AS "expiredLeases",
      count(*) FILTER (WHERE "dispatchState" IN ('READY', 'RETRY_WAIT') AND "createdAt" <= ${DB_NOW} - make_interval(secs => ${MAX_RETRY_AGE_MS / 1000}::float8)) AS "staleReady"
    FROM "commerce_email_outbox"`);
  let allowlistExcluded: number | null = null;
  if (allowlist.length) {
    const [excluded] = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(*) AS "n" FROM "commerce_email_outbox"
      WHERE "dispatchState" IN ('READY', 'RETRY_WAIT') AND "nextAttemptAt" <= ${DB_NOW}
        AND "createdAt" > ${DB_NOW} - make_interval(secs => ${MAX_RETRY_AGE_MS / 1000}::float8)
        AND "recipient" IS NOT NULL AND "recipient" NOT IN (${Prisma.join(allowlist)})`);
    allowlistExcluded = Number(excluded?.n ?? 0);
  }
  return { byState: Object.fromEntries(rows.map(row => [row.state, Number(row.count)])), oldestDueMs: due?.oldestDueMs ?? null,
    expiredLeases: Number(due?.expiredLeases ?? 0), staleNeedingReview: Number(due?.staleReady ?? 0), allowlistExcluded, templateVersion: TEMPLATE_VERSION };
}
