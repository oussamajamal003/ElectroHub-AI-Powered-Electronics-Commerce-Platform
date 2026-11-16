import { expect, test } from '@playwright/test';
import Stripe from 'stripe';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { harness, fillShipping, capture } from './stripe.harness';

// Real Stripe-hosted entry/validation, intercepted app auth/quote/setup ONLY. Not a purchase gate.
test.skip(process.env.STRIPE_ENTRY_PROBE !== 'true', 'Explicit Stripe Test Mode rendering probe');
test('production secure component prepares Review without authorization', async ({ page }) => {
  const variables = { ...dotenv.parse(readFileSync('../backend/.env')), ...dotenv.parse(readFileSync('../backend/.env.local')) };
  if (!variables.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Stripe Test Mode required');
  const stripe = new Stripe(variables.STRIPE_SECRET_KEY, { apiVersion: '2026-09-30.endive' });
  const intent = await stripe.paymentIntents.create({ amount: 220997, currency: 'usd', capture_method: 'manual', allowed_payment_method_types: ['card'], metadata: { renderingProbe: randomUUID() } });
  try {
    if (!intent.client_secret) throw new Error('Missing owner-only setup secret');
    await harness(page, { realClientSecret: intent.client_secret, state: 'DECLINED' });
    page.on('console', value => { if (value.text().startsWith('PAYMENT_DIAGNOSTIC')) console.log(value.text()); });
    await page.goto('/checkout'); await fillShipping(page); await page.getByRole('button', { name: 'Continue to Payment' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Review Order' && !button.disabled));
    const frame = page.frameLocator('iframe[src*="elements-inner-accessory-target"]');
    console.log('Rendering probe: capturing hosted entry before any card test values are entered.');
    for (const width of [390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 }); await frame.getByLabel('Card number', { exact: true }).waitFor();
      const hostedFieldWidth = await frame.getByLabel('Card number', { exact: true }).evaluate(element => element.getBoundingClientRect().width);
      expect(hostedFieldWidth).toBeGreaterThan(width * 0.45);
      await capture(page, `screenshots/stripe-entry-real/payment-${width}.png`);
    }
    await frame.getByLabel('Card number', { exact: true }).fill('4000000000000002');
    await frame.getByLabel(/Expiration/).fill('1230'); await frame.getByLabel('Security code', { exact: true }).fill('123');
    await page.getByRole('button', { name: 'Review Order' }).click();
    console.log('Rendering probe: Review control clicked with declining card.');
    await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible();

    // Place Order -> will decline in real Stripe
    await page.getByRole('button', { name: /Place Order/ }).click();
    console.log('Rendering probe: Place Order clicked with declining card.');
    await expect(page.getByRole('heading', { name: 'Payment Failed' })).toBeVisible({ timeout: 20000 });

    // Click Review and try again
    await page.getByRole('button', { name: 'Try Again' }).click();
    console.log('Rendering probe: Try Again clicked.');
    await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible();

    // Re-fill with valid card
    const frame2 = page.frameLocator('iframe[src*="elements-inner-accessory-target"]');
    await frame2.getByLabel('Card number', { exact: true }).waitFor();
    await frame2.getByLabel('Card number', { exact: true }).fill('4242424242424242');
    await frame2.getByLabel(/Expiration/).fill('1230');
    await frame2.getByLabel('Security code', { exact: true }).fill('123');

    // Click Review Order
    console.log('Rendering probe: Clicking Review Order after second card...');
    const reviewBtn = page.getByRole('button', { name: 'Review Order' });
    await expect(reviewBtn).toBeEnabled();
    await reviewBtn.click();

    // Verify Review Your Order appears
    await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible({ timeout: 10000 });
    console.log('Rendering probe: Successfully advanced to Review Your Order with second card!');
  } finally { await stripe.paymentIntents.cancel(intent.id); }
});
