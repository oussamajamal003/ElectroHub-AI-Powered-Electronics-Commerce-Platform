/**
 * READ-ONLY latency profile of where time goes before the first statement of a Serializable Cart transaction.
 *
 *   npx tsx scripts/profile-transaction-start.ts [samples=8]
 *
 * It opens ONE dedicated connection (never the application's pool), issues only `SELECT 1`-style statements and
 * transaction control (`BEGIN`, `SET TRANSACTION`, `COMMIT`). It reads no tables and writes nothing. It prints
 * timings only: never the connection string, host, credentials, SQL parameters or any row.
 *
 * Stages (each timed separately, in milliseconds):
 *   connect       new TCP + TLS + auth handshake to the pooler (what an empty or expired pool slot costs)
 *   rtt           `SELECT 1` on a warm connection: the pure network round trip
 *   begin         `BEGIN`
 *   setIsolation  `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` (a second round trip after BEGIN)
 *   firstRead     first `SELECT 1` inside the transaction
 *   commit        `COMMIT`
 *   beginIso      `BEGIN ISOLATION LEVEL SERIALIZABLE` as ONE statement (what a single-round-trip start would cost)
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { env } from '../src/config/env.js';

const samples = Math.min(Math.max(Number(process.argv[2]) || 8, 3), 20);
const url = new URL(env.DIRECT_URL || env.DATABASE_URL);
for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'pgbouncer']) url.searchParams.delete(parameter);
const ca = env.DB_SSL_CA_CERT_PATH ? readFileSync(env.DB_SSL_CA_CERT_PATH, 'utf8') : undefined;

const time = async (action: () => Promise<unknown>) => { const start = performance.now(); await action(); return performance.now() - start; };
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]!;
const rounded = (value: number) => Math.round(value);

async function main() {
  const rows: Record<string, number[]> = { connect: [], rtt: [], begin: [], setIsolation: [], firstRead: [], commit: [], beginIso: [] };
  for (let sample = 0; sample < samples; sample++) {
    const client = new pg.Client({ connectionString: url.toString(), ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true } });
    rows.connect!.push(await time(() => client.connect()));
    try {
      await client.query('SELECT 1'); // warm-up, not recorded
      rows.rtt!.push(await time(() => client.query('SELECT 1')));
      rows.begin!.push(await time(() => client.query('BEGIN')));
      rows.setIsolation!.push(await time(() => client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')));
      rows.firstRead!.push(await time(() => client.query('SELECT 1')));
      rows.commit!.push(await time(() => client.query('COMMIT')));
      rows.beginIso!.push(await time(() => client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')));
      await client.query('ROLLBACK');
    } finally { await client.end(); }
  }
  console.log(`samples=${samples} (ms)  stage            p50   p95   max`);
  for (const [stage, values] of Object.entries(rows)) {
    console.log(`                      ${stage.padEnd(14)} ${String(rounded(median(values))).padStart(5)} ${String(rounded(percentile(values, 0.95))).padStart(5)} ${String(rounded(Math.max(...values))).padStart(5)}`);
  }
  const start = median(rows.begin!) + median(rows.setIsolation!);
  console.log(`\nSerializable start today (BEGIN + SET TRANSACTION): ~${rounded(start)} ms; as one statement: ~${rounded(median(rows.beginIso!))} ms; one network round trip: ~${rounded(median(rows.rtt!))} ms`);
  console.log(`A new connection costs ~${rounded(median(rows.connect!))} ms before any statement.`);
}
main().then(() => process.exit(0), () => { console.error('Profile failed (details intentionally not printed).'); process.exit(1); });
