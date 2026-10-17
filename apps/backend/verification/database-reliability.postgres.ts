import { afterAll, beforeAll, expect, it } from 'vitest';
import pg from 'pg';
import { createServer, Socket } from 'node:net';
import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { PrismaPg } from '@prisma/adapter-pg';
import { ObservablePrismaPg } from '../src/lib/database-adapter.js';
import { flushLogs } from '../src/utils/logger.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

// Outside normal test-discovery paths: only the dedicated runner provisions this target.
// Never fall back to an ambient database or load the full backend.
if (process.env.ELECTROHUB_DB_RELIABILITY_POSTGRES !== '1') throw Error('Disposable runner required');
const endpoint = new URL(process.env.DIRECT_URL!);
if (endpoint.hostname !== '127.0.0.1' || endpoint.username !== 'postgres' || endpoint.pathname !== '/postgres' || endpoint.password) {
  throw Error('Unexpected disposable database identity');
}
const ssl = { ca: readFileSync(process.env.DB_SSL_CA_CERT_PATH!, 'utf8'), rejectUnauthorized: true };
const config = { connectionString: endpoint.toString(), ssl, max: 1, connectionTimeoutMillis: 1000, idleTimeoutMillis: 10000 };
const control = new pg.Client({ ...config, connectionTimeoutMillis: 5000 });
const sockets = new Set<Socket>();
let rejectConnections = false;
const proxy = createServer(socket => {
  if (rejectConnections) { socket.destroy(); return; }
  sockets.add(socket);
  const remote = new Socket(); sockets.add(remote);
  remote.connect(Number(endpoint.port), '127.0.0.1');
  socket.pipe(remote); remote.pipe(socket);
  for (const [one, other] of [[socket, remote], [remote, socket]]) {
    one.on('error', () => other.destroy());
    one.on('close', () => { sockets.delete(one); other.destroy(); });
  }
});
let prisma: (typeof import('../src/lib/prisma.js'))['prisma'];
const app = express();
type Adapter = Awaited<ReturnType<ObservablePrismaPg['connect']>>;
const adapters: Adapter[] = [];
async function adapter() {
  const result = await new ObservablePrismaPg(config).connect(); adapters.push(result); return result;
}
function poolOf(value: Adapter): pg.Pool {
  if ('client' in value && value.client instanceof pg.Pool) return value.client;
  throw Error('Unexpected real adapter layout');
}
async function until(check: () => boolean) { await expect.poll(check, { timeout: 3000 }).toBe(true); }
const select = { sql: 'SELECT 1::int AS value', args: [], argTypes: [] };

beforeAll(async () => {
  await control.connect();
  const identity = await control.query("SELECT current_database() AS db, current_user AS role, version() AS version, (SELECT count(*)::int FROM pg_database WHERE NOT datistemplate) AS databases, (SELECT count(*)::int FROM pg_roles WHERE rolcanlogin) AS roles, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') AS relations");
  expect(identity.rows[0]).toMatchObject({ db: 'postgres', role: 'postgres', databases: 1, roles: 1, relations: 0 });
  expect(identity.rows[0].version).toMatch(/^PostgreSQL /);
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address(); if (!address || typeof address === 'string') throw Error('Proxy unavailable');
  process.env.DIRECT_URL = `postgresql://postgres@127.0.0.1:${address.port}/postgres`;
  ({ prisma } = await import('../src/lib/prisma.js'));
  const health = (await import('../src/routes/health.routes.js')).default;
  app.use('/api', health);
  app.get('/db-probe', (_req, res, next) => {
    void prisma.$queryRaw`SELECT 1::int AS value`.then(result => res.json(result)).catch(next);
  });
  app.use(errorHandler);
});
afterAll(async () => {
  rejectConnections = false;
  await prisma?.$disconnect();
  await Promise.all(adapters.map(value => value.dispose()));
  await control.end();
  for (const socket of sockets) socket.destroy();
  await new Promise<void>(resolve => proxy.close(() => resolve()));
  await flushLogs();
});

it('uses a real TLS connection with certificate verification through the runtime Prisma singleton', async () => {
  const secure = await control.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
  expect(secure.rows[0].ssl).toBe(true);
  expect((await request(app).get('/api/health/ready')).status).toBe(200);
  expect((await request(app).get('/db-probe')).body).toEqual([{ value: 1 }]);
});

