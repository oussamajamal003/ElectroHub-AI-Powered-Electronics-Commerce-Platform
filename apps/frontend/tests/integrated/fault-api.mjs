// Real-stack fault injection (disposable PostgreSQL + Stripe Test Mode + signed webhooks + recovery worker).
// usage: ACCEPT_SP=... ACCEPT_BACKEND_ENV=... ACCEPT_PGBIN=<psql.exe> node fault-api.mjs lease|dbdown|webhooks
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const sp = process.env.ACCEPT_SP; const base = 'http://127.0.0.1:5100'; const scenario = process.argv[2];
const read = name => readFileSync(`${sp}/${name}`, 'utf8').trim();
const psql = process.env.ACCEPT_PGBIN; const pgCtl = psql.replace('psql.exe', 'pg_ctl.exe');
const pgEnv = () => ({ ...process.env, PGPASSWORD: read('pgrun/pw.txt'), PGSSLMODE: 'verify-full', PGSSLROOTCERT: `${sp}/pgrun/tls/ca.pem` });
const sql = query => execFileSync(psql, ['-h', 'localhost', '-p', '55432', '-U', 'postgres', '-d', 'electrohub_ci', '-Atc', query], { encoding: 'utf8', env: pgEnv() }).trim();
const key = (() => { const line = readFileSync(process.env.ACCEPT_BACKEND_ENV, 'utf8').split(/\r?\n/).find(l => l.startsWith('STRIPE_SECRET_KEY=')) ?? ''; const k = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, ''); if (!k.startsWith('sk_test_')) throw new Error('not a test key'); return k; })();
const stripe = (path, body) => fetch(`https://api.stripe.com/v1/${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: body ? new URLSearchParams(body) : undefined }).then(r => r.json());
const ledger = entry => appendFileSync(`${sp}/stripe-ledger.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (check, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await sleep(1_000); } throw new Error(`timeout: ${label}`); };
const api = async (token, path, init = {}) => { for (let i = 0; ; i++) { try { const r = await fetch(base + path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; } catch (e) { if (i >= 2 || e?.cause?.code !== 'UND_ERR_SOCKET') throw e; } } };
const shipping = { recipient: 'Fault Customer', line1: '1 Test Street', city: 'Testville', state: 'CA', postalCode: '94105', country: 'United States', phone: '+1 555 010 2000' };
const clientPids = () => { const lines = execFileSync('netstat', ['-ano'], { encoding: 'utf8' }).split(/\r?\n/); const pick = re => new Set(lines.filter(l => re.test(l)).map(l => Number(l.trim().split(/\s+/).at(-1)))); const api5100 = pick(/:5100\s+\S+\s+LISTENING/); return [...pick(/127\.0\.0\.1:\d+\s+127\.0\.0\.1:55432\s+ESTABLISHED/)].filter(p => p > 0 && !api5100.has(p)); };
const stopWorker = () => { for (const pid of clientPids()) { try { execFileSync('taskkill', ['/PID', String(pid), '/F']); } catch { /* gone */ } } };
const startWorker = () => spawn('bash', [`${sp}/run-proc.sh`, 'worker'], { detached: true, stdio: 'ignore' }).unref();
const login = async n => (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `accept${n}@example.invalid`, password: read('customer-pw.txt') }) })).json()).accessToken;

