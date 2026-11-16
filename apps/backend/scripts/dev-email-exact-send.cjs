'use strict';
// Task 04.0 exact-scope DEV commerce email acceptance. Dry-run by default; never replays other backlog.
// node scripts/dev-email-exact-send.cjs --order=ORD-<uuid> [--send --confirm-recipient=<email>]
// Read-only checks: the order's owner is the recipient, and that recipient's only sendable outbox rows are exactly this order's
// events (at most 2). --send runs the existing commerce email worker ONCE in allowlist mode with only that recipient allowed,
// so the dispatcher's claim SQL cannot select any other recipient's rows. It then reports enqueue, dispatch, provider acceptance
// and delivery separately; queued is never reported as sent, and provider acceptance is never reported as delivery.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const backend = path.resolve(__dirname, '..');
const ORDER = /^ORD-([0-9A-F]{8}-[0-9A-F]{4}-[1-8][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12})$/;
const SENDABLE = ['READY', 'RETRY_WAIT', 'LEASED'];

function parse(argv) {
  const order = argv.find(arg => arg.startsWith('--order='))?.slice(8) ?? '';
  const confirm = argv.find(arg => arg.startsWith('--confirm-recipient='))?.slice(20).trim().toLowerCase() ?? '';
  const send = argv.includes('--send');
  if (!ORDER.test(order) || argv.some(arg => !/^--(order|confirm-recipient)=/.test(arg) && arg !== '--send')) throw new Error('Use --order=ORD-<uuid> [--send --confirm-recipient=<email>].');
  if (send && !confirm) throw new Error('--send requires --confirm-recipient equal to the order owner address.');
  return { orderId: ORDER.exec(order)[1].toLowerCase(), send, confirm };
}

const mask = email => email.replace(/^(.)(.*)(@.*)$/, (_m, a, b, c) => `${a}${'*'.repeat(Math.min(b.length, 6))}${c}`);

/** Pure scope check: every sendable row for the recipient belongs to this order, and the order has 1..2 of them. */
function assertExactScope(rows, orderId) {
  const sendable = rows.filter(row => SENDABLE.includes(row.dispatchState));
  if (!sendable.length) throw new Error('EMAIL_NOTHING_TO_SEND');
  if (sendable.some(row => row.orderId !== orderId)) throw new Error('EMAIL_RECIPIENT_HAS_OTHER_BACKLOG');
  if (sendable.length > 2 || sendable.some(row => row.dispatchState === 'LEASED')) throw new Error('EMAIL_SCOPE_NOT_EXACT');
  return sendable.length;
}

async function snapshot(prisma, orderId, recipient) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { user: { select: { email: true } } } });
  if (!order) throw new Error('EMAIL_ORDER_NOT_FOUND');
  const owner = order.user.email.trim().toLowerCase();
  const rows = await prisma.commerceEmailOutbox.findMany({ where: { recipient: recipient ?? owner },
    select: { orderId: true, type: true, dispatchState: true, deliveryState: true, attemptCount: true, acceptedAt: true, deliveredAt: true, providerMessageId: true, lastErrorCode: true } });
  return { owner, rows };
}

const report = (rows, orderId) => rows.filter(row => row.orderId === orderId).map(row => ({ type: row.type, enqueued: true,
  dispatched: row.attemptCount > 0, providerAccepted: Boolean(row.acceptedAt && row.providerMessageId), dispatchState: row.dispatchState,
  delivered: row.deliveryState === 'DELIVERED' ? 'PROVIDER_REPORTED' : 'UNVERIFIED', deliveryState: row.deliveryState, lastErrorCode: row.lastErrorCode }));

async function main(argv = process.argv.slice(2)) {
  const options = parse(argv);
  if (process.env.NODE_ENV !== 'development') throw new Error('DEV only.');
  const { prisma } = require('../dist/lib/prisma.js');
  try {
    const before = await snapshot(prisma, options.orderId);
    const count = assertExactScope(before.rows, options.orderId);
    console.log(JSON.stringify({ mode: options.send ? 'send' : 'dry-run', recipient: mask(before.owner), sendableRows: count, rows: report(before.rows, options.orderId) }));
    if (!options.send) return;
    if (options.confirm !== before.owner) throw new Error('EMAIL_RECIPIENT_CONFIRMATION_MISMATCH');
    await prisma.$disconnect();
    const run = spawnSync(process.execPath, ['dist/commerce-email-runner.js', '--once'], { cwd: backend, stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, npm_lifecycle_event: '', COMMERCE_EMAIL_DISPATCH_ENABLED: 'true', COMMERCE_EMAIL_SEND_MODE: 'allowlist',
        COMMERCE_EMAIL_ALLOWED_RECIPIENTS: before.owner, COMMERCE_EMAIL_LIVE_APPROVED_TARGET: '' }, timeout: 120_000 });
    const after = await snapshot(require('../dist/lib/prisma.js').prisma, options.orderId);
    console.log(JSON.stringify({ workerExit: run.status, rows: report(after.rows, options.orderId),
      otherBacklogUntouched: after.rows.filter(row => row.orderId !== options.orderId).length === before.rows.filter(row => row.orderId !== options.orderId).length }));
  } finally { await require('../dist/lib/prisma.js').prisma.$disconnect(); }
}

if (require.main === module) main().catch(error => { console.error(String(error.message).replace(/[^\s@]+@[^\s@]+/g, '<email>')); process.exitCode = 1; });
module.exports = { parse, assertExactScope, report };
