// Real-stack payment stress run (real backend + disposable PostgreSQL + Stripe Test Mode + signed webhooks + recovery worker).
// Each attempt is created and submitted through the real API, then confirmed server-side at Stripe with an official test PaymentMethod;
// the browser is not involved, so every terminal state must be carried by the webhook + worker path alone.
// usage: ACCEPT_SP=... ACCEPT_BACKEND_ENV=... node stress-api.mjs <firstCustomer> <lastCustomer> <rounds>
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const sp = process.env.ACCEPT_SP; const base = process.env.ACCEPT_API ?? 'http://127.0.0.1:5100';
const [first, last, rounds] = process.argv.slice(2).map(Number);
const read = name => readFileSync(`${sp}/${name}`, 'utf8').trim();
const psql = process.env.ACCEPT_PGBIN ?? `${sp}/pg17/pgsql/bin/psql.exe`;
const sql = query => execFileSync(psql, ['-h', 'localhost', '-p', '55432', '-U', 'postgres', '-d', 'electrohub_ci', '-Atc', query],
  { encoding: 'utf8', env: { ...process.env, PGPASSWORD: read('pgrun/pw.txt'), PGSSLMODE: 'verify-full', PGSSLROOTCERT: `${sp}/pgrun/tls/ca.pem` } }).trim();