async function submittedAttempt(n, sku) {
  const email = `accept${n}@example.invalid`; const token = await login(n);
  sql(`DELETE FROM cart_items WHERE "cartId" IN (SELECT c.id FROM carts c JOIN users u ON u.id = c."userId" WHERE u.email = '${email}')`);
  const productId = sql(`SELECT id FROM products WHERE sku = '${sku}'`);
  await api(token, '/api/cart/items', { method: 'POST', body: JSON.stringify({ productId, quantity: 1 }) });
  const cart = (await api(token, '/api/cart')).body.data;
  const setup = await api(token, '/api/checkout/payment-attempts', { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ shipping, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: cart.revision }) });
  if (setup.status >= 300) throw new Error(`setup ${setup.status} ${JSON.stringify(setup.body).slice(0, 100)}`);
  const id = setup.body.data.attemptId; const submit = await api(token, `/api/checkout/payment-attempts/${id}/submit`, { method: 'POST', body: '{}' });
  if (submit.status >= 300) throw new Error(`submit ${submit.status}`);
  return { id, intentId: sql(`SELECT "providerIntentId" FROM payment_attempts WHERE id = '${id}'`), email };
}
const stateOf = id => sql(`SELECT state FROM payment_attempts WHERE id = '${id}'`);
const orderCount = (email) => Number(sql(`SELECT count(*) FROM orders o JOIN users u ON u.id = o."userId" WHERE u.email = '${email}'`));
const report = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail ?? ''}`); ledger({ op: 'fault', name, ok, detail }); if (!ok) process.exitCode = 1; };

if (scenario === 'lease') {
  const a = await submittedAttempt(13, 'AG-002'); stopWorker(); await sleep(2_000);
  // A worker "died" mid-lease: the lease is held by a token nobody owns and has expired.
  sql(`UPDATE payment_work SET state = 'LEASED', "leaseToken" = '00000000-0000-4000-8000-000000000000', "leaseUntil" = now() - interval '5 minutes' WHERE "attemptId" = '${a.id}'`);
  await stripe(`payment_intents/${a.intentId}/confirm`, { payment_method: 'pm_card_visa', return_url: 'http://127.0.0.1:3120/' });
  await sleep(8_000); const midState = stateOf(a.id);
  startWorker();
  await waitFor(() => stateOf(a.id) === 'PAID', 180_000, 'PAID after expired-lease takeover');
  const intent = await stripe(`payment_intents/${a.intentId}`);
  report('expired lease reclaimed by a new worker', intent.status === 'succeeded' && orderCount(a.email) === 1, `(state while worker down: ${midState}; intent ${intent.status}; orders ${orderCount(a.email)})`);
}
if (scenario === 'dbdown') {
  const a = await submittedAttempt(14, 'AG-003');
  await stripe(`payment_intents/${a.intentId}/confirm`, { payment_method: 'pm_card_visa', return_url: 'http://127.0.0.1:3120/' });
  execFileSync(pgCtl, ['-D', `${sp}/pgrun/data`, 'stop', '-m', 'fast'], { stdio: 'ignore' }); ledger({ op: 'fault', name: 'postgres stopped' });
  await sleep(25_000);
  spawn(pgCtl, ['-D', `${sp}/pgrun/data`, '-l', `${sp}/pgrun/pg.log`, 'start'], { detached: true, stdio: 'ignore' }).unref();
  await waitFor(() => { try { sql('SELECT 1'); return true; } catch { return false; } }, 60_000, 'postgres back');
  await waitFor(() => stateOf(a.id) === 'PAID', 240_000, 'PAID after database outage');
  const intent = await stripe(`payment_intents/${a.intentId}`);
  report('database outage mid-payment recovers to PAID exactly once', intent.status === 'succeeded' && orderCount(a.email) === 1, `(intent ${intent.status}; orders ${orderCount(a.email)})`);
}
if (scenario === 'webhooks') {
  const paid = sql(`SELECT a."providerIntentId" || '|' || a."orderId" || '|' || u.email FROM payment_attempts a JOIN users u ON u.id = a."userId" WHERE a.state = 'PAID' ORDER BY a."updatedAt" DESC LIMIT 1`).split('|');
  const [intentId, orderId, email] = paid; const before = { orders: orderCount(email), events: sql('SELECT count(*) FROM stripe_events') };
  const events = (await stripe(`events?limit=100&type=payment_intent.succeeded`)).data.filter(e => e.data.object.id === intentId);
  const older = (await stripe(`events?limit=100&type=payment_intent.amount_capturable_updated`)).data.filter(e => e.data.object.id === intentId);
  const targets = [...events, ...older].slice(0, 2); if (!targets.length) throw new Error('no events found for the PAID intent');
  for (const event of targets) for (let i = 0; i < 2; i++) { execFileSync('stripe', ['events', 'resend', event.id, '--api-key', key], { stdio: 'ignore' }); ledger({ op: 'webhook-resend', event: event.type, id: event.id }); await sleep(3_000); }
  await sleep(15_000);
  const after = { orders: orderCount(email), events: sql('SELECT count(*) FROM stripe_events') };
  const attempt = sql(`SELECT a.state || '|' || (SELECT count(*) FROM orders WHERE id = '${orderId}') FROM payment_attempts a WHERE a."orderId" = '${orderId}'`);
  report('duplicate + out-of-order signed webhooks leave one PAID order', attempt === 'PAID|1' && after.orders === before.orders, `(resent ${targets.length} distinct events x2; stripe_events ${before.events} -> ${after.events}; orders ${before.orders} -> ${after.orders}; attempt ${attempt})`);
}
if (scenario === 'abandon') {
  const age = (id, minutes, due = "now()") => sql(`UPDATE payment_attempts SET "expiresAt" = now() - interval '${minutes} minutes', "submittedAt" = now() - interval '${minutes} minutes' WHERE id = '${id}'; UPDATE payment_work SET state = 'READY', "nextRunAt" = ${due}, "leaseToken" = NULL, "leaseUntil" = NULL WHERE "attemptId" = '${id}'`);
  const row = id => sql(`SELECT state || '|' || coalesce("failureCode",'') || '|' || coalesce("orderId"::text,'') FROM payment_attempts WHERE id = '${id}'`);
  const visible = async (token, id) => { const r = await api(token, '/api/checkout/payment-attempts'); const items = JSON.stringify(r.body); return items.includes(id); };
  const settle = async (id, states, label) => waitFor(() => states.includes(row(id).split('|')[0]), 120_000, label);
  const customerView = async (n, id) => { const token = await login(n); const r = await api(token, `/api/checkout/payment-attempts/${id}`); return r.body?.data?.classification ?? `${r.status}:${JSON.stringify(r.body).slice(0,150)}`; };

  // 1. 15-minute boundary: just inside the window nothing is cancelled; just outside it the attempt is ABANDONED, never a failure.
  const a = await submittedAttempt(9, 'AG-001'); const tokenA = await login(9);
  age(a.id, 14); await sleep(20_000);
  report('boundary: 14 minutes with no card is NOT cancelled', row(a.id).startsWith('AWAITING_INPUT'), `(${row(a.id)})`);
  age(a.id, 16); await settle(a.id, ['CANCELED'], 'abandoned attempt cancelled');
  const intentA = await stripe(`payment_intents/${a.intentId}`);
  report('boundary: 16 minutes with no card is cancelled as abandoned, not failed', row(a.id).startsWith('CANCELED|PAYMENT_EXPIRED|') && intentA.status === 'canceled' && intentA.amount_received === 0 && orderCount(a.email) === 0 && await customerView(9, a.id) === 'ABANDONED' && !(await visible(tokenA, a.id)), `(${row(a.id)}; intent ${intentA.status}; classification ${await customerView(9, a.id)}; listed ${await visible(tokenA, a.id)})`);
  const before = row(a.id); age(a.id, 20); await sleep(15_000);
  report('idempotent: re-running expiry changes nothing', row(a.id) === before, `(${row(a.id)})`);

  // 2. Late card entry before the worker runs: authorised payment is never cancelled.
  const b = await submittedAttempt(10, 'AG-002'); age(b.id, 16, "now() + interval '1 hour'");
  await stripe(`payment_intents/${b.intentId}/confirm`, { payment_method: 'pm_card_visa', return_url: 'http://127.0.0.1:3120/' });
  sql(`UPDATE payment_work SET state = 'READY', "nextRunAt" = now() WHERE "attemptId" = '${b.id}'`);
  await settle(b.id, ['PAID'], 'late card entry paid');
  const intentB = await stripe(`payment_intents/${b.intentId}`);
  report('late card entry after the window still ends PAID, not cancelled', intentB.status === 'succeeded' && orderCount(b.email) === 1, `(${row(b.id)}; intent ${intentB.status})`);

  // 3. Concurrent card submission vs expiry: outcome must be consistent either way.
  const c = await submittedAttempt(11, 'AG-003'); age(c.id, 16, "now() + interval '1 hour'");
  await Promise.allSettled([stripe(`payment_intents/${c.intentId}/confirm`, { payment_method: 'pm_card_visa', return_url: 'http://127.0.0.1:3120/' }), Promise.resolve(sql(`UPDATE payment_work SET state = 'READY', "nextRunAt" = now() WHERE "attemptId" = '${c.id}'`))]);
  await settle(c.id, ['PAID', 'CANCELED'], 'race settled'); await sleep(5_000);
  const intentC = await stripe(`payment_intents/${c.intentId}`); const final = row(c.id).split('|')[0];
  const consistent = final === 'PAID' ? intentC.status === 'succeeded' && orderCount(c.email) === 1 : intentC.status === 'canceled' && intentC.amount_received === 0 && orderCount(c.email) === 0;
  report('race: concurrent confirm vs expiry is consistent (PAID+charged or CANCELED+uncharged)', consistent, `(${row(c.id)}; intent ${intentC.status}; orders ${orderCount(c.email)})`);

  // 4. Genuine decline stays DECLINED, never ABANDONED.
  const d = await submittedAttempt(12, 'AG-004');
  await stripe(`payment_intents/${d.intentId}/confirm`, { payment_method: 'pm_card_chargeDeclined', return_url: 'http://127.0.0.1:3120/' });
  await settle(d.id, ['DECLINED'], 'declined');
  report('genuine decline stays DECLINED', (await customerView(12, d.id)) === 'DECLINED', `(${row(d.id)}; ${await customerView(12, d.id)})`);

  // 5. Aged declined attempt is not reclassified as abandoned.
  age(d.id, 30); await sleep(15_000);
  report('declined attempt older than the window stays DECLINED', row(d.id).startsWith('DECLINED') && (await customerView(12, d.id)) === 'DECLINED', `(${row(d.id)})`);
}
if (scenario === 'signal') {
  // Browser closed between the confirmation-started signal and Stripe confirmation; duplicates; late provider outcome.
  const a = await submittedAttempt(18, 'AG-006'); const token = await login(18);
  const post = () => api(token, `/api/checkout/payment-attempts/${a.id}/confirmation-started`, { method: 'POST', body: '{}' });
  const results = await Promise.all([post(), post(), post(), post(), post()]);
  const stamps = new Set(results.map(r => r.body?.data?.confirmationStartedAt));
  report('duplicate/concurrent signals are idempotent (one timestamp, all 2xx)', results.every(r => r.status === 200) && stamps.size === 1, `(${[...stamps]})`);
  const view = async () => (await api(token, `/api/checkout/payment-attempts/${a.id}`)).body.data;
  let v = await view();
  const intent0 = await stripe(`payment_intents/${a.intentId}`);
  report('signal changes no financial state and creates nothing', stateOf(a.id) === 'AWAITING_INPUT' && v.classification === 'PROCESSING' && intent0.status === 'requires_payment_method' && orderCount(a.email) === 0 && sql(`SELECT count(*) FROM payment_attempts WHERE "userId" = (SELECT "userId" FROM payment_attempts WHERE id = '${a.id}')`) === '1', `(state ${stateOf(a.id)}; ${v.classification}; intent ${intent0.status})`);
  // Fresh signal + nothing at Stripe: recovery must NOT clear it early and must not cancel.
  sql(`UPDATE payment_work SET state = 'READY', "nextRunAt" = now() WHERE "attemptId" = '${a.id}'`); await sleep(20_000);
  report('a fresh signal is retained (no premature clearing)', sql(`SELECT "confirmationStartedAt" IS NOT NULL FROM payment_attempts WHERE id = '${a.id}'`) === 't' && stateOf(a.id) === 'AWAITING_INPUT', '');
  // Browser closed: Stripe never saw a confirmation. After the grace, recovery clears only the marker.
  sql(`UPDATE payment_attempts SET "confirmationStartedAt" = now() - interval '3 minutes' WHERE id = '${a.id}'; UPDATE payment_work SET state = 'READY', "nextRunAt" = now() WHERE "attemptId" = '${a.id}'`);
  await waitFor(() => sql(`SELECT "confirmationStartedAt" IS NULL FROM payment_attempts WHERE id = '${a.id}'`) === 't', 90_000, 'marker cleared');
  v = await view();
  report('stale signal with nothing at Stripe stays Processing (checking), never reopens card entry and invents no outcome', v.classification === 'PROCESSING' && v.retryAllowed === false && stateOf(a.id) === 'AWAITING_INPUT', `(${v.classification}; ${stateOf(a.id)})`);
  // Late provider outcome after the marker was cleared still reconciles normally.
  await stripe(`payment_intents/${a.intentId}/confirm`, { payment_method: 'pm_card_visa', return_url: 'http://127.0.0.1:3120/' });
  await waitFor(() => stateOf(a.id) === 'PAID', 180_000, 'late outcome PAID');
  const intent1 = await stripe(`payment_intents/${a.intentId}`);
  report('late provider outcome reconciles to PAID exactly once', intent1.status === 'succeeded' && orderCount(a.email) === 1, `(intent ${intent1.status}; orders ${orderCount(a.email)})`);
  const late = await post();
  report('a signal after payment is refused, not recorded', late.status === 409, `(${late.status})`);
}
if (scenario === 'decline-loop') {
  // Repeated authoritative declines on ONE reused PaymentIntent (Try Again reuses it), racing the recovery worker's lease on purpose.
  const reuse = process.env.LOOP_REUSE === '1'; const loopN = Number(process.env.LOOP_CUSTOMER ?? 17);
  const a = reuse ? { id: sql(`SELECT a.id FROM payment_attempts a JOIN users u ON u.id = a."userId" WHERE u.email = 'accept${loopN}@example.invalid' AND a.state = 'DECLINED' ORDER BY a."createdAt" DESC LIMIT 1`), intentId: '', email: `accept${loopN}@example.invalid` } : await submittedAttempt(loopN, 'AG-004'); if (reuse) a.intentId = sql(`SELECT "providerIntentId" FROM payment_attempts WHERE id = '${a.id}'`); const token = await login(Number(process.env.LOOP_CUSTOMER ?? 17));
  const rounds = Number(process.env.LOOP_ROUNDS ?? 8); const rows = [];
  for (let i = 0; i < rounds; i++) {
    if (i > 0 || reuse) { let r; for (let k = 0; k < 20; k++) { r = await api(token, `/api/checkout/payment-attempts/${a.id}/resume`, { method: 'POST', body: '{}' }); if (r.status < 300 || r.body?.error?.code !== 'PAYMENT_RECOVERY_PENDING') break; await sleep(500); } if (r.status >= 300) { report('resume ' + i, false, `(${r.status} ${JSON.stringify(r.body).slice(0, 120)})`); break; }
      await api(token, `/api/checkout/payment-attempts/${a.id}/submit`, { method: 'POST', body: '{}' }); }
    // Make the worker due right now so a lease/pre-decline read can overlap the browser-side decline.
    sql(`UPDATE payment_work SET state = 'READY', "nextRunAt" = now() - interval '1 second', "leaseToken" = NULL, "leaseUntil" = NULL WHERE "attemptId" = '${a.id}'`);
    await sleep(i % 2 ? 150 : 0);
    const t0 = Date.now();
    const confirm = await stripe(`payment_intents/${a.intentId}/confirm`, { payment_method: 'pm_card_chargeDeclined', return_url: 'http://127.0.0.1:3120/' });
    api(token, `/api/checkout/payment-attempts/${a.id}/reconcile`, { method: 'POST', body: '{}' }); // as the browser does
    const seen = []; let last = ''; let declinedAt = null;
    while (Date.now() - t0 < 60_000) { const s = stateOf(a.id); if (s !== last) { seen.push(`${s}@${Date.now() - t0}ms`); last = s; } if (s === 'DECLINED') { declinedAt = Date.now() - t0; break; } await sleep(250); }
    const view = (await api(token, `/api/checkout/payment-attempts/${a.id}`)).body?.data;
    rows.push({ round: i, stripe: confirm.error?.code ?? confirm.status, declinedAt, timeline: seen.join(' > '), classification: view?.classification });
    console.log(JSON.stringify(rows.at(-1)));
  }
  const ok = rows.length === rounds && rows.every(r => r.declinedAt !== null && r.classification === 'DECLINED');
  report('repeated declines on one PaymentIntent all reach DECLINED', ok, `(slowest ${Math.max(...rows.map(r => r.declinedAt ?? 99999))}ms; intents used 1; orders ${orderCount(a.email)})`);
}
