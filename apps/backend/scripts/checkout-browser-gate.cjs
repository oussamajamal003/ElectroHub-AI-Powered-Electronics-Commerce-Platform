// Real browser → real localhost API → DEV PostgreSQL. No route interception.
process.env.NODE_ENV = 'test';
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const app = require('../dist/app.js').default;
const { prisma } = require('../dist/lib/prisma.js');
const { env } = require('../dist/config/env.js');
const { hashPassword } = require('../dist/utils/hash.js');
if (![env.DATABASE_URL, env.DIRECT_URL].every(value => value.includes('pzxekjybdiulzmssalfo') && !value.includes('yepfgjehdstlxbpespun'))) throw new Error('DEV target mismatch.');
const userId = randomUUID(); const categoryId = randomUUID(); const productIds = [randomUUID(), randomUUID()];
const label = `checkout-browser-${randomUUID()}`;
const frontend = path.resolve('../frontend'); const output = path.join(frontend, 'screenshots/checkout-live');
let server, vite, browser;
const shipping = { recipient: 'Browser Checkout Customer', line1: '123 Long Demonstration Boulevard, Building A', line2: 'Apartment 405, Fourth Floor', city: 'Demonstration City', postalCode: '12345', state: 'Demonstration Province', country: 'United States', phone: '+1 555 010 2000' };
const safe = text => String(text).replace(/postgres(?:ql)?:\/\/\S+/gi, '[DATABASE URL REDACTED]');
(async () => {
  try {
    const applied = await prisma.$queryRaw`SELECT checksum FROM "_prisma_migrations" WHERE migration_name='20261006000000_checkout_core' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert.equal(applied[0]?.checksum, require('node:crypto').createHash('sha256').update(fs.readFileSync('prisma/migrations/20261006000000_checkout_core/migration.sql')).digest('hex'));
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
    const password = `Browser-${randomUUID()}-Aa1!`; const email = `${label}@example.invalid`;
    await prisma.user.create({ data: { id: userId, roleId: role.id, email, passwordHash: await hashPassword(password), firstName: 'Browser', lastName: 'Checkout', emailVerifiedAt: new Date() } });
    await prisma.category.create({ data: { id: categoryId, name: label, slug: label } });
    for (const [index, id] of productIds.entries()) await prisma.product.create({ data: { id, categoryId, name: `Checkout Browser Product ${index + 1}`, slug: `${label}-${index}`, sku: `${label}-${index}`,
      price: index === 0 ? '19.99' : '10.00', inventory: { create: { quantity: 6, lowStockAt: 5, status: 'IN_STOCK' } },
      images: { create: { url: '/images/catalog/variety/apple-phone-generic-01.jpg', isPrimary: true } } } });
    server = await new Promise((resolve, reject) => { const listener = app.listen(5115, '127.0.0.1', () => resolve(listener)); listener.on('error', reject); });
    vite = spawn(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', '3116', '--strictPort'], {
      cwd: frontend, env: { ...process.env, E2E_API_PROXY_TARGET: 'http://127.0.0.1:5115' }, windowsHide: true, stdio: 'ignore' });
    const deadline = Date.now() + 60000;
    while (true) {
      if (vite.exitCode !== null) throw new Error('Frontend local server exited before readiness.');
      try { if ((await fetch('http://127.0.0.1:3116')).ok) break; } catch { /* Wait for the owned local server readiness. */ }
      if (Date.now() >= deadline) throw new Error('Frontend local server readiness failed.');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3116', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); const failures = []; const network = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) network.push({ method: request.method(), path: url.pathname, started: Date.now() }); });
    const login = await context.request.post('/api/auth/login', { data: { email, password } }); assert.equal(login.status(), 200);
    const token = (await login.json()).accessToken;
    for (const [index, productId] of productIds.entries()) {
      const added = await context.request.post('/api/cart/items', { data: { productId, quantity: index === 0 ? 2 : 3 }, headers: { Authorization: `Bearer ${token}` } }); assert.equal(added.status(), 201);
    }
    fs.mkdirSync(output, { recursive: true });
    const screenshot = async state => {
      for (const width of [390, 768, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: path.join(output, `${state}-${width}.png`), fullPage: true });
      }
    };
    await page.goto('/checkout'); await page.getByRole('heading', { name: 'Shipping Information' }).waitFor();
    await page.getByText('Checkout Browser Product 2', { exact: true }).waitFor(); await screenshot('shipping');
    for (const [field, value] of Object.entries(shipping)) await page.locator(`#shipping-${field}`).fill(value);
    await page.getByRole('button', { name: 'Continue to Delivery' }).click(); await page.getByRole('radio', { name: /Express Delivery/ }).check(); await screenshot('delivery');
    await page.getByRole('button', { name: 'Continue to Payment' }).click(); await page.getByRole('heading', { name: 'Payment Method', exact: true }).waitFor();
    assert.equal(await page.locator('input').count(), 0); await screenshot('payment');
    await page.getByRole('button', { name: 'Review Order' }).click(); await page.getByRole('heading', { name: 'Review Your Order' }).waitFor(); await screenshot('review');
    const started = Date.now(); const committed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/orders' && response.request().method() === 'POST', { timeout: 60000 });
    await page.getByRole('button', { name: /Place Order/ }).click(); await page.getByText('Processing your order…').waitFor();
    await page.screenshot({ path: path.join(output, 'processing-1920.png'), fullPage: true });
    const response = await committed; const apiMs = Date.now() - started; assert.equal(response.status(), 201); const result = (await response.json()).data;
    assert.equal(result.confirmation.total, '79.97'); assert.equal(result.confirmation.paymentState, 'UNPROCESSED'); assert.equal(result.confirmation.items.length, 2); assert.deepEqual(result.cart.items, []);
    await page.getByText('Order Confirmed!').waitFor(); await screenshot('confirmation');
    // Persisted snapshots must survive a changed current Product and hard refresh.
    await prisma.product.update({ where: { id: productIds[0] }, data: { name: 'Changed disposable current Product', price: '99.99' } });
    await page.reload(); await page.getByText('Checkout Browser Product 1', { exact: true }).waitFor();
    assert.equal(await page.getByText('Changed disposable current Product', { exact: true }).count(), 0);
    const reference = result.confirmation.orderReference;
    const persisted = await context.request.get(`/api/orders/${reference}/confirmation`, { headers: { Authorization: `Bearer ${token}` } }); assert.equal(persisted.status(), 200);
    assert.deepEqual((await persisted.json()).data, result.confirmation);
    const stock = await prisma.inventory.findMany({ where: { productId: { in: productIds } }, select: { productId: true, quantity: true } });
    assert.equal(stock.find(item => item.productId === productIds[0]).quantity, 4); assert.equal(stock.find(item => item.productId === productIds[1]).quantity, 3);
    assert.equal(await prisma.cartItem.count({ where: { cart: { userId } } }), 0); assert.equal(await prisma.order.count({ where: { userId } }), 1);
    assert.equal(network.filter(item => item.path === '/api/orders' && item.method === 'POST').length, 1); assert.equal(network.filter(item => item.path.includes('/inventory')).length, 0);
    assert.deepEqual(failures, []);
    console.log(JSON.stringify({ gate: 'REAL DEV Chromium → localhost API → PostgreSQL', result: 'PASS', reference, products: productIds, orderTotal: '79.97', inventory: stock, cartRows: 0, orderRows: 1, apiMs, submissionAndReloadVerificationMs: Date.now() - started,
      screenshots: output, requestCounts: { orders: 1, inventoryHTTP: 0 }, runtimeErrors: failures }));
  } finally {
    if (browser) await browser.close(); if (vite) vite.kill(); if (server) await new Promise(resolve => server.close(resolve));
    await prisma.order.deleteMany({ where: { userId } }); await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } }); await prisma.user.deleteMany({ where: { id: userId } }); await prisma.category.deleteMany({ where: { id: categoryId } });
    assert.equal(await prisma.product.count({ where: { id: { in: productIds } } }), 0); assert.equal(await prisma.user.count({ where: { id: userId } }), 0);
    console.log('REAL DEV browser fixture cleanup PASS; curated data unchanged; PROD not used.'); await prisma.$disconnect();
  }
})().catch(error => { console.error(safe(error.message)); process.exitCode = 1; });
