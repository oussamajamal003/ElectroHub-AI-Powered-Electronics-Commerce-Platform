/**
 * Task 03.8 migration verifier against a real DISPOSABLE PostgreSQL (launched by scripts/commerce-email-pg.cjs, skipped everywhere else).
 * Runs the real CLI (`scripts/commerce-email-migration.cjs verify LOCAL`, loopback-only) against a known-good database and against
 * deliberately damaged copies of the commerce schema, restoring each change afterwards. It never touches DEV or PROD.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './helpers/payment-postgres-harness.js';

const enabled = process.env.COMMERCE_EMAIL_PG_RUN === '1';
const url = process.env.DATABASE_URL ?? '';
const db = enabled ? createDatabase(url, 'public') : (null as unknown as PrismaClient);
const script = path.resolve(process.cwd(), 'scripts/commerce-email-migration.cjs'); // the harness runs vitest from apps/backend
const cliUrl = (base: string) => `${base}${base.includes('?') ? '&' : '?'}sslmode=require&sslaccept=accept_invalid_certs`;

interface Run { status: number | null; failures: string[]; stdout: string; stderr: string }
function cli(mode: 'verify' | 'preflight', base = url): Run {
  const result = spawnSync(process.execPath, [script, mode, 'LOCAL'], { encoding: 'utf8', timeout: 150_000,
    env: { ...process.env, COMMERCE_EMAIL_VERIFY_LOCAL_URL: cliUrl(base) } });
  let failures: string[] = [];
  try { failures = (JSON.parse(result.stdout) as { failures: string[] }).failures; } catch { /* a startup failure has no JSON */ }
  return { status: result.status, failures, stdout: result.stdout, stderr: result.stderr };
}
const text = async (sql: string) => (await db.$queryRawUnsafe<{ value: string }[]>(sql))[0]!.value;
/** Applies `damage`, runs verify, and always runs `restore` so later cases see a good schema. */
async function damaged(damage: string[], restore: string[], mode: 'verify' | 'preflight' = 'verify'): Promise<Run> {
  try { for (const statement of damage) await db.$executeRawUnsafe(statement); return cli(mode); }
  finally { for (const statement of restore) await db.$executeRawUnsafe(statement); }
}
const expectFailed = (run: Run, code: string) => {
  expect(run.status).toBe(2);
  expect(run.failures).toContain(code);
  expect(run.stderr).toContain(code); // the actionable reason is emitted on stderr, not only in the JSON
  expect(run.stderr + run.stdout).not.toMatch(/postgres(ql)?:\/\//i); // credential-free
};

describe.skipIf(!enabled)('Task 03.8 migration verifier — real PostgreSQL', () => {
  beforeAll(async () => { await db.$queryRaw`SELECT 1`; });
  afterAll(async () => { await db?.$disconnect(); });

  it('passes a correctly migrated database, tolerating the documented historical defaults', () => {
    const run = cli('verify');
    expect(run.failures).toEqual([]);
    expect(run.status).toBe(0);
    const result = JSON.parse(run.stdout) as { drift: { commerce: number }; applied: { finished: boolean; checksumMatches: boolean }[] };
    expect(result.drift.commerce).toBe(0);
    expect(result.applied).toEqual([{ finished: true, rolledBack: false, checksumMatches: true }]);
    expect(cli('preflight').status).toBe(0);
  }, 150_000);

  it('fails when the commerce schema is absent', async () => {
    const run = await damaged(
      [`ALTER TABLE "commerce_email_attempts" RENAME TO "x_attempts"`, `ALTER TABLE "commerce_email_outbox" RENAME TO "x_outbox"`],
      [`ALTER TABLE "x_outbox" RENAME TO "commerce_email_outbox"`, `ALTER TABLE "x_attempts" RENAME TO "commerce_email_attempts"`]);
    expectFailed(run, 'schema:commerce-tables-missing');
  }, 150_000);

  it('fails on a database that has no Prisma ledger at all, with a nonzero exit and no URL in the output', async () => {
    const name = `electrohub_verify_empty_${Date.now()}`;
    await db.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    try {
      const empty = new URL(url); empty.pathname = `/${name}`;
      const run = cli('verify', empty.toString());
      expect(run.status).not.toBe(0);
      expect(run.stdout + run.stderr).not.toMatch(/postgres(ql)?:\/\//i);
    } finally { await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`); }
  }, 150_000);

  it('fails when a required dispatch/lease index is missing', async () => {
    const name = 'commerce_email_outbox_dispatchState_leaseUntil_idx';
    const definition = await text(`SELECT indexdef AS value FROM pg_indexes WHERE indexname = '${name}'`);
    expectFailed(await damaged([`DROP INDEX "${name}"`], [definition]), `schema:index-missing:${name}`);
  }, 150_000);

  it('fails when a required unique index is missing or no longer unique', async () => {
    const name = 'commerce_email_outbox_eventKey_key';
    const definition = await text(`SELECT indexdef AS value FROM pg_indexes WHERE indexname = '${name}'`);
    expectFailed(await damaged([`DROP INDEX "${name}"`, `CREATE INDEX "${name}" ON "commerce_email_outbox"("eventKey")`],
      [`DROP INDEX "${name}"`, definition]), `schema:index-differs:${name}`);
  }, 150_000);

  it('fails when a CHECK constraint is missing or weakened', async () => {
    const name = 'commerce_email_outbox_payload_check';
    const definition = await text(`SELECT pg_get_constraintdef(oid) AS value FROM pg_constraint WHERE conname = '${name}'`);
    const restore = `ALTER TABLE "commerce_email_outbox" ADD CONSTRAINT "${name}" ${definition}`;
    expectFailed(await damaged([`ALTER TABLE "commerce_email_outbox" DROP CONSTRAINT "${name}"`], [restore]), `schema:constraint-missing:${name}`);
    expectFailed(await damaged([`ALTER TABLE "commerce_email_outbox" DROP CONSTRAINT "${name}"`,
      `ALTER TABLE "commerce_email_outbox" ADD CONSTRAINT "${name}" CHECK (true)`],
    [`ALTER TABLE "commerce_email_outbox" DROP CONSTRAINT "${name}"`, restore]), `schema:constraint-definition-differs:${name}`);
  }, 300_000);

  it('fails when a foreign key is missing', async () => {
    const name = 'commerce_email_attempts_outboxId_fkey';
    const definition = await text(`SELECT pg_get_constraintdef(oid) AS value FROM pg_constraint WHERE conname = '${name}'`);
    expectFailed(await damaged([`ALTER TABLE "commerce_email_attempts" DROP CONSTRAINT "${name}"`],
      [`ALTER TABLE "commerce_email_attempts" ADD CONSTRAINT "${name}" ${definition}`]), `schema:constraint-missing:${name}`);
  }, 150_000);

  it('fails when a guard trigger is missing, or its function was replaced by a no-op', async () => {
    const trigger = 'commerce_email_outbox_guard';
    const definition = await text(`SELECT pg_get_triggerdef(oid) AS value FROM pg_trigger WHERE tgname = '${trigger}'`);
    expectFailed(await damaged([`DROP TRIGGER "${trigger}" ON "commerce_email_outbox"`], [definition]), `schema:trigger-missing:${trigger}`);
    const body = await text(`SELECT pg_get_functiondef('"${trigger}"()'::regprocedure) AS value`);
    expectFailed(await damaged([`CREATE OR REPLACE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`], [body]),
      `schema:trigger-function-differs:${trigger}`);
  }, 300_000);

  it('fails when row level security is off or a browser role has any table privilege', async () => {
    expectFailed(await damaged([`ALTER TABLE "commerce_email_outbox" DISABLE ROW LEVEL SECURITY`],
      [`ALTER TABLE "commerce_email_outbox" ENABLE ROW LEVEL SECURITY`]), 'schema:rls-disabled:commerce_email_outbox');
    expectFailed(await damaged([`GRANT SELECT ON "commerce_email_attempts" TO anon`], [`REVOKE ALL ON "commerce_email_attempts" FROM anon`]),
      'schema:browser-role-privilege:anon:commerce_email_attempts');
    expectFailed(await damaged([`GRANT TRUNCATE ON "commerce_email_outbox" TO authenticated`], [`REVOKE ALL ON "commerce_email_outbox" FROM authenticated`]),
      'schema:browser-role-privilege:authenticated:commerce_email_outbox');
  }, 300_000);

  it('is back to passing after every restore', () => {
    const run = cli('verify');
    expect(run.failures).toEqual([]);
    expect(run.status).toBe(0);
  }, 150_000);
});
