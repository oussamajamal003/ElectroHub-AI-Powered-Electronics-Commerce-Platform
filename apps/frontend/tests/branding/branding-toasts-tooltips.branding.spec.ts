import { expect, test, type Page } from '@playwright/test';

const BRAND = 'ElectroHub — Electronics Commerce Platform';

/** Every API call is answered locally. Guests get 401 on session probes; the store profile is unavailable, so the default brand applies. */
async function offlineApi(page: Page, overrides: Record<string, (method: string) => { status: number; json: unknown }> = {}) {
  // Match the URL path, not a glob: `**/api/**` would also swallow Vite modules such as /src/features/auth/api/auth.ts.
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const url = new URL(route.request().url());
    const handler = overrides[url.pathname];
    if (handler) { const { status, json } = handler(route.request().method()); return route.fulfill({ status, json }); }
    if (url.pathname.startsWith('/api/auth/')) return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } } });
    return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'down' } } });
  });
}

test.describe('browser tab branding', () => {
  test.beforeEach(async ({ page }) => { await offlineApi(page); });

  test('serves the official favicon, not the Vite placeholder, from every route depth', async ({ page }) => {
    for (const path of ['/', '/contact', '/products/some-product', '/admin/login']) {
      await page.goto(path);
      const icons = await page.locator('head link[rel~="icon"], head link[rel="apple-touch-icon"]').evaluateAll(links =>
        links.map(link => ({ rel: link.getAttribute('rel'), href: (link as HTMLLinkElement).href, raw: link.getAttribute('href') })));
      expect(icons.length, path).toBeGreaterThanOrEqual(3);
      for (const icon of icons) {
        expect(icon.raw, `${path} ${icon.rel}`).toMatch(/^\//); // root-absolute: works at any URL depth
        expect(icon.href).not.toContain('vite.svg');
        const response = await page.request.get(icon.href);
        expect(response.status(), icon.href).toBe(200);
        expect(response.headers()['content-type'], icon.href).toMatch(/^image\//);
      }
    }
  });

  test('uses the brand as the default title and on every customer and admin route', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(new RegExp(`${BRAND}$`));
    for (const [path, heading] of [['/contact', "Let's talk"], ['/about', 'Technology made simple.']] as const) {
      await page.goto(path);
      await expect(page).toHaveTitle(`${heading} | ${BRAND}`);
    }
    await page.goto('/admin/login');
    await expect(page).toHaveTitle(`Admin Login | ${BRAND}`);
    await page.goto('/this-route-does-not-exist');
    await expect(page).toHaveTitle(`Page not found | ${BRAND}`);
  });

  test('keeps the title right across client-side navigation, back/forward and a hard refresh', async ({ page }) => {
    await page.goto('/contact');
    await expect(page).toHaveTitle(`Let's talk | ${BRAND}`);
    await page.getByRole('link', { name: 'About' }).first().click();
    await expect(page).toHaveTitle(`Technology made simple. | ${BRAND}`);
    await page.goBack();
    await expect(page).toHaveTitle(`Let's talk | ${BRAND}`);
    await page.goForward();
    await expect(page).toHaveTitle(`Technology made simple. | ${BRAND}`);
    await page.reload();
    await expect(page).toHaveTitle(`Technology made simple. | ${BRAND}`);
  });

  test('never puts a secret, token or personal data in the title', async ({ page }) => {
    await page.goto('/admin/activate#token=super-secret-token');
    await expect(page).toHaveTitle(`Activate Admin Account | ${BRAND}`);
    expect(await page.title()).not.toContain('super-secret-token');
  });
});

test.describe('toasts', () => {
  const fillContact = async (page: Page) => {
    await page.getByLabel('Name').fill('Sam Shopper');
    await page.getByLabel('Email').fill('sam@example.com');
    await page.getByLabel('Subject').fill('Order question');
    await page.getByRole('textbox', { name: 'Message' }).fill('Where is my order?');
  };
  const viewport = (page: Page) => page.getByTestId('toast-viewport');

  test('confirms success only after the server accepted it, announces politely, and can be dismissed', async ({ page }) => {
    let accepted!: () => void;
    const gate = new Promise<void>(resolve => { accepted = resolve; });
    await offlineApi(page);
    await page.route(url => url.pathname === '/api/store/contact', async route => { await gate; await route.fulfill({ status: 200, json: { data: { accepted: true } } }); });
    await page.goto('/contact');
    await fillContact(page);
    await page.getByRole('button', { name: 'Send Message' }).click();
    await expect(page.getByRole('button', { name: 'Sending…' })).toBeVisible();
    await expect(viewport(page).getByText('Message sent')).toHaveCount(0); // never before the response
    accepted();
    const toast = viewport(page).locator('[data-toast-variant="success"]');
    await expect(toast).toContainText('Message sent');
    // The inline status already announces the outcome, so the toast stays out of the live announcer.
    // (Radix also excludes its own close button, so target the wrapper that holds the message text.)
    await expect(toast.locator('div[data-radix-toast-announce-exclude]').filter({ hasText: 'Message sent' })).toHaveCount(1);
    await toast.getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(toast).toHaveCount(0);
  });

  // The Contact page owns its failure feedback inline, next to the Send button (its mutation is `silent`), so a failed send must
  // raise no toast at all. The global failure-toast variants and burst collapsing are covered by ToastCenter.test.tsx.
  test('explains a service failure inline (not a success, not a toast) and keeps the message', async ({ page }) => {
    await offlineApi(page, { '/api/store/contact': () => ({ status: 503, json: { error: { code: 'CONTACT_UNAVAILABLE', message: 'Contact delivery is temporarily unavailable.' } } }) });
    await page.goto('/contact');
    await fillContact(page);
    const send = page.getByRole('button', { name: 'Send Message' });
    await send.click();
    await expect(page.getByRole('alert').filter({ hasText: 'didn’t accept your message, so it was not sent' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('Where is my order?');
    await send.click(); await send.click();
    await expect(page.getByRole('alert').filter({ hasText: 'was not sent' })).toHaveCount(1);
    await expect(viewport(page).locator('[data-toast-variant]')).toHaveCount(0);
  });

  test('a rate limit tells the user to wait, inline', async ({ page }) => {
    await offlineApi(page, { '/api/store/contact': () => ({ status: 429, json: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } } }) });
    await page.goto('/contact');
    await fillContact(page);
    await page.getByRole('button', { name: 'Send Message' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Please wait a minute, then try again.' })).toBeVisible();
    await expect(viewport(page).locator('[data-toast-variant]')).toHaveCount(0);
  });

  test('stays inside the viewport and never steals focus or causes horizontal scroll', async ({ page }) => {
    await offlineApi(page, { '/api/store/contact': () => ({ status: 200, json: { data: { accepted: true } } }) });
    await page.goto('/contact');
    await fillContact(page);
    await page.getByRole('button', { name: 'Send Message' }).click();
    const toast = viewport(page).locator('[data-toast-variant]').first();
    await expect(toast).toBeVisible();
    // Measure at rest: the toast slides in from the right edge, so a mid-animation box is legitimately off-screen.
    await expect.poll(() => toast.evaluate(node => node.getAnimations().length)).toBe(0);
    const box = (await toast.boundingBox())!;
    const size = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    // The toast never takes focus.
    await expect(viewport(page).locator(':focus')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="toast-viewport"]') ?? null)).toBeNull();
  });

  test('respects prefers-reduced-motion', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await offlineApi(page, { '/api/store/contact': () => ({ status: 200, json: { data: { accepted: true } } }) });
    await page.goto('/contact');
    await fillContact(page);
    await page.getByRole('button', { name: 'Send Message' }).click();
    const toast = viewport(page).locator('[data-toast-variant="success"]');
    await expect(toast).toBeVisible();
    expect(await toast.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    await context.close();
  });
});

test.describe('tooltips', () => {
  test.beforeEach(async ({ page }) => { await offlineApi(page); await page.goto('/contact'); });

  test('opens on keyboard focus, describes the control, and closes on Escape', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'Hover/focus hints are a pointer and keyboard affordance');
    const cart = page.getByRole('link', { name: /^Cart/ }).first();
    await cart.focus();
    const tip = page.getByRole('tooltip').first();
    await expect(tip).toContainText('View shopping cart');
    await expect(cart).toHaveAttribute('aria-describedby', /.+/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('opens on pointer hover and stays inside the viewport', async ({ page, browserName, isMobile }) => {
    test.skip(isMobile === true, 'Hover/focus hints are a pointer and keyboard affordance');
    test.skip(browserName === 'webkit', 'Playwright WebKit hover timing differs from Safari; keyboard path covers WebKit');
    await page.getByRole('link', { name: /^Wishlist/ }).first().hover();
    const tip = page.getByRole('tooltip').first();
    await expect(tip).toContainText('View wishlist');
    const box = (await tip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  });

  test('every icon-only header control keeps its accessible name and has no duplicate native title', async ({ page }) => {
    const search = page.getByRole('button', { name: 'Search' }).first();
    await expect(search).toBeVisible();
    await expect(search).not.toHaveAttribute('title', /.+/);
    await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
  });
});
