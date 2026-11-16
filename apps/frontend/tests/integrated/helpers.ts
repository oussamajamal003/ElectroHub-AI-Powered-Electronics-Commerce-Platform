import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

/** All isolated-stack secrets are read from files/env owned by this acceptance run; nothing is printed. */
const sp = process.env.ACCEPT_SP ?? '';
const read = (name: string) => readFileSync(`${sp}/${name}`, 'utf8').trim();
const psql = process.env.ACCEPT_PGBIN ?? `${sp}/pg17/pgsql/bin/psql.exe`;
export const customerEmail = (n: number) => `accept${n}@example.invalid`;
const stripeKey = () => {
  const text = readFileSync(process.env.ACCEPT_BACKEND_ENV ?? '', 'utf8').split(/\r?\n/).find(line => line.startsWith('STRIPE_SECRET_KEY=')) ?? '';
  const key = text.slice(text.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!key.startsWith('sk_test_')) throw new Error('Refusing: not a Stripe test-mode key.');
  return key;
};
export const ledger = (entry: Record<string, unknown>) => appendFileSync(`${sp}/stripe-ledger.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);

export function sql(query: string): string {
  return execFileSync(psql, ['-h', 'localhost', '-p', '55432', '-U', 'postgres', '-d', 'electrohub_ci', '-Atc', query], { encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: read('pgrun/pw.txt'), PGSSLMODE: 'verify-full', PGSSLROOTCERT: `${sp}/pgrun/tls/ca.pem` } }).trim();
}
export async function stripeIntent(id: string) {
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${id}`, { headers: { Authorization: `Bearer ${stripeKey()}` } });
  const body = await response.json() as { id: string; status: string; amount: number; amount_received: number; amount_capturable: number; livemode: boolean };
  expect(body.livemode).toBe(false);
  return body;
}
export const attemptRows = (email: string) => sql(`SELECT a.id || '|' || a.state || '|' || coalesce(a."failureCode",'') || '|' || coalesce(a."providerIntentId",'') || '|' || coalesce(a."orderId"::text,'') FROM payment_attempts a JOIN users u ON u.id = a."userId" WHERE u.email = '${email}' ORDER BY a."createdAt"`).split('\n').filter(Boolean)
  .map(line => { const [id, state, failureCode, intentId, orderId] = line.split('|'); return { id, state, failureCode, intentId, orderId }; });

export async function signIn(page: Page, n: number) {
  const response = await page.request.post('/api/auth/login', { data: { email: customerEmail(n), password: read('customer-pw.txt') } });
  expect(response.status()).toBe(200);
  const { accessToken } = await response.json() as { accessToken: string };
  return accessToken;
}
export function emptyCart(email: string) { sql(`DELETE FROM cart_items WHERE "cartId" IN (SELECT c.id FROM carts c JOIN users u ON u.id = c."userId" WHERE u.email = '${email}')`); }
export async function addToCart(page: Page, token: string, sku: string, quantity = 1) {
  const productId = sql(`SELECT id FROM products WHERE sku = '${sku}'`);
  const response = await page.request.post('/api/cart/items', { headers: { Authorization: `Bearer ${token}` }, data: { productId, quantity } });
  expect(response.status(), await response.text()).toBeLessThan(300);
  return productId;
}
export const cartRows = (email: string) => sql(`SELECT p.sku || ':' || ci.quantity FROM cart_items ci JOIN products p ON p.id = ci."productId" JOIN carts c ON c.id = ci."cartId" JOIN users u ON u.id = c."userId" WHERE u.email = '${email}' ORDER BY 1`).split('\n').filter(Boolean);

export const shipping = { recipient: 'Accept Customer', line1: '1 Test Street', line2: '', city: 'Testville', state: 'CA', postalCode: '94105', country: 'United States', phone: '+1 555 010 2000' };
export async function fillShipping(page: Page) {
  for (const [field, value] of Object.entries(shipping)) await page.locator(`#shipping-${field}`).fill(value);
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await page.getByRole('button', { name: 'Continue to Payment' }).click();
}
export async function fillCard(page: Page, number: string) {
  const frame = page.frameLocator('iframe[src*="elements-inner-accessory-target"]');
  await frame.getByLabel('Card number', { exact: true }).fill(number);
  await frame.getByLabel(/Expiration/).fill('1230'); await frame.getByLabel('Security code', { exact: true }).fill('123');
  const zip = frame.getByLabel(/ZIP|Postal/i); if (await zip.count()) await zip.first().fill('94105');
}
export async function toReview(page: Page, number: string) {
  await page.goto('/checkout'); await fillShipping(page);
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled({ timeout: 60_000 });
  await fillCard(page, number);
  await page.getByRole('button', { name: 'Review Order' }).click();
  await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();
}

/** Server-side Stripe Test Mode confirm with an official test PaymentMethod token (e.g. pm_card_visa, pm_card_chargeDeclined). */
export async function stripeConfirm(intentId: string, paymentMethod: string) {
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${intentId}/confirm`, { method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey()}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ payment_method: paymentMethod }) });
  const body = await response.json() as { status?: string; error?: { code?: string } };
  ledger({ op: 'confirm', intent: intentId, paymentMethod, http: response.status, status: body.status ?? body.error?.code });
  return { http: response.status, status: body.status, errorCode: body.error?.code };
}
/** Identify only this acceptance run's worker: the node CLIENT process (local ephemeral port to remote 55432, never the postgres server side) that is not the API (listener on 5100). */
function isolatedWorkerPids(): number[] {
  const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' }).split(/\r?\n/);
  const pids = (re: RegExp) => new Set(out.filter(line => re.test(line)).map(line => Number(line.trim().split(/\s+/).at(-1))));
  const db = pids(/127\.0\.0\.1:\d+\s+127\.0\.0\.1:55432\s+ESTABLISHED/); const api = pids(/:5100\s+\S+\s+LISTENING/);
  return [...db].filter(pid => !api.has(pid) && pid > 0);
}
export function stopWorker() { for (const pid of isolatedWorkerPids()) { try { execFileSync('taskkill', ['/PID', String(pid), '/F']); } catch { /* already gone */ } } }
export function startWorker() { spawn('bash', [`${sp}/run-proc.sh`, 'worker'], { detached: true, stdio: 'ignore' }).unref(); }
export const workerRunning = () => isolatedWorkerPids().length > 0;
export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs: number, label: string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 1_000)); }
  throw new Error(`Timed out waiting for ${label}`);
}
