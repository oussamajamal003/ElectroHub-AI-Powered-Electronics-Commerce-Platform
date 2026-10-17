import { expect, test } from '@playwright/test';
import { harness, fillShipping, attemptId, review, fillCard } from './stripe.harness';
import { cart, quote } from '../../src/features/checkout/fixtures';

const viewports = [390, 768, 1440, 1920];

const mockProduct = {
  data: {
    id: 'prod-watch-9',
    name: 'Apple Watch Series 9 GPS 41mm Silver',
    description: 'Smartwatch with advanced health and fitness tracking.',
    slug: 'apple-watch-series-9-41mm-gps-silver',
    price: '399.00',
    compareAtPrice: '429.00',
    discountPercent: 7,
    averageRating: '4.8',
    reviewCount: 42,
    currency: 'USD',
    availability: 'AVAILABLE',
    stockStatus: 'IN_STOCK',
    availableQuantity: 15,
    purchasable: true,
    primaryImage: { id: 'img-1', url: '/images/catalog/variety/watchseries9-silver-1.jpg', altText: 'Apple Watch Series 9 Silver', sortOrder: 0, isPrimary: true },
    category: { id: 'cat-wearables', name: 'Wearables', slug: 'wearables' },
    brand: { id: 'brand-apple', name: 'Apple', slug: 'apple' },
    sku: 'AW9-41-SILVER',
    images: [{ id: 'img-1', url: '/images/catalog/variety/watchseries9-silver-1.jpg', altText: 'Apple Watch Series 9 Silver', sortOrder: 0, isPrimary: true }],
    specifications: [],
  },
};

