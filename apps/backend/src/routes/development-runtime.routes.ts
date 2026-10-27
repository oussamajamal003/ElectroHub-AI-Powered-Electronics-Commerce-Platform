import { Router } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { resolveDatabaseTargets } from '../lib/database-target.js';

const router = Router();
const instanceId = randomUUID();
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Private local QA handshake: no project names, endpoints, credentials or customer data are returned. */
router.get('/internal/development-runtime', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const expected = process.env.ELECTROHUB_DEV_DIAGNOSTIC_TOKEN ?? '';
  const supplied = req.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (process.env.NODE_ENV === 'production' || !loopback.has(req.socket.remoteAddress ?? '') ||
    !/^[a-f0-9]{64}$/.test(expected) || suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(expectedBytes, suppliedBytes)) {
    res.sendStatus(404); return;
  }
  try {
    const target = resolveDatabaseTargets(process.env);
    const url = new URL(target.runtimeUrl);
    const rows = await prisma.$queryRaw<{ database: string; port: number; address: string; tls: boolean }[]>`
      SELECT current_database()::text AS database, inet_server_port() AS port, host(inet_server_addr()) AS address,
        (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls`;
    const row = rows[0];
    const local = target.runtime.category === 'disposable';
    // Supavisor's pg_stat_ssl describes its internal PostgreSQL hop, not our authenticated TLS socket.
    // Prisma always uses rejectUnauthorized:true; a successful query through that client proves the pooler TLS leg.
    const serverTlsRequired = target.runtime.transport !== 'session-pooler';
    // Task 04.2: the launcher's pgvector container (ISOLATED_PG_DOCKER=1) is reached on loopback, but PostgreSQL reports its
    // own Docker bridge address; only that private range is accepted, and only for the launcher-declared Docker mode.
    const localServer = loopback.has(row?.address ?? '') ||
      (process.env.ISOLATED_PG_DOCKER === '1' && /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(row?.address ?? ''));
    if (!row || (serverTlsRequired && !row.tls) || row.database !== decodeURIComponent(url.pathname.slice(1)) ||
      row.port !== Number(url.port || 5432) || (local && !localServer)) throw new Error('IDENTITY_NOT_VERIFIED');
    res.json({ data: { mode: local ? 'ISOLATED_QA' : 'MAIN_DEV', instanceId, databaseReady: true, tlsVerified: true } });
  } catch { res.status(503).json({ error: { code: 'DEVELOPMENT_RUNTIME_NOT_READY' } }); }
});

export default router;