it('removes an actually terminated idle client and recovers with a new connection', async () => {
  const observed = await adapter();
  const pool = poolOf(observed);
  const pid = (await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  expect(pool.listenerCount('error')).toBe(1);
  await control.query('SELECT pg_terminate_backend($1)', [pid]);
  await until(() => pool.totalCount === 0);
  expect((await observed.queryRaw(select)).rows).toEqual([[1]]);
  expect((await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid).not.toBe(pid);
});

it('handles connection loss between interactive transaction queries without replaying the transaction', async () => {
  const observed = await adapter();
  const pool = poolOf(observed);
  let client: pg.PoolClient | undefined;
  pool.once('acquire', value => { client = value; });
  const tx = await observed.startTransaction('SERIALIZABLE');
  const pid = (await tx.queryRaw({ sql: 'SELECT pg_backend_pid()', args: [], argTypes: [] })).rows[0][0];
  if (!client) throw Error('Transaction client unavailable');
  const terminated = new Promise<void>(resolve => client!.once('error', () => resolve()));
  let newConnections = 0;
  const countConnection = () => { newConnections++; };
  pool.on('connect', countConnection);
  // The existing connection is checked out; terminating it must not emit an uncaught client error.
  const activeClient = await control.query('SELECT pg_terminate_backend($1)', [pid]);
  expect(activeClient.rows[0].pg_terminate_backend).toBe(true);
  await terminated;
  await expect(tx.queryRaw(select)).rejects.toThrow();
  await tx.rollback(); // Adapter release only; the disconnected backend already rolled back.
  expect(newConnections).toBe(0);
  expect((await observed.queryRaw(select)).rows).toEqual([[1]]);
  expect(newConnections).toBe(1); pool.removeListener('connect', countConnection);
});

it('bounds actual pool exhaustion, then succeeds after the checked-out client is released', async () => {
  const observed = await adapter(); const pool = poolOf(observed);
  const client = await pool.connect();
  const start = Date.now();
  await expect(observed.queryRaw(select)).rejects.toThrow('timeout exceeded when trying to connect');
  expect(Date.now() - start).toBeLessThan(3000);
  expect(pool.waitingCount).toBe(0);
  client.release();
  expect((await observed.queryRaw(select)).rows).toEqual([[1]]);
});

it('keeps HTTP liveness and controlled errors during a TCP outage, then recovers without a restart', async () => {
  rejectConnections = true;
  for (const socket of sockets) socket.destroy();
  try {
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/health/ready')).status).toBe(503);
    const failed = await request(app).get('/db-probe');
    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong. Please try again later.' } });
  } finally { rejectConnections = false; }
  expect((await request(app).get('/api/health/ready')).status).toBe(200);
  expect((await request(app).get('/db-probe')).body).toEqual([{ value: 1 }]);
});

it('ends the real adapter-owned pool on disconnect', async () => {
  const factory = new ObservablePrismaPg(config);
  const observed = await factory.connect(); const pool = poolOf(observed);
  await observed.queryRaw(select); await observed.dispose();
  expect(pool.ended).toBe(true); expect(pool.totalCount).toBe(0);
});

it('persists safe classifications and recovery evidence in the isolated JSON logs', async () => {
  const observed = await adapter();
  const pool = poolOf(observed);
  pool.emit('error', Object.assign(Error('postgresql://private:private-password@private-host/db SELECT private_value'), { code: 'ECONNRESET' }));
  await observed.queryRaw(select);
  await flushLogs();
  const errors = readFileSync(`${process.env.ELECTROHUB_LOG_DIR}/error.log`, 'utf8');
  const activity = readFileSync(`${process.env.ELECTROHUB_LOG_DIR}/app.log`, 'utf8');
  expect(errors).not.toMatch(/private-password|private-host|private_value|postgresql:\/\//);
  const entries = errors.trim().split('\n').map(line => JSON.parse(line));
  expect(entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ operation: 'db.pool.idle_error', failureKind: 'connection_terminated', sqlState: '57P01' }),
    expect.objectContaining({ operation: 'db.driver.read', failureKind: 'pool_acquisition_timeout', durationMs: expect.any(Number) }),
    expect.objectContaining({ operation: 'db.pool.idle_error', failureKind: 'network', driverCode: 'ECONNRESET' }),
  ]));
  expect(activity).toContain('db.connection.recovered');
});

it('confirms the installed baseline adapter has no idle error handler', async () => {
  const baseline = await new PrismaPg(config).connect();
  try { expect(poolOf(baseline).listenerCount('error')).toBe(0); }
  finally { await baseline.dispose(); }
});
