'use strict';
// Task 04.0 read-only delivery evidence for one order's commerce emails: Brevo transactional events (GET /v3/smtp/statistics/events)
// for the provider message IDs already persisted in the outbox. Prints only event types and dates; never recipients, subjects or
// message IDs, and never writes the database (delivery ingestion is not implemented, so this is evidence, not state).
// NODE_ENV=development node scripts/dev-email-delivery-evidence.cjs --order=ORD-<uuid>
const ORDER = /^--order=ORD-([0-9A-F]{8}-[0-9A-F]{4}-[1-8][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12})$/;
const EVIDENCE = new Set(['requests', 'delivered', 'opened', 'clicks', 'softBounces', 'hardBounces', 'deferred', 'blocked', 'invalid', 'spam', 'error', 'unsubscribed']);

/** Collapses Brevo events to a safe summary; delivery is VERIFIED only by a `delivered` event. */
function summarize(events) {
  const kinds = [...new Set((Array.isArray(events) ? events : []).map(event => String(event?.event ?? '')).filter(kind => EVIDENCE.has(kind)))].sort();
  const failed = kinds.some(kind => ['hardBounces', 'softBounces', 'blocked', 'invalid', 'error', 'spam'].includes(kind));
  return { events: kinds, delivery: kinds.includes('delivered') ? 'VERIFIED_DELIVERED' : failed ? 'PROVIDER_REPORTED_FAILURE' : 'NOT_VERIFIED' };
}

async function main(argv = process.argv.slice(2)) {
  const match = argv.length === 1 ? ORDER.exec(argv[0]) : null;
  if (!match || process.env.NODE_ENV !== 'development') throw new Error('Use NODE_ENV=development and --order=ORD-<uuid>.');
  const { env } = require('../dist/config/env.js');
  const { prisma } = require('../dist/lib/prisma.js');
  try {
    const rows = await prisma.commerceEmailOutbox.findMany({ where: { orderId: match[1].toLowerCase() },
      select: { type: true, dispatchState: true, deliveryState: true, acceptedAt: true, providerMessageId: true } });
    const out = [];
    for (const row of rows) {
      let provider = { events: [], delivery: 'NOT_VERIFIED' };
      if (row.providerMessageId && env.BREVO_API_KEY) {
        const url = `https://api.brevo.com/v3/smtp/statistics/events?limit=50&messageId=${encodeURIComponent(row.providerMessageId)}`;
        const response = await fetch(url, { headers: { accept: 'application/json', 'api-key': env.BREVO_API_KEY }, signal: AbortSignal.timeout(15_000) });
        provider = response.ok ? summarize((await response.json())?.events) : { events: [], delivery: `PROVIDER_QUERY_${response.status}` };
      }
      out.push({ type: row.type, dispatchState: row.dispatchState, persistedDeliveryState: row.deliveryState, providerAccepted: Boolean(row.acceptedAt && row.providerMessageId), ...provider });
    }
    console.log(JSON.stringify({ rows: out, observedAt: new Date().toISOString() }));
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch(error => { console.error(String(error?.message ?? 'failed').replace(/[^\s@]+@[^\s@]+/g, '<email>')); process.exitCode = 1; });
module.exports = { summarize };
