/*
 * Opt-in disposable PostgreSQL contract harness for Task 03.6.
 * This deliberately tests database concurrency/constraints only; it does not
 * start the API/worker, invoke PaymentService, or contact Stripe.
 */
const { Client } = require('pg');
const { randomUUID } = require('node:crypto');

const url = process.env.PAYMENT_PG_TEST_DATABASE_URL;
const approved = process.env.PAYMENT_PG_TEST_APPROVED === 'I_APPROVE_DISPOSABLE_PG_WRITES';
const target = process.env.PAYMENT_PG_TEST_TARGET === 'disposable';
if (!url || !approved || !target) {
  console.error('BLOCKED: provide PAYMENT_PG_TEST_DATABASE_URL, PAYMENT_PG_TEST_TARGET=disposable, and PAYMENT_PG_TEST_APPROVED=I_APPROVE_DISPOSABLE_PG_WRITES.');
  process.exit(2);
}
const parsed = new URL(url);
if (/(supabase\.co|pzxekjybdiulzmssalfo|yepfgjehdstlxbpespun)/i.test(parsed.hostname + parsed.href)) {
  console.error('BLOCKED: known Supabase DEV/PROD endpoints are prohibited.');
  process.exit(2);
}

const schema = `payment_acceptance_${randomUUID().replaceAll('-', '')}`;
const quote = value => `"${value.replaceAll('"', '""')}"`;
const makeClient = () => new Client({ connectionString: url, connectionTimeoutMillis: 5000, ssl: parsed.searchParams.get('sslmode') === 'disable' ? false : { rejectUnauthorized: true } });
const clients = [];
let schemaCreated = false;
async function expectReject(operation, code) {
  try { await operation(); throw new Error(`Expected PostgreSQL ${code} rejection.`); }
  catch (error) { if (error.message.startsWith('Expected PostgreSQL')) throw error; if (error.code !== code) throw error; }
}
async function main() {
  const admin = makeClient(); clients.push(admin); await admin.connect();
  await admin.query(`CREATE SCHEMA ${quote(schema)}`);
  schemaCreated = true;
  const a = makeClient(); const b = makeClient(); clients.push(a, b); await Promise.all([a.connect(), b.connect()]);
  for (const client of [a, b]) await client.query(`SET search_path TO ${quote(schema)}`);
  await a.query(`CREATE TABLE attempts (id uuid PRIMARY KEY, submitted_at timestamptz, active_cart_id uuid, work_state text NOT NULL, lease_token uuid, lease_until timestamptz, CONSTRAINT submitted_releases_cart CHECK (submitted_at IS NULL OR active_cart_id IS NULL)); CREATE TABLE lines (id uuid PRIMARY KEY, source_line_id uuid UNIQUE)`);
  const attempt = randomUUID(); const cart = randomUUID(); const line = randomUUID(); const token = randomUUID();
  await a.query('INSERT INTO attempts(id, active_cart_id, work_state, lease_token, lease_until) VALUES($1,$2,$3,$4,now()+interval \'1 minute\')', [attempt, cart, 'LEASED', token]);
  await a.query('INSERT INTO lines(id, source_line_id) VALUES($1,$1)', [line]);

  // Concurrent exact-line transfer: row fencing plus uniqueness allows one owner.
  await Promise.all([a.query('BEGIN'), b.query('BEGIN')]);
  await a.query('SELECT id FROM attempts WHERE id=$1 FOR UPDATE', [attempt]);
  const secondLock = b.query('SELECT id FROM attempts WHERE id=$1 FOR UPDATE', [attempt]);
  await a.query('UPDATE lines SET source_line_id=$1 WHERE id=$1', [line]);
  await a.query('UPDATE attempts SET submitted_at=now(), active_cart_id=NULL WHERE id=$1 AND submitted_at IS NULL', [attempt]);
  await a.query('COMMIT'); await secondLock;
  const secondClaim = await b.query('UPDATE attempts SET submitted_at=now(), active_cart_id=NULL WHERE id=$1 AND submitted_at IS NULL RETURNING id', [attempt]);
  await b.query('COMMIT');
  if (secondClaim.rowCount !== 0) throw new Error('Concurrent submit unexpectedly claimed the already submitted purchase.');
  await expectReject(() => a.query('INSERT INTO lines(id, source_line_id) VALUES($1,$2)', [randomUUID(), line]), '23505');
  await expectReject(() => a.query('UPDATE attempts SET active_cart_id=$2 WHERE id=$1', [attempt, cart]), '23514');

  // A transaction interrupted after its first ownership write rolls back both writes.
  const rollbackAttempt = randomUUID(); const rollbackLine = randomUUID(); const rollbackCart = randomUUID();
  await a.query('INSERT INTO attempts(id, active_cart_id, work_state) VALUES($1,$2,$3)', [rollbackAttempt, rollbackCart, 'READY']);
  await a.query('INSERT INTO lines(id) VALUES($1)', [rollbackLine]); await a.query('BEGIN');
  await a.query('UPDATE lines SET source_line_id=$1 WHERE id=$1', [rollbackLine]);
  await a.query('UPDATE attempts SET submitted_at=now(), active_cart_id=NULL WHERE id=$1', [rollbackAttempt]);
  await a.query('ROLLBACK');
  const rolled = await a.query('SELECT submitted_at, active_cart_id FROM attempts WHERE id=$1', [rollbackAttempt]);
  const rolledLine = await a.query('SELECT source_line_id FROM lines WHERE id=$1', [rollbackLine]);
  if (rolled.rows[0].submitted_at !== null || rolled.rows[0].active_cart_id !== rollbackCart || rolledLine.rows[0].source_line_id !== null) throw new Error('Rollback left partial ownership writes.');

  // Stale lease token cannot pass the same lock-and-token fence used by the worker.
  const stale = await a.query('UPDATE attempts SET work_state=$2 WHERE id=$1 AND work_state=$3 AND lease_token=$4 AND lease_until>now() RETURNING id', [attempt, 'DONE', 'LEASED', randomUUID()]);
  if (stale.rowCount !== 0) throw new Error('Stale lease token changed current work.');
  console.log('PASS: disposable PostgreSQL ownership constraints, concurrent claim, atomic rollback, and stale-token fence. This is DB-contract evidence only; it does not exercise PaymentService/order/webhook/provider paths.');
}
main().catch(error => { console.error(`FAIL: PostgreSQL harness failed (${error.code || error.name || 'unknown'}).`); process.exitCode = 1; })
  .finally(async () => {
    for (const client of clients.slice(1)) { try { await client.end(); } catch {} }
    if (schemaCreated && clients[0]) { try { await clients[0].query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`); } catch { process.exitCode = 1; } }
    if (clients[0]) { try { await clients[0].end(); } catch {} }
  });
