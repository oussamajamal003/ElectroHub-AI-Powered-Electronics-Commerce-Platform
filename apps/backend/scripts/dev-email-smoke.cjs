'use strict';
/*
 * Task 03.8 normal-runtime smoke test for the ISOLATED stack (`PORT=5200 npm run dev:isolated`, capture mode). It drives the RUNNING API over
 * HTTP exactly like the checkout UI does (setup -> submit -> confirmation-started -> card confirmation -> automatic finalization), with Stripe
 * TEST MODE only; the single substitution is that the card is confirmed server-side with Stripe's published test payment methods instead of
 * through Stripe.js (use the browser spec tests/isolated/commerce-email.isolated.spec.ts when Stripe.js is reachable).
 *
 * It never sends, claims or triggers an email: it only watches the capture directory the running supervised worker writes to.
 *   node scripts/dev-email-smoke.cjs [--base=http://127.0.0.1:5200]
 * Refuses any non-loopback base URL, any non-test Stripe key, and any credentials other than the isolated fixture file.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const backend = path.resolve(__dirname, '..');
const base = (process.argv.find(arg => arg.startsWith('--base=')) ?? '--base=http://127.0.0.1:5200').slice('--base='.length);
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Refusing: loopback base URL only.');
const stripeKey = { ...dotenv.parse(fs.readFileSync(path.join(backend, '.env'))) }.STRIPE_SECRET_KEY ?? '';
if (!/^sk_test_/.test(stripeKey)) throw new Error('Refusing: Stripe Test Mode key required.');
const stripe = require('stripe')(stripeKey);
const credentials = Object.fromEntries(fs.readFileSync(path.join(backend, '.isolated/fixture-credentials.txt'), 'utf8').trim().split('\n').map(line => line.split('=')));
const captureDir = path.join(backend, '.isolated/email-capture');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const real = process.argv.includes('--real'); // real Brevo mode: no capture files; checks the order's reported state instead
const loginEmail = (process.argv.find(arg => arg.startsWith('--login-email=')) ?? '').slice('--login-email='.length);
const mask = value => String(value).replace(/^(.{2}).*(@.*)$/, '$1***$2');

let token = '';
async function api(method, url, body, headers = {}) {
  const response = await fetch(`${base}/api${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json };
}
const captured = () => (fs.existsSync(captureDir) ? fs.readdirSync(captureDir).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(captureDir, name), 'utf8'))) : []);
const forReference = reference => captured().filter(message => message.subject.includes(reference));
async function until(label, probe, timeoutMs, intervalMs = 1000) {
  const start = Date.now();
  for (;;) { const value = await probe(); if (value) return value; if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`); await sleep(intervalMs); }
}
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + JSON.stringify(detail) : ''}`); if (!ok) process.exitCode = 1; };

async function stockCart() {
  const cart = (await api('GET', '/cart')).json.data;
  for (const item of cart.items) await api('DELETE', `/cart/items/${item.productId}`);
  const products = (await api('GET', '/products')).json.data;
  for (const product of products) { if ((await api('POST', '/cart/items', { productId: product.id, quantity: 1 })).status === 201) break; }
  return (await api('GET', '/cart')).json.data.revision;
}
/** setup -> submit -> confirmation-started -> server-side card confirmation, mirroring the UI's Place Order sequence. */
async function checkout(paymentMethod) {
  const revision = await stockCart();
  const setup = await api('POST', '/checkout/payment-attempts', { shipping: { recipient: 'Isolated Tester', line1: '1 Test Street', line2: '', city: 'Testville', state: 'CA',
    postalCode: '94105', country: 'United States', phone: '+1 555 010 2000' }, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: revision }, { 'Idempotency-Key': crypto.randomUUID() });
  if (![200, 201, 202].includes(setup.status)) throw new Error(`setup failed (${setup.status}) ${JSON.stringify(setup.json).slice(0, 200)}`);
  const attemptId = setup.json.data.attemptId;
  const ready = await until('payment form ready', async () => { const data = await stateOf(attemptId); return data?.intentId && data.state === 'AWAITING_INPUT' ? data : null; }, 60000);
  const intentId = ready.intentId;
  const submit = await api('POST', `/checkout/payment-attempts/${attemptId}/submit`, {});
  if (![200, 202].includes(submit.status)) throw new Error(`submit failed (${submit.status}) ${JSON.stringify(submit.json).slice(0, 200)}`);
  await api('POST', `/checkout/payment-attempts/${attemptId}/confirmation-started`, {});
  try { await stripe.paymentIntents.confirm(intentId, { payment_method: paymentMethod }); } catch (error) { if (error.type !== 'StripeCardError') throw error; }
  return { attemptId, intentId };
}
const stateOf = async attemptId => (await api('GET', `/checkout/payment-attempts/${attemptId}`)).json?.data;

