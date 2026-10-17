import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Task 03.6 — REAL Stripe Test Mode "Cancel purchase" on the ISOLATED stack (frontend :3200 -> backend :5200 -> disposable PostgreSQL :55433).
 * Owner authorization 2026-10-17: exactly 1 Test Mode PaymentIntent, account acct_1UEZW5KiVgdl63pN. No card is ever confirmed.
 * Reproduces the incident shape: Place Order accepted (/submit), customer leaves before Stripe confirmation. Only the disposable row's
 * submittedAt is backdated past the 10-minute never-confirmed grace (no Stripe state is touched); the never-confirmed rule then runs against the
 * REAL intent, and the customer cancels through the UI. Hard gates: isolated URL; disposable DB identity; exactly one new intent on the account.
 */
const AUTHORIZED_ACCOUNT = 'acct_1UEZW5KiVgdl63pN';
const base = 'http://127.0.0.1:3200';
const env = process.env;
test.skip(env.ISOLATED_REAL_STRIPE !== 'authorized' || !env.ISOLATED_FIXTURE_CREDENTIALS || !env.ISOLATED_PSQL, 'Real isolated Stripe journey not authorized/configured.');
test.setTimeout(420_000);

function disposableSql(query: string): string {
  const out = execFileSync(env.ISOLATED_PSQL!, ['-h', 'localhost', '-p', '55433', '-U', 'postgres', '-d', 'electrohub_disposable', '-At', '-c',
    `select current_database() || '|' || inet_server_port(); ${query}`], { encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: readFileSync(env.ISOLATED_PG_PASSWORD_FILE!, 'utf8').trim(), PGSSLMODE: 'verify-full', PGSSLROOTCERT: env.ISOLATED_PG_CA! } });
  const [identity, ...rows] = out.trim().split(/\r?\n/);
  if (identity !== 'electrohub_disposable|55433') throw new Error(`Refusing: not the disposable database (${identity}).`);
  return rows.join('\n');
}
const realIntents = () => disposableSql(`select coalesce(string_agg("providerIntentId" || ':' || "stripeAccountId" || ':' || id, ','), '') from payment_attempts
  where "providerIntentId" like 'pi\\_%' and "providerIntentId" not like 'pi\\_disposable%'`).split(',').filter(Boolean);
const row = (attemptId: string) => disposableSql(`select state || '|' || coalesce("failureCode", '-') || '|' || coalesce("providerStatus", '-') || '|' ||
  coalesce("orderId"::text, '-') || '|' || ("restoredAt" is not null) from payment_attempts where id = '${attemptId}'`);

test('one Test Mode intent: accepted, never confirmed, verified by recovery, cancelled by the customer, items returned to Cart', async ({ page }) => {
  const credentials = Object.fromEntries(readFileSync(env.ISOLATED_FIXTURE_CREDENTIALS!, 'utf8').trim().split('\n').map(line => line.split('=')));
  const before = realIntents();
  await page.setViewportSize({ width: 1366, height: 900 });
  const login = await page.request.post(`${base}/api/auth/login`, { data: { email: credentials.customer, password: credentials.customer_password } });
  expect(login.status()).toBe(200);
  const token: string = (await login.json()).accessToken;
  const auth = { Authorization: `Bearer ${token}` };
  const products = (await (await page.request.get(`${base}/api/products`)).json()).data;
  const product = (products.items ?? products.products ?? products)[2];
  expect((await page.request.post(`${base}/api/cart/items`, { headers: auth, data: { productId: product.id, quantity: 1 } })).status()).toBeLessThan(300);

  // Checkout -> Payment: setup creates the ONE authorized intent.
  await page.goto(`${base}/checkout`);
  for (const [field, value] of Object.entries({ recipient: 'Isolated Tester', line1: '1 Test Street', line2: '', city: 'Testville', state: 'CA',
    postalCode: '94105', country: 'United States', phone: '+1 555 010 2000' })) await page.locator(`#shipping-${field}`).fill(value);
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await expect(page.frameLocator('iframe[src*="elements-inner-accessory-target"]').getByLabel('Card number', { exact: true })).toBeVisible({ timeout: 90_000 });
  const fresh = realIntents().filter(entry => !before.includes(entry));
  expect(fresh.length, `intent budget: ${fresh.join(',')}`).toBe(1);
  const [intentId, account, attemptId] = fresh[0].split(':');
  expect(account).toBe(AUTHORIZED_ACCOUNT);
  console.log(`[isolated-stripe] intent ${intentId} on ${account} for attempt ${attemptId} (1/1)`);

  // Place Order accepted by the server, then the customer leaves before Stripe confirmation (the incident shape). No card is entered/confirmed.
  expect((await page.request.post(`${base}/api/checkout/payment-attempts/${attemptId}/submit`, { headers: auth, data: {} })).status()).toBe(200);
  await page.goto(`${base}/cart`);
  const card = page.locator(`[data-purchase="${attemptId}"]`);
  await expect(card.getByText('Processing', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(card.getByRole('button', { name: /^Cancel purchase: / })).toHaveCount(0); // not yet verified: no cancel offered

  // Fast-forward ONLY the disposable submission time past the 10-minute grace and make its recovery due (no Stripe state is changed).
  disposableSql(`update payment_attempts set "submittedAt" = now() - interval '11 minutes' where id = '${attemptId}';
    update payment_work set state = 'READY', "nextRunAt" = now(), "leaseToken" = null, "leaseUntil" = null where "attemptId" = '${attemptId}' and state <> 'LEASED';`);
  await expect.poll(() => row(attemptId), { timeout: 120_000, intervals: [2_000] }).toMatch(/^AWAITING_INPUT\|PAYMENT_NOT_CONFIRMED\|requires_payment_method\|-\|false$/);

  // The customer now sees Processing + the server-verified Cancel purchase.
  await page.reload();
  await expect(card.getByText('Processing', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(/Card payment didn’t start for this purchase, and nothing was charged/)).toBeVisible();
  await page.screenshot({ path: 'test-results/isolated/real-cancel-1-processing-cancelable.png', fullPage: true });
  await card.getByRole('button', { name: /^Cancel purchase: / }).click();
  await expect(page.getByRole('heading', { name: 'Cancel this purchase?' })).toBeVisible();
  await expect(page.getByLabel(/Return its items to my Cart/)).toBeChecked();
  await page.getByRole('button', { name: 'Cancel purchase', exact: true }).click();
  await expect(card).toHaveCount(0, { timeout: 120_000 });

  // Authoritative end state: Stripe intent cancelled (read back by the worker), nothing charged, no order, items explicitly restored once.
  await expect.poll(() => row(attemptId), { timeout: 60_000 }).toMatch(/^CANCELED\|PAYMENT_CANCELED_BY_CUSTOMER\|canceled\|-\|true$/);
  const cartLine = disposableSql(`select ci.quantity from cart_items ci join carts c on c.id = ci."cartId" join users u on u.id = c."userId"
    where u.email = '${credentials.customer}' and ci."productId" = '${product.id}'`);
  expect(cartLine).toBe('1');
  expect(realIntents().filter(entry => !before.includes(entry))).toHaveLength(1);
  for (const removed of ['Incomplete purchases', 'Not completed', 'Restore items']) await expect(page.getByText(removed)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/isolated/real-cancel-2-after-cancel.png', fullPage: true });
});
