import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './axe-audit.helper';

const configured = { storeName: 'Northstar Electronics', supportEmail: 'help@example.test', supportPhone: '+1 555 010 0100', addressLine1: '1 Main St', addressLine2: null,
  city: 'Boston', region: 'MA', postalCode: '02110', country: 'US', businessHours: 'Monday–Friday, 9:00 AM–6:00 PM', currency: 'USD' };
const unconfigured = { ...configured, supportEmail: null, supportPhone: null, addressLine1: null, city: null, region: null, postalCode: null, country: null, businessHours: null };

async function stub(page: Page, profile: object, contact: (body: Record<string, unknown>, count: number) => { status: number; body: object } | Promise<{ status: number; body: object }> = () => ({ status: 202, body: { data: { accepted: true } } })) {
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/auth/customer/refresh', route => route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' } } }));
  await page.route('**/api/store/profile', route => route.fulfill({ json: { data: profile } }));
  await page.route('**/api/store/contact', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sent.push(body);
    const reply = await contact(body, sent.length);
    await route.fulfill({ status: reply.status, json: reply.body });
  });
  return sent;
}
const fill = async (page: Page, message = 'Hello, I have a question about an order.') => {
  await page.getByLabel('Name').fill('Demo User');
  await page.getByLabel('Email').fill('demo@example.com');
  await page.getByLabel('Subject').fill('Question');
  await page.getByLabel('Message').fill(message);
};

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`Contact page at ${width}px: configured details, validation, send, no overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const sent = await stub(page, configured);
    await page.goto('/contact', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: "Let's talk" })).toBeVisible();
    await expect(page.getByRole('link', { name: 'help@example.test' })).toHaveAttribute('href', 'mailto:help@example.test');
    await expect(page.getByText('Monday–Friday, 9:00 AM–6:00 PM')).toBeVisible();
    await page.getByRole('button', { name: 'Send Message' }).click();
    await expect(page.getByText('Name is required.')).toBeVisible();
    await expect(page.getByLabel('Name')).toBeFocused();
    await fill(page);
    await page.getByRole('button', { name: 'Send Message' }).click();
    await expect(page.getByRole('status')).toContainText('Your message has been sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ name: 'Demo User', email: 'demo@example.com', website: '' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/motion-contact/contact-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });

  test(`About page at ${width}px: content, links and no overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await stub(page, configured);
    await page.goto('/about', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Technology made simple.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Smarter shopping, assisted by AI' })).toBeAttached();
    await expect(page.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact');
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 600) { await page.evaluate(p => window.scrollTo(0, p), y); await page.waitForTimeout(60); }
    await page.waitForTimeout(700);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/motion-contact/about-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.getByRole('link', { name: 'Contact us' }).click();
    await expect(page).toHaveURL(/\/contact$/);
  });
}

test('Contact page shows no invented details when nothing is configured', async ({ page }) => {
  await stub(page, unconfigured);
  await page.goto('/contact', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/have not been published yet/i)).toBeVisible();
  await expect(page.locator('a[href^="mailto:"], a[href^="tel:"]')).toHaveCount(0);
  await expect(page.getByText(/support@example\.com|XX XXX|Street, City/)).toHaveCount(0);
});

test('Contact submission: pending state blocks a second send, then failure, rate limit and recovery are reported honestly', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const sent = await stub(page, configured, async (_body, count) => {
    if (count === 1) { await gate; return { status: 503, body: { error: { code: 'CONTACT_UNAVAILABLE', message: 'Contact delivery is temporarily unavailable.' } } }; }
    if (count === 2) return { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Too many messages. Please try again shortly.' } } };
    return { status: 202, body: { data: { accepted: true } } };
  });
  await page.goto('/contact', { waitUntil: 'domcontentloaded' });
  await fill(page);
  const send = page.getByRole('button', { name: /Send Message|Sending/ });
  await send.click();
  await expect(page.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  await page.getByRole('button', { name: 'Sending…' }).click({ force: true }).catch(() => undefined);
  release();
  await expect(page.getByRole('alert')).toContainText(/temporarily unavailable|Something went wrong/);
  await expect(page.getByText('Your message has been sent')).toHaveCount(0);
  expect(sent).toHaveLength(1);                                   // the pending click did not send twice
  expect(await page.getByLabel('Message').inputValue()).toContain('Hello');   // nothing the visitor typed was lost
  await page.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.getByRole('alert')).toContainText(/Too many messages|Something went wrong|could not send/);
  await page.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.getByRole('status')).toContainText('Your message has been sent');
  expect(sent).toHaveLength(3);
});

test('Contact form is keyboard operable with visible focus', async ({ page }) => {
  await stub(page, configured);
  await page.goto('/contact', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Name').focus();
  for (const label of ['Email', 'Subject', 'Message']) {
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(label)).toBeFocused();
    expect(await page.getByLabel(label).evaluate(el => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none')).toBe(true);
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Send Message' })).toBeFocused();   // the honeypot is skipped
});

test('axe WCAG 2.1 AA: Contact (configured, empty, with validation errors) and About', async ({ page }) => {
  await stub(page, configured);
  await page.goto('/contact', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'help@example.test' })).toBeVisible();
  await expectNoAxeViolations(page, 'contact-configured');
  await page.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.getByText('Name is required.')).toBeVisible();
  await expectNoAxeViolations(page, 'contact-errors');
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) { await page.evaluate(p => window.scrollTo(0, p), y); await page.waitForTimeout(60); }
  await expectNoAxeViolations(page, 'about');
});

test('axe WCAG 2.1 AA: Contact with nothing configured', async ({ page }) => {
  await stub(page, unconfigured);
  await page.goto('/contact', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/have not been published yet/i)).toBeVisible();
  await expectNoAxeViolations(page, 'contact-empty');
});
