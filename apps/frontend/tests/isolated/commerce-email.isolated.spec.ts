import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Task 03.8 — normal-runtime email delivery on the ISOLATED stack (frontend :3200 -> backend :5200 -> disposable PostgreSQL), through the REAL
 * UI and REAL Stripe Test Mode (no charges, no mocks, no special delivery step). The stack is started the normal way, which includes the
 * supervised email worker in CAPTURE mode:   PORT=5200 npm run dev:isolated   (apps/backend)   and   E2E_FRONTEND_PORT=3200
 * E2E_API_PROXY_TARGET=http://localhost:5200 npx vite   (apps/frontend). Nothing in this spec sends, claims or triggers an email.
 *
 * Proves: a declined payment sends nothing; a successful purchase automatically yields exactly two emails (Order confirmed, Payment confirmed)
 * addressed to the signed-in customer; refreshing the Confirmation sends nothing more; a second purchase automatically yields two more, each
 * carrying only its own order reference. Capture files are LOCAL evidence, not proof of mailbox delivery.
 * Opt-in: ISOLATED_REAL_STRIPE=authorized, ISOLATED_FIXTURE_CREDENTIALS, ISOLATED_EMAIL_CAPTURE_DIR (apps/backend/.isolated/email-capture).
 */
const base = 'http://127.0.0.1:3200';
const env = process.env;
test.skip(env.ISOLATED_REAL_STRIPE !== 'authorized' || !env.ISOLATED_FIXTURE_CREDENTIALS || !env.ISOLATED_EMAIL_CAPTURE_DIR, 'Isolated email journey not authorized/configured.');
test.setTimeout(600_000);

interface Captured { messageId: string; to: string; subject: string; html: string; text: string }
function captured(): Captured[] {
  const dir = env.ISOLATED_EMAIL_CAPTURE_DIR!;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as Captured);
}
const forReference = (reference: string) => captured().filter(message => message.subject.includes(reference));

async function fillCard(page: Page, number: string) {
  const frame = page.frameLocator('iframe[src*="elements-inner-accessory-target"]');
  const card = frame.getByLabel('Card number', { exact: true });
  await expect(card).toBeVisible({ timeout: 90_000 });
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
/** One product in an otherwise empty cart, via the customer's own authenticated API session. */
async function stockCart(page: Page, token: string) {
  const headers = { authorization: `Bearer ${token}` };
  const cart = await (await page.request.get(`${base}/api/cart`, { headers })).json() as { data: { items: { productId: string }[] } };
  for (const item of cart.data.items) await page.request.delete(`${base}/api/cart/items/${item.productId}`, { headers });
  const products = await (await page.request.get(`${base}/api/products`, { headers })).json() as { data: { id: string }[] };
  for (const product of products.data) {
    const added = await page.request.post(`${base}/api/cart/items`, { headers, data: { productId: product.id, quantity: 1 } });
    if (added.status() === 201) return;
  }
  throw new Error('No purchasable product could be added to the cart.');
}
async function toPayment(page: Page) {
  await page.goto(`${base}/checkout`);
  for (const [field, value] of Object.entries({ recipient: 'Isolated Tester', line1: '1 Test Street', line2: '', city: 'Testville', state: 'CA',
    postalCode: '94105', country: 'United States', phone: '+1 555 010 2000' })) await page.locator(`#shipping-${field}`).fill(value);
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await page.getByRole('button', { name: 'Continue to Payment' }).click();
}
const referenceOf = async (page: Page) => (await page.locator('h2', { hasText: /^ORD-/ }).first().textContent())!.trim();

test('normal runtime: decline sends nothing; each successful purchase automatically sends exactly its two emails to the signed-in customer', async ({ page }) => {
  const credentials = Object.fromEntries(readFileSync(env.ISOLATED_FIXTURE_CREDENTIALS!, 'utf8').trim().split('\n').map(line => line.split('='))) as Record<string, string>;
  const customer = (env.ISOLATED_EXPECT_RECIPIENT ?? credentials.customer).toLowerCase();
  await page.setViewportSize({ width: 1366, height: 900 });
  const login = await page.request.post(`${base}/api/auth/login`, { data: { email: credentials.customer, password: credentials.customer_password } });
  expect(login.status()).toBe(200);
  const token = (await login.json() as { accessToken: string }).accessToken;
  const baseline = captured().length;

  // Purchase 1: declined first (no email), then Try Again with a success card.
  await stockCart(page, token); await toPayment(page);
  await fillCard(page, '4000000000000002'); await placeOrder(page);
  await expect(page.getByRole('heading', { name: 'Payment Failed' })).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(8_000); // longer than the worker poll interval: a decline must not produce anything
  expect(captured().length, 'a declined payment must not send any email').toBe(baseline);
  await page.getByRole('button', { name: 'Try Again' }).click();
  await fillCard(page, '4242424242424242'); await placeOrder(page);
  await page.waitForURL(/\/checkout\/confirmation\//, { timeout: 240_000 });
  const first = await referenceOf(page);
  await expect.poll(() => forReference(first).length, { timeout: 90_000, intervals: [1_000] }).toBe(2);
  const firstMails = forReference(first);
  expect(firstMails.map(message => message.subject).sort()).toEqual([`Order confirmed — ${first}`, `Payment confirmed — ${first}`]);
  expect(firstMails.every(message => message.to === customer)).toBe(true);
  expect(new Set(firstMails.map(message => message.messageId)).size).toBe(2);
  await expect.poll(async () => { await page.reload(); return page.locator('[data-email-state]').getAttribute('data-email-state'); }, { timeout: 60_000, intervals: [2_000] }).toBe('sent');
  await expect(page.getByText(/confirmations have been sent/)).toBeVisible();
  await page.screenshot({ path: 'test-results/isolated/email-1-confirmation-sent.png', fullPage: true });

  // Refreshing and revisiting never sends again.
  const afterFirst = captured().length;
  await page.reload(); await page.getByRole('link', { name: 'View Order Details' }).click();
  await expect(page.locator('[data-email-state]')).toBeVisible();
  await page.waitForTimeout(8_000);
  expect(captured().length, 'refresh / revisit must not resend').toBe(afterFirst);

  // Purchase 2: automatic again, no manual step, no cross-over.
  await stockCart(page, token); await toPayment(page);
  await fillCard(page, '4242424242424242'); await placeOrder(page);
  await page.waitForURL(/\/checkout\/confirmation\//, { timeout: 240_000 });
  const second = await referenceOf(page);
  expect(second).not.toBe(first);
  await expect.poll(() => forReference(second).length, { timeout: 90_000, intervals: [1_000] }).toBe(2);
  const secondMails = forReference(second);
  expect(secondMails.every(message => message.to === customer && !message.html.includes(first) && !message.text.includes(first))).toBe(true);
  expect(forReference(first)).toHaveLength(2); // the first purchase's emails were not duplicated
  expect(captured().length).toBe(baseline + 4);
});
