import { expect, request, test, type Page } from '@playwright/test';
import { apiOrigin, cartLink, customerApi, distinctClientAddress, expectNoHorizontalOverflow, fixtures, money, product, resetCustomerState, shopper,
  signInCustomer } from './support';

/**
 * Checkout, payment availability, orders, order documents and delivery tracking on the real stack.
 *
 * Payment: this hermetic stack has NO Stripe key, so the backend reports payment as unavailable. These tests prove the truthful
 * unavailable path (no Review/Place Order, no order or payment attempt created) and server-authoritative pricing. Successful, declined
 * and webhook-driven payments are covered by the backend Stripe/webhook/idempotency suites and the separate isolated real-Stripe Test
 * Mode harness — never claimed from this file.
 */
const dock = () => product('REL-ATLAS-DOCK');

async function fillShipping(page: Page) {
  await page.getByRole('textbox', { name: 'Full Name *' }).fill('Release Buyer');
  await page.getByRole('textbox', { name: 'Street Address *' }).fill('1 Main St');
  await page.getByRole('textbox', { name: 'City *' }).fill('Austin');
  await page.getByRole('textbox', { name: 'Postcode / ZIP *' }).fill('73301');
  await page.getByRole('textbox', { name: 'Country *' }).fill('United States');
  await page.getByRole('textbox', { name: 'Phone Number *' }).fill('+1 555 010 0000');
}

async function orderReferences(email: string) {
  const api = await customerApi(email);
  const orders = await (await api.get('/api/orders')).json() as { data: { items?: { orderReference: string }[] } | { orderReference: string }[] };
  await api.dispose();
  return (Array.isArray(orders.data) ? orders.data : orders.data.items ?? []).map(order => order.orderReference).sort();
}