test.describe('Task 03.6 UI/UX Refinements', () => {

  for (const width of viewports) {
    test(`Product Details -> Buy Now text is black (#000000) at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route('**/api/products/apple-watch-series-9-41mm-gps-silver', route => route.fulfill({ json: mockProduct }));
      await page.route('**/api/products/apple-watch-series-9-41mm-gps-silver/reviews*', route => route.fulfill({ json: { data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } } }));
      await page.route('**/api/cart', route => route.fulfill({ json: { data: { items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false } } }));
      await page.route('**/api/wishlist', route => route.fulfill({ json: { data: { items: [], totalItems: 0 } } }));
      await page.goto('/products/apple-watch-series-9-41mm-gps-silver');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
      const buyNowButton = page.getByRole('button', { name: 'Buy Now' });
      await expect(buyNowButton).toBeVisible({ timeout: 15000 });

      // Verify computed text color is black rgb(0, 0, 0)
      const color = await buyNowButton.evaluate(el => window.getComputedStyle(el).color);
      expect(color).toBe('rgb(0, 0, 0)');

      // Verify hover state: text stays black
      await buyNowButton.hover();
      const hoverColor = await buyNowButton.evaluate(el => window.getComputedStyle(el).color);
      expect(hoverColor).toBe('rgb(0, 0, 0)');

      // Verify Add to Cart button remains untouched (primary color)
      const addToCartButton = page.getByRole('button', { name: 'Add to Cart' });
      await expect(addToCartButton).toBeVisible();
      const addColor = await addToCartButton.evaluate(el => window.getComputedStyle(el).color);
      expect(addColor).not.toBe('rgb(0, 0, 0)');
    });
  }

  for (const width of viewports) {
    test(`Processing screen has centered layout and NO extra chrome at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const api = await harness(page);
      api.hold();

      await page.goto('/checkout');
      await review(page);

      // Verify clicking Place Order scrolls immediately to top
      await page.evaluate(() => window.scrollTo({ top: 350, behavior: 'instant' }));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await page.getByRole('button', { name: /Place Order/ }).click();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      // Verify Processing heading is visible
      const heading = page.getByRole('heading', { name: 'Processing your order…' });
      await expect(heading).toBeVisible();

      // Verify NO breadcrumb, NO Checkout title, NO stepper, NO Order Summary
      await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Checkout', level: 1 })).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Checkout steps' })).toHaveCount(0);
      await expect(page.getByRole('complementary')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Order Summary' })).toHaveCount(0);

      // Verify existing Navbar and Footer ARE present
      await expect(page.locator('header')).toBeVisible();
      await expect(page.locator('footer')).toBeVisible();

      // Verify processing wrapper is centered
      const processingSection = page.locator('section[aria-labelledby="processing-heading"]');
      await expect(processingSection).toBeVisible();
      const box = await processingSection.boundingBox();
      expect(box).not.toBeNull();
      // Centered horizontally: box.x + box.width / 2 is close to viewport width / 2
      const centerX = box!.x + box!.width / 2;
      expect(Math.abs(centerX - width / 2)).toBeLessThan(width * 0.1);

      api.release();
    });
  }

  for (const width of viewports) {
    test(`Payment Failed screen has centered layout, Make direction, and destination scroll-to-top at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1920 ? 906 : 900 });
      await harness(page, { state: 'DECLINED' });

      await page.goto('/checkout');
      await review(page);
      await page.getByRole('button', { name: /Place Order/ }).click();

      // Verify failure heading and icon
      const heading = page.getByRole('heading', { name: 'Payment Failed' });
      await expect(heading).toBeVisible();
      await expect(page.locator('div[class*="failureIcon"]')).toBeVisible();
      await expect(page.locator('div[class*="failureNotice"]')).toBeVisible();
      await expect(page.getByText('Your payment was declined. Please check your card details or try a different card.')).toBeVisible();
      await expect(page.getByText('Payment not processed')).toBeVisible();
      await expect(page.getByText('Your purchase has been preserved. You can try again or use another card.')).toBeVisible();

      // Verify NO breadcrumb, NO Checkout title, NO stepper, NO Order Summary
      await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Checkout', level: 1 })).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Checkout steps' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Order Summary' })).toHaveCount(0);

      // Verify existing buttons
      const checkBtn = page.getByRole('button', { name: 'Check payment status' });
      const retryBtn = page.getByRole('button', { name: 'Try Again' });
      const returnCartLink = page.getByRole('link', { name: 'Return to Cart' });
      await expect(page.getByText(/could not be authorized/i)).toHaveCount(0);
      await expect(checkBtn).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Payment Failed' })).toHaveCount(1);
      await expect(retryBtn).toBeVisible();
      await expect(returnCartLink).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (width === 1920) await page.screenshot({ path: 'test-results/checkout/payment-failed-1920.png' });

      // Verify Navbar and Footer ARE visible
      await expect(page.locator('header')).toBeVisible();
      await expect(page.locator('footer')).toBeVisible();

      // Verify action clicking triggers scroll-to-top
      await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'instant' }));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

      await retryBtn.click();
      await page.waitForFunction(() => window.scrollY === 0, { timeout: 5000 });
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBe(0);

      await fillCard(page);
      await page.getByRole('button', { name: 'Review Order' }).click();
      await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible({ timeout: 10000 });
    });
  }

  test('PREPARING setup keeps one skeleton and resumes the same idempotent attempt', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await harness(page);
    const keys: string[] = [];
    let setupCount = 0;
    await page.route('**/api/checkout/payment-attempts', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      setupCount += 1;
      keys.push(route.request().headers()['idempotency-key'] ?? '');
      if (setupCount !== 1) return route.fallback();
      return route.fulfill({ status: 202, json: { data: {
        attemptId, state: 'PREPARING', providerStatus: null, failureCode: null,
        total: quote.deliveryMethods[0].totals.total, currency: 'USD', orderReference: null,
        committed: false, cart: quote.deliveryMethods[0].totals, recoveryRemainder: null,
        confirmation: null, recoveryActive: true, clientSecret: null, replayed: false,
      } } });
    });

    await page.goto('/checkout');
    await fillShipping(page);
    await page.getByRole('radio', { name: /Express Delivery/ }).check();
    await page.getByRole('button', { name: 'Continue to Payment' }).click();
    const skeleton = page.getByRole('status', { name: 'Loading secure payment form' });
    await expect(skeleton).toBeVisible();
    await expect(skeleton).toHaveCount(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('iframe[title="Mock hosted card entry — intercepted UI test"]')).toBeVisible({ timeout: 10000 });
    expect(setupCount).toBe(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    await expect(page).toHaveURL(/step=payment/);
  });

  test('auth hydration on a direct protected URL shows a stable shell before resolving', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await harness(page);
    let releaseRefresh!: () => void;
    await page.route('**/api/auth/refresh', async route => {
      await new Promise<void>(resolve => { releaseRefresh = resolve; });
      await route.fulfill({ json: { accessToken: 'intercepted-ui-test-token' } });
    });
    await page.goto('/checkout');
    await expect(page.getByRole('link', { name: 'ElectroHub — Home' })).toBeVisible();
    await expect(page.getByText('Restoring your session…')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Account' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Shipping Information' })).toHaveCount(0);
    releaseRefresh();
    await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible({ timeout: 15000 });
  });

  test('new tab keeps the hydration shell until a valid session is restored', async ({ context }) => {
    const newTab = await context.newPage();
    await newTab.setViewportSize({ width: 390, height: 844 });
    await harness(newTab);
    let releaseRefresh!: () => void;
    await newTab.route('**/api/auth/refresh', async route => {
      await new Promise<void>(resolve => { releaseRefresh = resolve; });
      await route.fulfill({ json: { accessToken: 'intercepted-ui-test-token' } });
    });

    await newTab.goto('/checkout');
    await expect(newTab.getByRole('link', { name: 'ElectroHub — Home' })).toBeVisible();
    await expect(newTab.getByText('Restoring your session…')).toHaveCount(0);
    await expect(newTab.getByRole('button', { name: 'Account' })).toHaveCount(0);

    releaseRefresh();
    await expect(newTab.getByRole('heading', { name: 'Shipping Information' })).toBeVisible({ timeout: 15000 });
  });

  test('Return to Cart navigates to the top from a confirmed decline', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await harness(page, { state: 'DECLINED' });
    await page.goto('/checkout');
    await review(page);
    await page.getByRole('button', { name: /Place Order/ }).click();
    await expect(page.getByRole('heading', { name: 'Payment Failed' })).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'instant' }));
    await page.getByRole('link', { name: 'Return to Cart' }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('direct customer navigation to a hidden fixture renders unavailable with no purchase controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await harness(page);
    await page.route('**/api/products/hidden-payment-fixture', route => route.fulfill({
      status: 404, json: { error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } },
    }));
    await page.goto('/products/hidden-payment-fixture');
    await expect(page.getByRole('heading', { name: 'Product unavailable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to Cart' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Buy Now' })).toHaveCount(0);
  });

  for (const width of viewports) {
    for (const delayedQuote of [false, true]) {
      test(`confirmed decline → Cart → fresh Checkout has no terminal frame at ${width}px (delayed quote: ${delayedQuote})`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await harness(page, { state: 'DECLINED' });
        await page.goto('/checkout');
        await review(page);
        await page.getByRole('button', { name: /Place Order/ }).click();
        await expect(page.getByRole('heading', { name: 'Payment Failed' })).toBeVisible();
        await page.getByRole('link', { name: 'Return to Cart' }).click();
        await expect(page).toHaveURL(/\/cart$/);
        await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();
        // Submitted A left the active Cart; the customer then builds an independent Cart B.
        await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toHaveCount(0);
        await page.route('**/api/cart', route => route.fulfill({ json: { data: cart } }));
        await page.reload();
        await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeVisible();

        if (delayedQuote) {
          await page.route('**/api/checkout', async route => {
            if (route.request().method() === 'GET') await new Promise(resolve => setTimeout(resolve, 250));
            await route.fallback();
          });
        }
        await page.evaluate(() => {
          const captured: string[] = [];
          const observer = new MutationObserver(records => {
            for (const record of records) {
              const text = record.type === 'characterData' ? record.target.textContent :
                [...record.addedNodes].map(node => node.textContent ?? '').join(' ');
              if (text?.includes('Payment Failed')) captured.push(text);
            }
          });
          observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
          Object.assign(window, { __checkoutTerminalFrames: captured, __checkoutTerminalObserver: observer });
        });
        await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
        const shipping = page.getByRole('heading', { name: 'Shipping Information' });
        const neutral = page.getByRole('status', { name: /Restoring|Loading|Recovering/i });
        await expect(shipping.or(neutral)).toBeVisible();
        await expect(shipping).toBeVisible({ timeout: 15000 });
        const staleFrames = await page.evaluate(() => {
          (window as typeof window & { __checkoutTerminalObserver?: MutationObserver }).__checkoutTerminalObserver?.disconnect();
          return (window as typeof window & { __checkoutTerminalFrames?: string[] }).__checkoutTerminalFrames ?? [];
        });
        expect(staleFrames).toEqual([]);
        await expect(page.getByRole('heading', { name: 'Payment Failed' })).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: `test-results/checkout/fresh-shipping-after-decline-${width}-${delayedQuote ? 'delayed' : 'fast'}.png`, fullPage: true });
      });
    }
  }

  test('confirmed failure → Products → Cart → Checkout reconciles without a stale failure frame', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await harness(page, { state: 'DECLINED' });
    await page.goto('/checkout');
    await review(page);
    await page.getByRole('button', { name: /Place Order/ }).click();
    await expect(page.getByRole('heading', { name: 'Payment Failed' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Products' }).click();
    await expect(page).toHaveURL(/\/products$/);
    await page.getByRole('link', { name: /^Cart/ }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();
    // Submitted A left the active Cart; the customer then builds an independent Cart B.
    await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toHaveCount(0);
    await page.route('**/api/cart', route => route.fulfill({ json: { data: cart } }));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeVisible();

    await page.evaluate(() => {
      const captured: string[] = [];
      const observer = new MutationObserver(records => {
        for (const record of records) {
          const text = record.type === 'characterData' ? record.target.textContent :
            [...record.addedNodes].map(node => node.textContent ?? '').join(' ');
          if (text?.includes('Payment Failed')) captured.push(text);
        }
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      Object.assign(window, { __checkoutTerminalFrames: captured, __checkoutTerminalObserver: observer });
    });
    await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
    await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible({ timeout: 15000 });
    const staleFrames = await page.evaluate(() => {
      (window as typeof window & { __checkoutTerminalObserver?: MutationObserver }).__checkoutTerminalObserver?.disconnect();
      return (window as typeof window & { __checkoutTerminalFrames?: string[] }).__checkoutTerminalFrames ?? [];
    });
    expect(staleFrames).toEqual([]);
    await expect(page.getByRole('heading', { name: 'Payment Failed' })).toHaveCount(0);
  });

  for (const width of viewports) {
    test(`Payment step skeleton loading state and no layout jump at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      let releaseSetup: (() => void) | undefined;
      await harness(page);

      // Route setup to hold so we can inspect the loading skeleton
      await page.route('**/api/checkout/payment-attempts', async route => {
        if (route.request().method() === 'POST') {
          await new Promise<void>(resolve => { releaseSetup = resolve; });
          return route.fulfill({
            status: 201,
            json: {
              data: {
                attemptId,
                state: 'AWAITING_INPUT',
                providerStatus: 'requires_payment_method',
                failureCode: null,
                total: quote.deliveryMethods[0].totals.total,
                currency: 'USD',
                orderReference: null,
                committed: false,
                cart: quote.deliveryMethods[0].totals,
                recoveryRemainder: null,
                confirmation: null,
                clientSecret: 'pi_intercepted_secret_fixture',
                replayed: false,
              },
            },
          });
        }
        return route.continue();
      });

      await page.goto('/checkout');
      await fillShipping(page);
      await page.getByRole('button', { name: 'Continue to Payment' }).click();

      // Verify skeleton is rendered
      const skeleton = page.locator('div[role="status"][aria-label="Loading secure payment form"]');
      await expect(skeleton).toBeVisible();

      // Check NO spinner (ElectroHubLoader) and NO text
      await expect(page.locator('text="Loading page…"')).toHaveCount(0);
      await expect(page.locator('text="Preparing secure card entry…"')).toHaveCount(0);
      await expect(page.locator('text="Loading secure card entry…"')).toHaveCount(0);
      await expect(skeleton.locator('svg')).toHaveCount(0);

      // Verify skeleton height preserves space (~264px) to prevent layout shift
      const skeletonBox = await skeleton.boundingBox();
      expect(skeletonBox).not.toBeNull();
      expect(skeletonBox!.height).toBeGreaterThanOrEqual(250);

      // Check NO error/conflict or retry/refresh buttons during normal loading
      await expect(page.getByText('Another payment attempt is active')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Retry payment setup' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Refresh totals' })).toHaveCount(0);

      // Release setup and let Stripe mount
      releaseSetup?.();
      await expect(page.locator('iframe[title*="Mock hosted card entry"]')).toBeVisible();

      // Mounting secure entry inside the reserved space never pushes the page down.
      // The intercepted fixture sizes its iframe to its own content (like the hosted SDK), so the real
      // Payment Element height is NOT modelled here; only the no-push-down property is verifiable.
      const providerShell = page.locator('div[class*="providerShell"]');
      const mountedBox = await providerShell.boundingBox();
      expect(mountedBox).not.toBeNull();
      expect(mountedBox!.height).toBeLessThanOrEqual(skeletonBox!.height + 2);
      await expect(page.getByRole('button', { name: 'Review Order' })).toBeEnabled();
    });
  }

  for (const width of viewports) {
    test(`Normal payment ready state at ${width}px has no conflict/retry/refresh UI`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await harness(page);
      await page.goto('/checkout');
      await fillShipping(page);
      await page.getByRole('button', { name: 'Continue to Payment' }).click();

      await expect(page.locator('iframe[title*="Mock hosted card entry"]')).toBeVisible();

      // Verify ready state does not show conflict or retry/refresh
      await expect(page.getByText('Another payment attempt is active')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Retry payment setup' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Refresh totals' })).toHaveCount(0);
    });
  }

  for (const width of viewports) {
    test(`Active payment-attempt conflict UI and action visibility rules at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await harness(page);

      // Intercept payment-attempts to return 409 conflict
      await page.route('**/api/checkout/payment-attempts', async route => {
        if (route.request().method() === 'POST') {
          return route.fulfill({
            status: 409,
            json: {
              error: {
                code: 'PAYMENT_RECOVERY_PENDING',
                message: 'Another payment attempt is active. Resolve it before starting a new checkout.',
              },
            },
          });
        }
        return route.continue();
      });

      await page.goto('/checkout');
      await fillShipping(page);
      await page.getByRole('button', { name: 'Continue to Payment' }).click();

      // Verify exact single short message in alert (no duplicate banners)
      const alert = page.getByRole('alert');
      await expect(alert).toHaveCount(1);
      await expect(alert).toHaveText('Another payment attempt is being resolved. Retry setup after it finishes.');

      // Verify single primary action "Retry payment setup" IS visible (no duplicate button)
      const retryButton = page.getByRole('button', { name: 'Retry payment setup' });
      await expect(retryButton).toHaveCount(1);
      await expect(retryButton).toBeVisible();

      // Verify secondary action "Refresh totals" is NOT visible because totals are not stale
      await expect(page.getByRole('button', { name: 'Refresh totals' })).toHaveCount(0);
    });
  }

  for (const width of viewports) {
    test(`Delivery step skeleton displays during quote loading and updates cleanly at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      let releaseQuote: (() => void) | undefined;
      await harness(page);

      // Route /api/checkout to hold so we can inspect delivery skeletons
      await page.route('**/api/checkout', async route => {
        if (route.request().method() === 'GET') {
          await new Promise<void>(resolve => { releaseQuote = resolve; });
          return route.fulfill({ json: { data: quote } });
        }
        return route.continue();
      });

      await page.goto('/checkout');
      await fillShipping(page);

      // Verify delivery skeleton is visible with status role
      const skeleton = page.locator('div[role="status"][aria-label="Loading delivery options"]');
      await expect(skeleton).toBeVisible();

      // Check 3 delivery method skeleton cards (Standard, Express, Overnight)
      const skeletonCards = skeleton.locator('div[class*="deliveryOptionSkeleton"]');
      await expect(skeletonCards).toHaveCount(3);

      // Check NO spinner, NO "Loading page…" text
      await expect(page.locator('text="Loading page…"')).toHaveCount(0);
      await expect(skeleton.locator('svg')).toHaveCount(0);

      // Continue to Payment button is disabled while loading
      await expect(page.getByRole('button', { name: 'Continue to Payment' })).toBeDisabled();

      // Release quote and verify real delivery options appear immediately
      releaseQuote?.();
      await expect(page.getByRole('radiogroup', { name: 'Delivery Method' })).toBeVisible();
      await expect(page.getByRole('radio', { name: /Standard Delivery/ })).toBeVisible();
      await expect(page.getByRole('radio', { name: /Express Delivery/ })).toBeVisible();
      await expect(page.getByRole('radio', { name: /Overnight Delivery/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Continue to Payment' })).toBeEnabled();
    });
  }

  for (const width of viewports) {
    test(`Stale-total recovery state shows Refresh totals at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await harness(page);

      // Intercept payment-attempts to return conflict
      await page.route('**/api/checkout/payment-attempts', async route => {
        if (route.request().method() === 'POST') {
          return route.fulfill({
            status: 409,
            json: {
              error: {
                code: 'PAYMENT_RECOVERY_PENDING',
                message: 'Another payment attempt is active. Resolve it before starting a new checkout.',
              },
            },
          });
        }
        return route.continue();
      });

      // Deliver quote with mismatched cartRevision to simulate stale totals
      await page.route('**/api/checkout', async route => {
        const staleQuote = {
          ...quote,
          cartRevision: 'stale-rev-9999999999999999999999999999999999999999999999999999999999999999',
        };
        return route.fulfill({ json: { data: staleQuote } });
      });

      await page.goto('/checkout');
      await fillShipping(page);
      await page.getByRole('button', { name: 'Continue to Payment' }).click();

      // When totals are stale, Refresh totals is rendered
      const refreshTotalsButton = page.getByRole('button', { name: 'Refresh totals' });
      await expect(refreshTotalsButton).toBeVisible();

      // Retry payment setup is not shown unnecessarily while totals are stale
      await expect(page.getByRole('button', { name: 'Retry payment setup' })).toHaveCount(0);
    });
  }

  for (const width of viewports) {
    test(`Confirmation screen displays Order Received and Paid badges, no Processing badge, and scrolls to top at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await harness(page);

      await page.goto('/checkout');
      await review(page);

      // Scroll down before placing order
      await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

      // Place Order
      await page.getByRole('button', { name: /Place Order/ }).click();

      // Lands on Order Confirmed page
      await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toBeVisible({ timeout: 15000 });

      // Verify Order Received badge and Paid badge
      const orderReceivedBadge = page.getByText('Order Received', { exact: true });
      await expect(orderReceivedBadge).toBeVisible();
      const paidBadge = page.getByText('Paid', { exact: true });
      await expect(paidBadge).toBeVisible();

      // Verify NO misleading "Processing" badge or text anywhere
      await expect(page.getByText('Processing your order…')).toHaveCount(0);
      await expect(page.locator('text="Processing"')).toHaveCount(0);

      // Verify scroll position on Confirmation is at the very top (0)
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBe(0);
    });
  }

  for (const width of viewports) {
    test(`Sticky Navbar stays fixed at top when scrolling Checkout screens at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await harness(page);

      // 1. Shipping Step
      await page.goto('/checkout');
      await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible({ timeout: 15000 });
      await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'instant' }));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      const header = page.locator('header');
      await expect(header).toBeVisible();
      let headerBox = await header.boundingBox();
      expect(headerBox).not.toBeNull();
      expect(headerBox!.y).toBe(0);

      await page.screenshot({ path: `test-results/checkout/sticky-navbar-shipping-${width}.png` });

      // 2. Review Step
      await review(page);
      await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible({ timeout: 10000 });
      await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      headerBox = await header.boundingBox();
      expect(headerBox).not.toBeNull();
      expect(headerBox!.y).toBe(0);

      await page.screenshot({ path: `test-results/checkout/sticky-navbar-review-${width}.png` });

      // 3. Confirmation Step
      await page.getByRole('button', { name: /Place Order/ }).click();
      await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toBeVisible({ timeout: 15000 });
      await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'instant' }));
      headerBox = await header.boundingBox();
      expect(headerBox).not.toBeNull();
      expect(headerBox!.y).toBe(0);

      await page.screenshot({ path: `test-results/checkout/sticky-navbar-confirmation-${width}.png` });
    });
  }

  for (const width of viewports) {
    test(`Confirmation badges layout in top-right corner and wrapping at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await harness(page);

      await page.goto('/checkout');
      await review(page);
      await page.getByRole('button', { name: /Place Order/ }).click();
      await expect(page.getByRole('heading', { name: 'Order Confirmed!' })).toBeVisible({ timeout: 15000 });

      const refCol = page.locator('div[class*="orderRefCol"]');
      const badges = page.locator('div[class*="orderBadges"]');
      await expect(refCol).toBeVisible();
      await expect(badges).toBeVisible();

      const refBox = await refCol.boundingBox();
      const badgesBox = await badges.boundingBox();
      expect(refBox).not.toBeNull();
      expect(badgesBox).not.toBeNull();

      if (width >= 768) {
        expect(badgesBox!.x).toBeGreaterThan(refBox!.x);
      }

      const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(hasHorizontalScroll).toBe(false);

      await page.screenshot({ path: `test-results/checkout/confirmation-badges-${width}.png` });
    });
  }

  test('Confirmation screen does not display Paid badge if payment is not paid (unconfirmed)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await harness(page);

    await page.route('**/api/orders/*/confirmation', async route => {
      return route.fulfill({
        json: {
          data: {
            orderReference: 'ORD-TEST-UNPAID',
            status: 'PENDING',
            paymentState: 'FAILED',
            deliveryMethod: 'STANDARD',
            createdAt: new Date().toISOString(),
            estimatedDeliveryStart: new Date().toISOString(),
            estimatedDeliveryEnd: new Date().toISOString(),
            shipping: {
              recipient: 'Test User',
              line1: '123 Main St',
              city: 'San Jose',
              state: 'CA',
              postalCode: '95112',
              country: 'United States',
              phone: '5551234567',
            },
            items: [],
            subtotal: '100.00',
            shippingCost: '0.00',
            total: '100.00',
          },
        },
      });
    });

    await page.goto('/checkout/confirmation/ORD-TEST-UNPAID');
    await expect(page.getByText('Order Received')).toBeVisible();
    await expect(page.getByText('Paid', { exact: true })).toHaveCount(0);
    await expect(page.locator('text="Processing"')).toHaveCount(0);
  });

  for (const width of viewports) {
    test(`Product UI has NO delete/deletion action at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route('**/api/products/apple-watch-series-9-41mm-gps-silver', route => route.fulfill({ json: mockProduct }));
      await page.route('**/api/products/apple-watch-series-9-41mm-gps-silver/reviews*', route => route.fulfill({ json: { data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } } }));
      await page.route('**/api/products?*', route => route.fulfill({
        json: {
          data: [mockProduct.data],
          meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      }));
      await page.route('**/api/search/products*', route => route.fulfill({
        json: {
          data: [mockProduct.data],
          meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      }));
      await page.route('**/api/categories*', route => route.fulfill({ json: { data: [] } }));
      await page.route('**/api/brands*', route => route.fulfill({ json: { data: [] } }));
      await page.route('**/api/cart', route => route.fulfill({ json: { data: { items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false } } }));
      await page.route('**/api/wishlist', route => route.fulfill({ json: { data: { items: [], totalItems: 0 } } }));

      // 1. Products Catalog Page
      await page.goto('/products');
      await expect(page.getByRole('heading', { name: 'All Products', level: 1 })).toBeVisible({ timeout: 15000 });

      // No delete button anywhere in product listing
      const deleteButtons = page.getByRole('button', { name: /delete|remove|trash/i });
      await expect(deleteButtons).toHaveCount(0);

      // Verify Add to Cart and Wishlist are intact
      await expect(page.getByRole('button', { name: /Add .* to cart/i }).first()).toBeVisible({ timeout: 15000 });
      await expect(page.locator('button[data-wishlist-heart]').first()).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[class*="reveal"][class*="item"]').first()).toHaveCSS('opacity', '1');
      await expect(page.locator('[data-testid="product-image-container"] img').first()).toBeVisible();
      await expect(page.locator('[data-testid="product-image-container"] img').first()).toHaveCSS('opacity', '1');

      await page.screenshot({ path: `test-results/checkout/product-catalog-${width}.png` });

      // 2. Product Details Page
      await page.goto('/products/apple-watch-series-9-41mm-gps-silver');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });

      // No delete button in purchase/product actions
      const detailDeleteButtons = page.locator('div[class*="cartActions"]').getByRole('button', { name: /delete|remove|trash/i });
      await expect(detailDeleteButtons).toHaveCount(0);

      // Add to Cart and Buy Now are intact
      await expect(page.getByRole('button', { name: 'Add to Cart' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Buy Now' })).toBeVisible();
      await expect(page.locator('[data-testid="product-image-container"] img').first()).toHaveCSS('opacity', '1');

      await page.screenshot({ path: `test-results/checkout/product-details-${width}.png` });
    });
  }

  test('Cart page retains legitimate item removal (Trash2)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await harness(page);
    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: 'Shopping Cart', level: 1 })).toBeVisible({ timeout: 15000 });

    const removeBtn = page.getByRole('button', { name: /Remove .* from cart/i }).first();
    await expect(removeBtn).toBeVisible();
  });

});
