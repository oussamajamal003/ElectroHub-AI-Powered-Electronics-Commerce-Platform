import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { harness, fillShipping } from './stripe.harness';

// Opt-in real hosted rendering, intercepted application APIs. Never authorize/capture.
// Secrets stay in memory: no traces, screenshots of entered cards, or response bodies.
const require = createRequire(import.meta.url);
const dotenv = require('dotenv') as { parse(input: Buffer): Record<string, string> };
const Stripe = require('stripe') as typeof import('stripe').default;
const env = { ...dotenv.parse(readFileSync('../backend/.env')),
  ...(existsSync('../backend/.env.local') ? dotenv.parse(readFileSync('../backend/.env.local')) : {}), ...process.env };
const enabled = process.env.ELECTROHUB_REAL_STRIPE_RENDER === '1';
test.skip(!enabled, 'Opt-in real Stripe Test Mode hosted rendering; no financial acceptance');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

for (const mode of ['normal', 'throttled', 'delayed-api'] as const) {
  test(`REAL Stripe hosted inputs / intercepted Checkout APIs: ${mode}`, async ({ page }) => {
    test.setTimeout(120_000);
    if (!env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Test Mode key required');
    const sdk = new Stripe(env.STRIPE_SECRET_KEY);
    const intent = await sdk.paymentIntents.create({ amount: 100, currency: 'usd', capture_method: 'manual',
      metadata: { diagnostic: 'electrohub-input-readiness-only' } });
    try {
      if (!intent.client_secret) throw new Error('Diagnostic intent missing client secret');
      const app = await harness(page, { realClientSecret: intent.client_secret });
      if (mode === 'delayed-api') {
        await page.route('**/api/checkout/payment-attempts', async route => {
          // Controlled API latency, no provider interception.
          await new Promise(resolve => setTimeout(resolve, 3000));
          await route.fallback();
        });
      }
      if (mode === 'throttled') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150,
          downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 });
      }
      await page.goto('/checkout');
      await fillShipping(page);
      await page.getByRole('button', { name: 'Continue to Payment' }).click();
      const ready = () => page.getByRole('button', { name: 'Review Order' });
      await expect(ready()).toBeEnabled({ timeout: 30_000 });
      const card = page.frameLocator('iframe[src*="elements-inner-accessory-target"]').getByLabel('Card number', { exact: true });
      await expect(card).toBeVisible();
      await card.focus();
      await expect(card).toBeFocused();
      await page.evaluate(() => performance.mark('electrohub.payment.inputs-interactive'));
      const report = await page.evaluate(() => {
        const last = (name: string) => performance.getEntriesByName(`electrohub.payment.${name}`).at(-1)?.startTime ?? null;
        const names = ['payment-step-entered', 'payment-setup-start', 'payment-setup-response', 'client-secret-received',
          'stripe-client-init-start', 'stripe-client-init-ready', 'elements-mounted', 'elements-context-ready',
          'payment-element-loader-start', 'payment-element-ready', 'inputs-interactive'];
        const marks = Object.fromEntries(names.map(name => [name, last(name)]));
        const span = (a: string, b: string) => marks[a] !== null && marks[b] !== null ? Math.round(marks[b]! - marks[a]!) : null;
        return { marks, stepToReadyMs: span('payment-step-entered', 'payment-element-ready'),
          setupMs: span('payment-setup-start', 'payment-setup-response'), sdkMs: span('stripe-client-init-start', 'stripe-client-init-ready'),
          secretToReadyMs: span('client-secret-received', 'payment-element-ready'), mountToReadyMs: span('elements-mounted', 'payment-element-ready') };
      });
      console.log(JSON.stringify({ evidence: 'REAL STRIPE RENDER / INTERCEPTED API', label: process.env.ELECTROHUB_PERF_LABEL ?? 'current', mode, ...report }));
      expect(app.requests.filter(req => req.path === '/api/checkout/payment-attempts')).toHaveLength(1);
      await expect(page.getByRole('status', { name: 'Loading secure payment form' })).toHaveCount(0);
      const mounts = await page.evaluate(() => performance.getEntriesByName('electrohub.payment.elements-mounted').length);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('button', { name: 'Continue to Payment' }).click();
      await expect(ready()).toBeEnabled();
      expect(await page.evaluate(() => performance.getEntriesByName('electrohub.payment.elements-mounted').length)).toBe(mounts);
      expect(app.requests.filter(req => req.path === '/api/checkout/payment-attempts')).toHaveLength(1);
      if (mode === 'normal') {
        await page.reload();
        await expect(ready()).toBeEnabled({ timeout: 30_000 });
        await expect(card).toBeVisible();
        console.log(JSON.stringify({ mode, refreshHostedInputs: 'PASS' }));
      }
    } finally {
      await sdk.paymentIntents.cancel(intent.id);
      console.log(JSON.stringify({ mode, diagnosticIntentCanceled: true }));
    }
  });
}