const stripeKey = (() => { const line = readFileSync(process.env.ACCEPT_BACKEND_ENV, 'utf8').split(/\r?\n/).find(l => l.startsWith('STRIPE_SECRET_KEY=')) ?? ''; const key = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, ''); if (!key.startsWith('sk_test_')) throw new Error('not a test key'); return key; })();
const calls = []; const stripe = (path, body) => (calls.push('stripe ' + (body ? 'POST ' : 'GET ') + path.replace(/pi_[A-Za-z0-9]+/, 'pi_*')), fetch(`https://api.stripe.com/v1/${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${stripeKey}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: body ? new URLSearchParams(body) : undefined }).then(r => r.json()));
const ledger = entry => appendFileSync(`${sp}/stripe-ledger.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const TERMINAL = ['PAID', 'DECLINED', 'CANCELED', 'COMPENSATED', 'REFUNDED', 'INCIDENT'];
const skus = ['AG-001', 'AG-002', 'AG-003', 'AG-004', 'AG-005', 'AG-006'];
const shipping = { recipient: 'Stress Customer', line1: '1 Test Street', city: 'Testville', state: 'CA', postalCode: '94105', country: 'United States', phone: '+1 555 010 2000' };

async function api(token, path, init = {}) {
  calls.push('api ' + (init.method ?? 'GET') + ' ' + path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, '<id>'));
  // Node's server closes idle keep-alive sockets after ~5 s; a pooled client socket can be reused just as it closes (UND_ERR_SOCKET).
  // Every call here is safe to replay (GET, idempotent submit, Idempotency-Key setup), exactly as a browser transparently retries.
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(base + path, { ...init, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(init.headers ?? {}) } });
      return { status: response.status, body: await response.json().catch(() => null) };
    } catch (error) { if (attempt >= 2 || error?.cause?.code !== 'UND_ERR_SOCKET') throw error; }
  }
}
async function login(n) {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `accept${n}@example.invalid`, password: read('customer-pw.txt') }) });
  return (await response.json()).accessToken;
}
async function once(n, round) {
  const email = `accept${n}@example.invalid`; const outcome = (n + round) % 2 === 0 ? 'success' : 'decline'; const sku = skus[(n + round) % skus.length]; const started = Date.now();
  const result = { customer: n, round, outcome, sku, ok: false };
  try {
    const token = await login(n);
    sql(`DELETE FROM cart_items WHERE "cartId" IN (SELECT c.id FROM carts c JOIN users u ON u.id = c."userId" WHERE u.email = '${email}')`);
    const productId = sql(`SELECT id FROM products WHERE sku = '${sku}'`);
    const add = await api(token, '/api/cart/items', { method: 'POST', body: JSON.stringify({ productId, quantity: 1 }) }); if (add.status >= 300) throw new Error(`cart add ${add.status}`);
    const cart = (await api(token, '/api/cart')).body.data;
    const setup = await api(token, '/api/checkout/payment-attempts', { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: cart.revision }) });
    if (setup.status >= 300) throw new Error(`setup ${setup.status} ${JSON.stringify(setup.body).slice(0, 120)}`);
    const attemptId = setup.body.data.attemptId; result.attemptId = attemptId;
    result.intentId = sql(`SELECT "providerIntentId" FROM payment_attempts WHERE id = '${attemptId}'`);
    const stockBefore = Number(sql(`SELECT quantity FROM inventory WHERE "productId" = '${productId}'`));
    const submit = await api(token, `/api/checkout/payment-attempts/${attemptId}/submit`, { method: 'POST', body: '{}' }); if (submit.status >= 300) throw new Error(`submit ${submit.status} ${submit.body?.error?.code}`);
    const confirm = await stripe(`payment_intents/${result.intentId}/confirm`, { payment_method: outcome === 'success' ? 'pm_card_visa' : 'pm_card_chargeDeclined', return_url: 'http://127.0.0.1:3120/' });
    ledger({ op: 'stress-confirm', intent: result.intentId, outcome, status: confirm.status ?? confirm.error?.code });
    let state = '';
    for (let i = 0; i < 150; i++) { state = sql(`SELECT state FROM payment_attempts WHERE id = '${attemptId}'`); if (TERMINAL.includes(state)) break; await sleep(1_000); }
    result.finalState = state; result.ms = Date.now() - started;
    const intent = await stripe(`payment_intents/${result.intentId}`); result.intentStatus = intent.status; result.received = intent.amount_received;
    result.orders = Number(sql(`SELECT count(*) FROM orders WHERE id = (SELECT "orderId" FROM payment_attempts WHERE id = '${attemptId}')`));
    result.stockDelta = stockBefore - Number(sql(`SELECT quantity FROM inventory WHERE "productId" = '${productId}'`));
    const expectedState = outcome === 'success' ? 'PAID' : 'DECLINED'; const expectedIntent = outcome === 'success' ? 'succeeded' : 'requires_payment_method';
    result.ok = state === expectedState && intent.status === expectedIntent && result.orders === (outcome === 'success' ? 1 : 0)
      && (outcome === 'success' ? intent.amount_received === intent.amount : intent.amount_received === 0);
  } catch (error) { result.error = String(error.message ?? error).slice(0, 120) + ' | cause: ' + String(error.cause?.code ?? error.cause?.message ?? ''); result.ms = Date.now() - started; result.last = calls.slice(-2).join(' ; '); }
  return result;
}
const stockStart = Object.fromEntries(skus.map(sku => [sku, Number(sql(`SELECT i.quantity FROM inventory i JOIN products p ON p.id = i."productId" WHERE p.sku = '${sku}'`))]));
const customers = Array.from({ length: last - first + 1 }, (_, i) => first + i);
const all = [];
await Promise.all(customers.map(async n => { for (let round = 0; round < rounds; round++) { const r = await once(n, round); all.push(r); console.log(JSON.stringify({ c: r.customer, r: r.round, o: r.outcome, final: r.finalState, intent: r.intentStatus, orders: r.orders, ms: r.ms, ok: r.ok, err: r.error, last: r.last })); } }));
const failures = all.filter(r => !r.ok);
const unavailable = all.filter(r => /PAYMENT_UNAVAILABLE|503/.test(r.error ?? '')).length;
const paidBySku = {}; for (const r of all) if (r.finalState === 'PAID') paidBySku[r.sku] = (paidBySku[r.sku] ?? 0) + 1;
const stockMismatch = skus.filter(sku => stockStart[sku] - Number(sql(`SELECT i.quantity FROM inventory i JOIN products p ON p.id = i."productId" WHERE p.sku = '${sku}'`)) !== (paidBySku[sku] ?? 0));
console.log('PER-SKU STOCK CHECK:', stockMismatch.length ? 'MISMATCH ' + stockMismatch.join(',') : 'exact (stock decreased once per PAID attempt)');
console.log('SETUP/SUBMIT UNAVAILABLE (503) before any payment:', unavailable);
console.log(`STRESS SUMMARY: ${all.length} attempts, ${all.length - failures.length} matched provider truth, ${failures.length} did not; max ${Math.max(...all.map(r => r.ms ?? 0))} ms`);
ledger({ op: 'stress-summary', attempts: all.length, failures: failures.length });
process.exit(failures.length ? 1 : 0);