test.describe('checkout and payment availability', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await distinctClientAddress(page, testInfo);
    await resetCustomerState(shopper(testInfo, 'checkout').email);
  });

  test('@responsive validates shipping, prices delivery from the server, and never offers payment the server cannot take', async ({ page }, testInfo) => {
    const buyer = shopper(testInfo, 'checkout');
    // Baseline: the seed adds a confirmed order on every stack start, so compare against what exists before this checkout.
    const before = await orderReferences(buyer.email);
    expect(before).toContain(buyer.orderReference);
    await signInCustomer(page, buyer.email);
    await page.goto(`/products/${dock().slug}`);
    await page.getByRole('button', { name: 'Add to Cart' }).click();
    await expect(cartLink(page, 1)).toBeVisible();
    await page.goto('/cart');
    await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
    await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible();

    // Required fields are enforced before the step can advance.
    await page.getByRole('button', { name: 'Continue to Delivery' }).click();
    await expect(page.getByRole('textbox', { name: 'Full Name *' })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Please complete this field.').first()).toBeVisible();
    await expect(page).toHaveURL(/step=shipping/);
    await fillShipping(page);
    await page.getByRole('button', { name: 'Continue to Delivery' }).click();

    // Delivery prices come from the server's shipping settings and flow into the total.
    const methods = page.getByRole('radiogroup', { name: 'Delivery Method' });
    await expect(methods.getByRole('radio', { name: /^Standard Delivery/ })).toBeChecked();
    const express = methods.getByRole('radio', { name: /^Express Delivery/ });
    const expressName = await express.ariaSnapshot();
    const expressPrice = Number(expressName.match(/\$([\d.,]+)/)?.[1]?.replace(/,/g, ''));
    expect(Number.isFinite(expressPrice), `express price in ${expressName}`).toBe(true);
    await express.check();
    const summary = page.getByRole('complementary', { name: 'Order Summary' });
    await expect(summary).toContainText(money(dock().price + expressPrice));
    await expectNoHorizontalOverflow(page, 'checkout delivery');

    await page.getByRole('button', { name: 'Continue to Payment' }).click();
    await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible();
    // Truthful provider-unavailable state: explanation, retry, and no way forward to placing an order.
    await expect(page.getByRole('status').filter({ hasText: /switched off|unavailable/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check availability again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review Order' })).toBeDisabled();
    await page.getByRole('button', { name: 'Check availability again' }).click();
    await expect(page.getByRole('button', { name: 'Review Order' })).toBeDisabled();

    // Server state: no new order and no payment attempt for this buyer; the cart is intact.
    expect(await orderReferences(buyer.email)).toEqual(before);
    const api = await customerApi(buyer.email);
    const attempts = await api.get('/api/checkout/payment-attempts');
    expect(attempts.status()).toBeLessThan(500);
    const cart = await (await api.get('/api/cart')).json() as { data: { items: { productId: string; quantity: number }[] } };
    expect(cart.data.items).toEqual([expect.objectContaining({ productId: dock().id, quantity: 1 })]);
    await api.dispose();

    // Navigating away and back keeps the saved checkout progress.
    await page.getByRole('link', { name: 'Return to Cart' }).click();
    await expect(page.getByRole('heading', { name: 'Shopping Cart', level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Payment Method' })).toBeVisible();
  });

  // Playwright requires the fixtures argument to be destructured even when this API-only test needs none.
  // eslint-disable-next-line no-empty-pattern
  test('client-supplied prices and payment state are ignored by the order and payment APIs', async ({}, testInfo) => {
    const api = await customerApi(shopper(testInfo, 'checkout').email);
    // A body carrying a client price is rejected outright by the strict schema; a normal add is priced by the server.
    const forged = await api.post('/api/cart/items', { data: { productId: dock().id, quantity: 1, price: 0.01, unitPrice: 0.01 } });
    expect(forged.status()).toBe(400);
    expect((await api.post('/api/cart/items', { data: { productId: dock().id, quantity: 1 } })).status()).toBe(201);
    const cart = await (await api.get('/api/cart')).json() as { data: { items: { product: { price: string } }[] } };
    expect(Number(cart.data.items[0].product.price)).toBe(dock().price);
    // Placing an order or starting a payment is refused on this payment-disabled stack, whatever the body claims.
    for (const [path, data] of [
      ['/api/checkout/payment-attempts', { total: '0.01', status: 'SUCCEEDED', paid: true }],
      ['/api/orders', { total: '0.01', paymentStatus: 'SUCCEEDED' }],
    ] as const) {
      const response = await api.post(path, { data });
      expect(response.status(), path).toBeGreaterThanOrEqual(400);
      expect(response.status(), path).toBeLessThan(500);
    }
    await api.dispose();
  });
});

test.describe('orders, documents and tracking', () => {
  test.beforeEach(async ({ page }, testInfo) => { await distinctClientAddress(page, testInfo); });

  test('@responsive order history and details show the server order with authoritative payment state', async ({ page }, testInfo) => {
    const buyer = shopper(testInfo, 'orders');
    await signInCustomer(page, buyer.email);
    await page.goto('/orders');
    await page.getByRole('link', { name: new RegExp(buyer.orderReference) }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: `Order ${buyer.orderReference}` })).toBeVisible();
    await expect(page.getByText('Order status: Confirmed')).toBeVisible();
    await expect(page.getByText('Payment status: Paid')).toBeVisible();
    const items = page.getByRole('region', { name: 'Items (3)' });
    await expect(items).toContainText(product('REL-AURORA-HP').name);
    await expect(items).toContainText(`${money(dock().price * 2)}`);
    const total = product('REL-AURORA-HP').price + dock().price * 2;
    await expect(page.getByRole('region', { name: 'Order Summary' })).toContainText(money(total));
    await expectNoHorizontalOverflow(page, 'order details');
    await page.reload();
    await expect(page.getByText('Payment status: Paid')).toBeVisible();
  });

  test('invoice, receipt and summary PDFs are served only to the owner', async ({ page }, testInfo) => {
    const buyer = shopper(testInfo, 'orders');
    const owner = await customerApi(buyer.email);
    for (const kind of ['invoice', 'receipt', 'summary']) {
      const response = await owner.get(`/api/orders/${buyer.orderReference}/documents/${kind}`);
      expect(response.status(), kind).toBe(200);
      expect(response.headers()['content-type']).toContain('application/pdf');
      expect(response.headers()['cache-control']).toMatch(/no-store/);
      const pdf = await response.body();
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(1_000);
    }
    const outsider = await customerApi(fixtures().outsider.email);
    for (const kind of ['invoice', 'receipt', 'summary']) {
      expect((await outsider.get(`/api/orders/${buyer.orderReference}/documents/${kind}`)).status(), `outsider ${kind}`).toBe(404);
    }
    expect((await outsider.get(`/api/orders/${buyer.orderReference}`)).status()).toBe(404);
    expect((await outsider.get(`/api/orders/${buyer.orderReference}/delivery`)).status()).toBe(404);
    const anonymous = await request.newContext({ baseURL: apiOrigin });
    expect((await anonymous.get(`/api/orders/${buyer.orderReference}/documents/invoice`)).status()).toBe(401);
    await Promise.all([owner.dispose(), outsider.dispose(), anonymous.dispose()]);

    // The UI download is a real PDF too.
    await signInCustomer(page, buyer.email);
    await page.goto(`/orders/${buyer.orderReference}`);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: `Download PDF: Payment receipt, order ${buyer.orderReference}` }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.pdf$/);

    // Another customer's order page is a not-found state, not a leak.
    await page.goto(`/orders/${fixtures().outsider.orderReference}`);
    await expect(page.getByRole('heading', { name: 'Order not found' })).toBeVisible();
  });

  test('@responsive the tracking page shows the authorized delivery state and live-update channel', async ({ page }, testInfo) => {
    const buyer = shopper(testInfo, 'orders');
    await signInCustomer(page, buyer.email);
    await page.goto(`/orders/${buyer.orderReference}/tracking`);
    await expect(page.getByRole('heading', { level: 1, name: `Track order ${buyer.orderReference}` })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Delivery overview' })).toContainText(/Order confirmed|Confirmed/);
    await expect(page.getByRole('region', { name: 'Delivery progress' }).getByRole('listitem').first()).toContainText('Confirmed');
    await expect(page.getByText(/Live updates on/)).toBeVisible();
    await expectNoHorizontalOverflow(page, 'tracking');
  });
});
