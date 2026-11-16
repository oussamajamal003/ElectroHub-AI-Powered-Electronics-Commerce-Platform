// Isolate real Stripe-hosted input rendering; no application/DB data and no saved secrets.
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');
const Stripe = require('stripe');
const { chromium } = require('playwright');
const vars = { ...dotenv.parse(fs.readFileSync('.env')), ...dotenv.parse(fs.readFileSync('.env.local')) };
const front = dotenv.parse(fs.readFileSync('../frontend/.env'));
if (!vars.STRIPE_SECRET_KEY?.startsWith('sk_test_') || !front.VITE_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_')) throw new Error('Test keys required.');
const sdk = new Stripe(vars.STRIPE_SECRET_KEY, { apiVersion: '2026-09-30.endive' });
const safe = value => String(value).replace(/(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]+|pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g, '[REDACTED]').replace(/https?:\/\/\S+/g, '[URL REDACTED]');
let browser, intent, server;
(async () => {
  try {
    intent = await sdk.paymentIntents.create({ amount: 100, currency: 'usd', capture_method: 'manual', allowed_payment_method_types: ['card'], metadata: { diagnostic: randomUUID() } });
    console.log(JSON.stringify({ allowed: intent.allowed_payment_method_types, offered: intent.payment_method_types, automatic: intent.automatic_payment_methods }));
    browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') console.log(JSON.stringify({ console: safe(msg.text()) })); });
    page.on('pageerror', error => console.log(JSON.stringify({ error: safe(error.message) })));
    page.on('requestfailed', req => console.log(JSON.stringify({ network: new URL(req.url()).hostname + new URL(req.url()).pathname, error: safe(req.failure()?.errorText) })));
    server = require('node:http').createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html><body><h1>Real Stripe rendering probe</h1><div id="payment"></div></body></html>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addScriptTag({ url: 'https://js.stripe.com/endive/stripe.js' });
    await page.evaluate(async ({ key, secret }) => { const stripe = window.Stripe(key); window.probeStripe = stripe; const elements = stripe.elements({ clientSecret: secret, appearance: { theme: 'stripe', variables: { colorPrimary: '#2563EB', fontFamily: 'Poppins, sans-serif', borderRadius: '0px' } } }); window.probeElements = elements;
      elements.create('payment', { layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never', link: 'never' } }).mount('#payment'); }, { key: front.VITE_STRIPE_PUBLISHABLE_KEY, secret: intent.client_secret });
    try {
      const frame = page.frameLocator('iframe[src*="elements-inner-accessory-target"]');
      await frame.getByLabel('Card number', { exact: true }).fill('4242424242424242', { timeout: 45000 });
      await frame.getByLabel(/Expiration/).fill('1230'); await frame.getByLabel('Security code', { exact: true }).fill('123');
      for (const width of [390, 768, 1440, 1920]) await page.setViewportSize({ width, height: 1000 });
      console.log('REAL hosted card input PASS');
      const result = await page.evaluate(async () => { const result = await window.probeElements.submit(); return result.error ? { type: result.error.type, code: result.error.code, message: result.error.message } : { validation: 'PASS' }; });
      console.log(safe(JSON.stringify(result)));
      const confirmed = await page.evaluate(async () => { const result = await window.probeStripe.confirmPayment({ elements: window.probeElements, confirmParams: { return_url: location.origin }, redirect: 'if_required' }); return result.error ? { type: result.error.type, code: result.error.code, message: result.error.message } : { status: result.paymentIntent.status }; });
      console.log(safe(JSON.stringify(confirmed)));
      console.log(JSON.stringify({ serverReadback: (await sdk.paymentIntents.retrieve(intent.id)).status }));
    }
    finally { for (const frame of page.frames()) { const url = new URL(frame.url() || 'about:blank'); if (url.hostname === 'js.stripe.com') console.log(JSON.stringify({ path: url.pathname, text: safe(await frame.locator('body').innerText()).slice(0, 150), labels: await frame.locator('input').evaluateAll(nodes => nodes.map(n => ({ label: n.getAttribute('aria-label'), id: n.id }))) })); } }
  } finally { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); if (intent) await sdk.paymentIntents.cancel(intent.id); console.log('Probe intent cleanup PASS'); }
})().catch(error => { console.error(safe(String(error.message).split('\n')[0])); process.exitCode = 1; });
