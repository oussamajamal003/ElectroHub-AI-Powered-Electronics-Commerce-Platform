import { expect, test } from '@playwright/test';
import { harness, review, fillCard } from './stripe.harness';
import { cart } from '../../src/features/checkout/fixtures';

const viewports = [390, 768, 1440, 1920];

test.describe('Payment Recovery Loading & Terminal Failure UX', () => {

  for (const width of viewports) {
    test(`Processing / recovery loading state at ${width}px has centered animated loader and ZERO action buttons`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const api = await harness(page);
      api.hold();

      await page.goto('/checkout');
      await review(page);
      await page.getByRole('button', { name: /Place Order/ }).click();

      // 1. Verify animated loading screen
      const heading = page.getByRole('heading', { name: 'Processing your order…' });
      await expect(heading).toBeVisible();

      // 2. Verify ZERO action buttons inside processing section
      const processingSection = page.locator('section[aria-labelledby="processing-heading"]');
      await expect(processingSection).toBeVisible();
      await expect(processingSection.getByRole('button')).toHaveCount(0);
      await expect(processingSection.getByRole('link')).toHaveCount(0);

      // 3. Verify specific action controls are absent
      await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Check payment status' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Return to Cart' })).toHaveCount(0);

      // 4. Verify centered layout
      const box = await processingSection.boundingBox();
      expect(box).not.toBeNull();
      const centerX = box!.x + box!.width / 2;
      expect(Math.abs(centerX - width / 2)).toBeLessThan(width * 0.1);

      await page.screenshot({ path: `test-results/checkout/payment-processing-${width}.png` });
      api.release();
    });
  }

  for (const width of viewports) {
    test(`Slow reconciliation shows Stage 2 Checking your payment at ${width}px with progress feedback and no payment actions`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      // Harness configured with an unresolved outcome so the settled Place Order moves to Stage 2 verification.
      await harness(page, { state: 'CAPTURE_PENDING' });

      await page.goto('/checkout');
      await review(page);
      await page.getByRole('button', { name: /Place Order/ }).click();

      // Approved Stage 2 verification view (replaces the former recovery panel).
      const recoverySection = page.locator('section[aria-labelledby="checking-heading"]');
      await expect(recoverySection).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();

      // Animated verification indicator is present.
      await expect(recoverySection.locator('[class*="checkingVisual"]')).toBeVisible();

      // No payment action of any kind; the only control is safe navigation away.
      await expect(recoverySection.getByRole('button')).toHaveCount(0);
      await expect(recoverySection.getByRole('link')).toHaveCount(1);
      await expect(recoverySection.getByRole('link', { name: 'Continue shopping' })).toHaveAttribute('href', '/products');

      // Verify specific checkout action controls are completely absent
      await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Check payment status' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Return to Cart' })).toHaveCount(0);

      // Verify accessible status role on the verification copy
      const statusElement = recoverySection.getByRole('status');
      await expect(statusElement).toBeVisible();

      await page.screenshot({ path: `test-results/checkout/payment-recovery-loading-${width}.png` });
    });
  }

  for (const width of viewports) {
    test(`Confirmed DECLINED failure screen at ${width}px has failure icon, notice, and TWO enabled working buttons`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await harness(page, { state: 'DECLINED' });

      await page.goto('/checkout');
      await review(page);
      await page.getByRole('button', { name: /Place Order/ }).click();

      // 1. Verify failure heading and text
      const heading = page.getByRole('heading', { name: 'Payment Failed' });
      await expect(heading).toBeVisible();
      await expect(page.locator('div[class*="failureIcon"]')).toBeVisible();
      await expect(page.locator('div[class*="failureNotice"]')).toBeVisible();
      await expect(page.getByText('Your payment was declined. Please check your card details or try a different card.')).toBeVisible();
      await expect(page.getByText('Payment not processed')).toBeVisible();
      await expect(page.getByText('Your purchase has been preserved. You can try again or use another card.')).toBeVisible();

      // 2. Verify TWO enabled action buttons
      const tryAgainBtn = page.getByRole('button', { name: 'Try Again' });
      const returnCartLink = page.getByRole('link', { name: 'Return to Cart' });

      await expect(tryAgainBtn).toBeVisible();
      await expect(tryAgainBtn).toBeEnabled();
      await expect(returnCartLink).toBeVisible();
      await expect(page.getByRole('button', { name: 'Check payment status' })).toHaveCount(0);

      await page.screenshot({ path: `test-results/checkout/payment-declined-${width}.png` });
    });
  }

  test('Confirmed AWAITING_INPUT failure screen displays "Payment needs a different card" with TWO enabled buttons', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await harness(page, { state: 'AWAITING_INPUT' });

    await page.goto('/checkout');
    await review(page);
    await page.getByRole('button', { name: /Place Order/ }).click();

    // 1. Verify heading and notice
    const heading = page.getByRole('heading', { name: 'Payment needs a different card' });
    await expect(heading).toBeVisible();
    await expect(page.getByText('Payment not processed')).toBeVisible();
    await expect(page.getByText('Your payment was not completed. Return to secure card entry to try another card.')).toBeVisible();

    // 2. Verify TWO enabled action buttons
    const tryAgainBtn = page.getByRole('button', { name: 'Try Again' });
    const returnCartLink = page.getByRole('link', { name: 'Return to Cart' });

    await expect(tryAgainBtn).toBeVisible();
    await expect(tryAgainBtn).toBeEnabled();
    await expect(returnCartLink).toBeVisible();

    await page.screenshot({ path: 'test-results/checkout/payment-awaiting-input-1440.png' });
  });

  test('Try Again returns to Payment step, mounts usable Payment Element, and Review Order works', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await harness(page, { state: 'DECLINED' });

    await page.goto('/checkout');
    await review(page);
    await page.getByRole('button', { name: /Place Order/ }).click();

    const tryAgainBtn = page.getByRole('button', { name: 'Try Again' });
    await expect(tryAgainBtn).toBeVisible();
    await tryAgainBtn.click();

    // Returns to Payment step with mounted card entry
    await expect(page.locator('iframe[title*="Mock hosted card entry"]')).toBeVisible({ timeout: 10000 });

    // Enters card and Review Order works
    await fillCard(page);
    const reviewOrderBtn = page.getByRole('button', { name: 'Review Order' });
    await expect(reviewOrderBtn).toBeEnabled();
    await reviewOrderBtn.click();

    await expect(page.getByRole('heading', { name: 'Review Your Order' })).toBeVisible({ timeout: 10000 });
  });

  test('Return to Cart keeps submitted A out of the active Cart, and a new Cart B checkout opens fresh Shipping with ZERO stale failure frames', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await harness(page, { state: 'DECLINED' });

    await page.goto('/checkout');
    await review(page);
    await page.getByRole('button', { name: /Place Order/ }).click();

    const returnCartLink = page.getByRole('link', { name: 'Return to Cart' });
    await expect(returnCartLink).toBeVisible();
    await returnCartLink.click();

    // Lands on Cart
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();

    // Submitted Purchase A is no longer in the active Cart (approved contract).
    await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toHaveCount(0);
    // The customer builds an independent Cart B.
    await page.route('**/api/cart', route => route.fulfill({ json: { data: cart } }));
    await page.reload();
    const proceedBtn = page.getByRole('button', { name: 'Proceed to Checkout' });
    await expect(proceedBtn).toBeVisible();
    // Observe inserted terminal headings, not just the eventual Shipping state.
    // Retain records even if React removes a stale heading in the same turn.
    await page.evaluate(() => {
      const terminalFrames: string[] = [];
      const observer = new MutationObserver(records => {
        if (window.location.pathname !== '/checkout') return;
        for (const record of records) for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const headings = [...node.querySelectorAll('h1,h2,h3')];
          if (node.matches('h1,h2,h3')) headings.push(node);
          for (const heading of headings) {
            const text = heading.textContent?.trim();
            if (text === 'Payment Failed' || text === 'Order Confirmed!') terminalFrames.push(text);
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      Reflect.set(window, '__freshCheckoutTerminalFrames', terminalFrames);
      Reflect.set(window, '__freshCheckoutObserver', observer);
    });
    await proceedBtn.click();

    // Opens fresh at Shipping Information without any failure banner/flash
    await expect(page.getByRole('heading', { name: 'Shipping Information' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payment Failed' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Checking your payment|We couldn’t confirm your payment yet/ })).toHaveCount(0);
    expect(await page.evaluate(() => {
      Reflect.get(window, '__freshCheckoutObserver').disconnect();
      return Reflect.get(window, '__freshCheckoutTerminalFrames');
    })).toEqual([]);
  });

});
