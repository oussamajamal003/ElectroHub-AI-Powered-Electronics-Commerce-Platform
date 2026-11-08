import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const credentials = JSON.parse(readFileSync('../../.cache/task05-2-browser-credentials-5217.json', 'utf8')) as {
  ownerEmail: string; customerEmail: string; password: string;
  disposableDb: { psql: string; port: number; database: string };
};
function totp(secret: string) {
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (const char of secret.replace(/\s/g, '').toUpperCase()) {
    value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest(); const offset = hmac[19] & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

test('saved admin quotes and customer checkout independently offer free STANDARD', async ({ page, browser }) => {
  // Only the fresh loopback stack's synthetic catalog is adjusted; shipping changes use the real admin form.
  const db = credentials.disposableDb;
  expect(db.database).toMatch(/^electrohub_disposable_browser_/);
  const productId = execFileSync(db.psql, ['-h', '127.0.0.1', '-p', String(db.port), '-U', 'postgres', '-d', db.database,
    '-tAq', '-c', `UPDATE products SET price=60.00 WHERE slug='aurora-noise-cancelling-headphones' RETURNING id`], { encoding: 'utf8', windowsHide: true }).trim();
  expect(productId).toMatch(/^[0-9a-f-]{36}$/);
  await page.goto('/admin/login');
  await page.getByLabel('Email Address').fill(credentials.ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  const secret = await page.locator('code[aria-labelledby="totp-secret-label"]').innerText();
  await page.getByLabel('Code from your app').fill(totp(secret));
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(page.getByRole('list', { name: 'Recovery codes' })).toBeVisible();
  await page.getByLabel('I have saved these codes somewhere safe.').check();
  await page.getByRole('button', { name: 'I have saved my codes, continue' }).click();
  await page.goto('/admin/settings?tab=shipping');
  await page.getByLabel('Cart subtotal ($)').fill('60.00');
  await page.getByRole('button', { name: 'Check quotes', exact: true }).click();
  const quotes = page.getByRole('list', { name: 'Quotes for $60.00' });
  await expect(quotes).toContainText('Standard Delivery');
  await page.getByLabel('Enable free shipping for orders above threshold').check();
  await page.getByLabel('Free Shipping Threshold ($)').fill('50.00');
  await page.getByLabel('Standard Shipping Rate ($)').fill('5.00');
  await page.getByLabel('Enable regular Standard Delivery for orders below the free-shipping threshold.').uncheck();
  await expect(page.getByText('Unsaved changes do not affect quotes until you save shipping settings.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Save Shipping', exact: true }).click();
  const stepUp = page.getByRole('dialog', { name: "Confirm it's you" });
  if (await stepUp.isVisible()) {
    await stepUp.getByLabel('6-digit code').fill(totp(secret));
    await stepUp.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(page.getByText('Shipping settings saved', { exact: true })).toBeVisible();
  await expect(quotes.getByRole('listitem').filter({ hasText: 'Standard Delivery' })).toContainText('Free');
  for (const subtotal of ['49.99', '50.00', '50.01', '60.00']) {
    await page.getByLabel('Cart subtotal ($)').fill(subtotal);
    await page.getByRole('button', { name: 'Check quotes', exact: true }).click();
    const list = page.getByRole('list', { name: `Quotes for $${subtotal}` });
    const standard = list.getByRole('listitem').filter({ hasText: 'Standard Delivery' });
    if (subtotal === '49.99') await expect(standard).toHaveCount(0);
    else await expect(standard).toContainText('Free');
  }
  // Unsaved disabling must keep the saved free quote until Save Shipping.
  await page.getByLabel('Enable free shipping for orders above threshold').uncheck();
  await expect(page.getByLabel('Enable standard delivery option')).toBeVisible();
  await expect(quotes.getByRole('listitem').filter({ hasText: 'Standard Delivery' })).toContainText('Free');
  await page.getByLabel('Enable free shipping for orders above threshold').check();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/shipping-threshold/admin-${width}.png`, fullPage: true });
  }

  const customer = await browser.newContext();
  try {
    const login = await customer.request.post('http://localhost:3217/api/auth/login', {
      data: { email: credentials.customerEmail, password: credentials.password },
    });
    expect(login.status()).toBe(200);
    const { accessToken } = await login.json() as { accessToken: string };
    const headers = { Authorization: `Bearer ${accessToken}` };
    const added = await customer.request.post('http://localhost:3217/api/cart/items', { headers, data: { productId, quantity: 1 } });
    expect(added.ok()).toBe(true);
    for (const suffix of ['', `?scope=BUY_NOW&productId=${productId}&quantity=1`]) {
      const response = await customer.request.get(`http://localhost:3217/api/checkout${suffix}`, { headers });
      expect(response.status()).toBe(200);
      const { data } = await response.json();
      expect(data.deliveryMethods.find((row: { id: string }) => row.id === 'STANDARD')).toMatchObject({ price: '0.00',
        totals: { subtotal: '60.00', shipping: '0.00', total: '60.00' } });
    }
    const shopper = await customer.newPage();
    await shopper.goto('http://localhost:3217/checkout');
    for (const [field, value] of Object.entries({ recipient: 'QA Shopper', line1: '1 Test Avenue', city: 'Test City', postalCode: '12345', phone: '+1 555 010 2000' })) {
      await shopper.locator(`#shipping-${field}`).fill(value);
    }
    const country = shopper.locator('#shipping-country');
    if (await country.evaluate(node => node.tagName === 'SELECT')) await country.selectOption({ label: 'United States' });
    else await country.fill('United States');
    await shopper.getByRole('button', { name: 'Continue to Delivery' }).click();
    await expect(shopper.getByRole('radio', { name: /Standard Delivery/ })).toBeVisible();
    await expect(shopper.getByRole('radio', { name: /Standard Delivery/ })).toHaveAccessibleName(/Free/i);
    await shopper.screenshot({ path: 'test-results/shipping-threshold/customer-free-standard.png', fullPage: true });
  } finally { await customer.close(); }
});
