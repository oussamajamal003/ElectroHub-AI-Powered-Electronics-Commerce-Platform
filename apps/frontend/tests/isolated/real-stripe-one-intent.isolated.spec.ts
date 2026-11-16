import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Task 03.6 — REAL Stripe Test Mode journey on the ISOLATED stack (frontend :3200 -> backend :5200 -> disposable PostgreSQL :55433).
 * Owner authorization 2026-10-17: up to 3 Test Mode PaymentIntents, account acct_1UEZW5KiVgdl63pN. This journey uses ONE intent:
 * Payment Element -> decline (Stripe test card) -> Payment failed -> Try Again (same intent, empty form) -> success test card -> Paid Order.
 * Hard gates (fail closed before any card is confirmed): isolated URL only; disposable database identity; exactly one real intent, bound to
 * the authorized account. Opt-in only: requires ISOLATED_REAL_STRIPE=authorized plus the isolated fixture/database variables.
 */
const AUTHORIZED_ACCOUNT = 'acct_1UEZW5KiVgdl63pN';
const INTENT_BUDGET = 3;
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
const realIntents = () => disposableSql(`select coalesce(string_agg("providerIntentId" || ':' || "stripeAccountId", ','), '') from payment_attempts
  where "providerIntentId" like 'pi\\_%' and "providerIntentId" not like 'pi\\_disposable%'`).split(',').filter(Boolean);
const attemptRow = (intent: string) => disposableSql(`select state || '|' || coalesce("failureCode", '-') || '|' || coalesce("orderId"::text, '-') ||
  '|' || (select count(*) from orders o where o.id = a."orderId") from payment_attempts a where "providerIntentId" = '${intent}'`);

async function fillCard(page: Page, number: string) {
  const frame = page.frameLocator('iframe[src*="elements-inner-accessory-target"]');
  const card = frame.getByLabel('Card number', { exact: true });
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(card).toHaveValue(''); // always a fresh, empty secure form
  await card.fill(number);
  await frame.getByLabel(/Expiration/).fill('1230'); await frame.getByLabel('Security code', { exact: true }).fill('123');
  const zip = frame.getByLabel(/ZIP|Postal/i); if (await zip.count()) await zip.first().fill('94105');
}
async function placeOrder(page: Page) {
  await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Review Order' }).click();
  await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Place Order/ }).click();
}

test('one Test Mode intent: Payment Element, decline -> Payment failed, Try Again on the same intent, success -> Paid Order', async ({ page }) => {
  const credentials = Object.fromEntries(readFileSync(env.ISOLATED_FIXTURE_CREDENTIALS!, 'utf8').trim().split('\n').map(line => line.split('=')));
  const before = realIntents();
  expect(before.length, 'no real intent may pre-exist in the disposable database').toBe(0);
  await page.setViewportSize({ width: 1366, height: 900 });
  expect((await page.request.post(`${base}/api/auth/login`, { data: { email: credentials.customer, password: credentials.customer_password } })).status()).toBe(200);

  // 1. Checkout to Payment: setup creates the ONE authorized intent and mounts the Payment Element.
  await page.goto(`${base}/checkout`);
  for (const [field, value] of Object.entries({ recipient: 'Isolated Tester', line1: '1 Test Street', line2: '', city: 'Testville', state: 'CA',
    postalCode: '94105', country: 'United States', phone: '+1 555 010 2000' })) await page.locator(`#shipping-${field}`).fill(value);
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await page.getByRole('button', { name: 'Continue to Payment' }).click();
  const frame = page.frameLocator('iframe[src*="elements-inner-accessory-target"]');
  await expect(frame.getByLabel('Card number', { exact: true })).toBeVisible({ timeout: 90_000 });

  // HARD GATE before any confirmation: exactly one real intent, bound to the authorized Test Mode account.
  const intents = realIntents();
  expect(intents.length, `intent budget: ${intents.join(',')}`).toBe(1);
  const [intentId, account] = intents[0].split(':');
  expect(account).toBe(AUTHORIZED_ACCOUNT);
  console.log(`[isolated-stripe] intent ${intentId} on ${account} (1/${INTENT_BUDGET})`);
  await page.screenshot({ path: 'test-results/isolated/real-1-payment-element.png', fullPage: true });

  // 2. Decline (Stripe's published generic-decline test card) -> Payment failed with Try Again.
  await fillCard(page, '4000000000000002');
  await placeOrder(page);
  await expect(page.getByRole('heading', { name: 'Payment Failed' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/was declined/)).toBeVisible();
  expect(attemptRow(intentId)).toMatch(/^DECLINED\|PAYMENT_DECLINED\|-\|0$/);
  await page.screenshot({ path: 'test-results/isolated/real-2-payment-failed.png', fullPage: true });

  // 3. Try Again: same intent, fresh empty card entry; still exactly one intent.
  await page.getByRole('button', { name: 'Try Again' }).click();
  await fillCard(page, '4242424242424242');
  expect(realIntents().length).toBe(1);

  // 4. Success (Stripe's published success test card) -> Paid -> Order Confirmed.
  await placeOrder(page);
  await page.waitForURL(/\/checkout\/confirmation\//, { timeout: 240_000 });
  await page.screenshot({ path: 'test-results/isolated/real-3-order-confirmed.png', fullPage: true });
  await expect.poll(() => attemptRow(intentId), { timeout: 120_000 }).toMatch(/^PAID\|-\|[0-9a-f-]{36}\|1$/);
  expect(realIntents()).toEqual([`${intentId}:${AUTHORIZED_ACCOUNT}`]);

  // 5. Cart: the purchase left Pending purchases and Failed payments; nothing incomplete anywhere.
  await page.goto(`${base}/cart`);
  await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();
  for (const removed of ['Incomplete purchases', 'Not completed', 'Restore items']) await expect(page.getByText(removed)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/isolated/real-4-cart-after-paid.png', fullPage: true });
});