(async () => {
  const login = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: loginEmail || credentials.customer, password: credentials.customer_password }) })).json();
  token = login.accessToken;
  const customer = (loginEmail || credentials.customer).toLowerCase();
  console.log(`stack ${base}; customer ${mask(customer)}; mode ${real ? 'REAL Brevo (approved recipient only)' : 'capture, dir ' + path.relative(backend, captureDir)}`);
  const baseline = captured().length;

  // 1. A declined card: the purchase fails and no success email appears.
  const declined = await checkout('pm_card_chargeDeclined');
  const declinedState = await until('declined state', async () => { const data = await stateOf(declined.attemptId); return data && ['DECLINED', 'CANCELED'].includes(data.state) ? data.state : null; }, 90000);
  await sleep(8000);
  check('declined payment: attempt DECLINED' + (real ? '' : ' and no email'), declinedState === 'DECLINED' && (real || captured().length === baseline), { state: declinedState, newEmails: real ? 'n/a' : captured().length - baseline });

  // 2. Two successful purchases, nothing triggered by this script besides the purchase itself.
  const references = [];
  for (const label of real ? ['first'] : ['first', 'second']) {
    const purchase = await checkout('pm_card_visa');
    const paid = await until(`${label} purchase PAID`, async () => { const data = await stateOf(purchase.attemptId); return data && data.state === 'PAID' ? data : null; }, 180000);
    const order = paid.orderReference;
    check(`${label} purchase: PAID with an order reference`, Boolean(order), { state: paid.state, reference: order });
    if (!order) continue;
    references.push(order);
    if (real) {
      const projection = await until('real projection SENT', async () => { const d = (await api('GET', `/orders/${order}`)).json?.data; return d?.emailConfirmation?.state === 'SENT' ? d.emailConfirmation : null; }, 120000, 2000);
      check('real Brevo: order details report SENT (both confirmations accepted by Brevo; mailbox receipt is for the owner to confirm)', projection.state === 'SENT', { reference: order });
      continue;
    }
    const mails = await until(`${label} two emails`, async () => { const found = forReference(order); return found.length >= 2 ? found : null; }, 90000);
    await sleep(5000);
    const final = forReference(order);
    check(`${label} purchase: exactly two emails (Order confirmed, Payment confirmed) automatically`,
      final.length === 2 && final.map(m => m.subject).sort().join('|') === [`Order confirmed — ${order}`, `Payment confirmed — ${order}`].sort().join('|'), { count: final.length });
    check(`${label} purchase: both addressed to the signed-in customer only`, final.every(m => m.to === customer) && new Set(final.map(m => m.messageId)).size === 2, { distinctRecipients: new Set(final.map(m => m.to)).size });
    const details = (await api('GET', `/orders/${order}`)).json?.data;
    const projection = await until(`${label} projection SENT`, async () => { const d = (await api('GET', `/orders/${order}`)).json?.data; return d?.emailConfirmation?.state === 'SENT' ? d.emailConfirmation : null; }, 60000);
    check(`${label} purchase: order details report email SENT (truthfully, after the worker accepted)`, projection.state === 'SENT', { keys: Object.keys(projection), orderStatus: details?.status });
    void mails;
  }
  // 3. Re-reading orders never creates or sends anything.
  const before = captured().length;
  for (const reference of references) { await api('GET', `/orders/${reference}`); await api('GET', `/checkout/confirmation/${reference}`); }
  await api('GET', '/checkout/payment-attempts');
  await sleep(8000);
  if (!real) check('reading orders / purchases again sends nothing', captured().length === before, { newEmails: captured().length - before });
  if (!real) {
    check('exactly four new emails in total (2 purchases x 2)', captured().length === baseline + 4, { total: captured().length - baseline });
    check('no email carries another purchase\'s reference', references.length === 2 && references.every((reference, index) => forReference(reference).every(m => !m.html.includes(references[1 - index]))));
  }
  console.log(JSON.stringify({ passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, references }));
})().catch(error => { console.error('SMOKE ERROR:', String(error.message).replace(/[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+/g, '[address]').slice(0, 400)); process.exitCode = 1; });
