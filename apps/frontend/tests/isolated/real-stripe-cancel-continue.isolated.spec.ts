import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Task 03.6 — continuation of the authorized single-intent Cancel purchase acceptance for an EXISTING verified never-confirmed purchase
 * (ISOLATED_CANCEL_ATTEMPT). No checkout step: this spec can never create a PaymentIntent (asserted). Isolated stack + disposable DB only.
 */
const base = 'http://127.0.0.1:3200';
const env = process.env;
test.skip(env.ISOLATED_REAL_STRIPE !== 'authorized' || !env.ISOLATED_CANCEL_ATTEMPT || !env.ISOLATED_PSQL, 'Continuation not configured.');
test.setTimeout(240_000);

function disposableSql(query: string): string {
  const out = execFileSync(env.ISOLATED_PSQL!, ['-h', 'localhost', '-p', '55433', '-U', 'postgres', '-d', 'electrohub_disposable', '-At', '-c',
    `select current_database() || '|' || inet_server_port(); ${query}`], { encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: readFileSync(env.ISOLATED_PG_PASSWORD_FILE!, 'utf8').trim(), PGSSLMODE: 'verify-full', PGSSLROOTCERT: env.ISOLATED_PG_CA! } });
  const [identity, ...rows] = out.trim().split(/\r?\n/);
  if (identity !== 'electrohub_disposable|55433') throw new Error(`Refusing: not the disposable database (${identity}).`);
  return rows.join('\n');
}
const realIntentCount = () => Number(disposableSql(`select count(*) from payment_attempts where "providerIntentId" like 'pi\\_%' and "providerIntentId" not like 'pi\\_disposable%'`));

test('verified never-confirmed purchase: Processing + Cancel purchase -> Stripe intent cancelled, items returned to Cart, nothing charged', async ({ page }) => {
  const attemptId = env.ISOLATED_CANCEL_ATTEMPT!;
  const row = () => disposableSql(`select state || '|' || coalesce("failureCode", '-') || '|' || coalesce("providerStatus", '-') || '|' ||
    coalesce("orderId"::text, '-') || '|' || ("restoredAt" is not null) from payment_attempts where id = '${attemptId}'`);
  expect(row()).toMatch(/^AWAITING_INPUT\|PAYMENT_NOT_CONFIRMED\|/);
  const intentsBefore = realIntentCount();
  const productId = disposableSql(`select "productId" from payment_attempt_items where "attemptId" = '${attemptId}'`);
  const credentials = Object.fromEntries(readFileSync(env.ISOLATED_FIXTURE_CREDENTIALS!, 'utf8').trim().split('\n').map(line => line.split('=')));
  const cartQuantity = () => disposableSql(`select coalesce(sum(ci.quantity), 0) from cart_items ci join carts c on c.id = ci."cartId" join users u on u.id = c."userId"
    where u.email = '${credentials.customer}' and ci."productId" = '${productId}'`);
  const quantityBefore = Number(cartQuantity());

  await page.setViewportSize({ width: 1366, height: 900 });
  expect((await page.request.post(`${base}/api/auth/login`, { data: { email: credentials.customer, password: credentials.customer_password } })).status()).toBe(200);
  await page.goto(`${base}/cart`);
  const card = page.locator(`[data-purchase="${attemptId}"]`);
  await expect(card.getByText('Processing', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(/Card payment didn’t start for this purchase, and nothing was charged/)).toBeVisible();
  await expect(card.getByRole('link', { name: 'Check payment status' })).toBeVisible();
  await page.screenshot({ path: 'test-results/isolated/real-cancel-1-processing-cancelable.png', fullPage: true });
  await card.getByRole('button', { name: /^Cancel purchase: / }).click();
  await expect(page.getByRole('heading', { name: 'Cancel this purchase?' })).toBeVisible();
  await expect(page.getByLabel(/Return its items to my Cart/)).toBeChecked();
  await page.getByRole('button', { name: 'Cancel purchase', exact: true }).click();
  await expect(card).toHaveCount(0, { timeout: 120_000 });

  // Authoritative end state: intent cancelled at Stripe (read back by the worker), nothing charged, no order, items returned exactly once.
  await expect.poll(row, { timeout: 60_000 }).toMatch(/^CANCELED\|PAYMENT_CANCELED_BY_CUSTOMER\|canceled\|-\|true$/);
  expect(Number(cartQuantity())).toBe(quantityBefore + 1);
  expect(realIntentCount()).toBe(intentsBefore);
  for (const removed of ['Incomplete purchases', 'Not completed', 'Restore items']) await expect(page.getByText(removed)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/isolated/real-cancel-2-after-cancel.png', fullPage: true });
});
