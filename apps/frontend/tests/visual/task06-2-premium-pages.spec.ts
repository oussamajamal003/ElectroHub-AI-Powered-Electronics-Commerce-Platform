import { createRequire } from 'node:module';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type axe from 'axe-core';
import { product, storeProfile, world } from './task06-2-world.helper';

/**
 * Task 06.2 WP A/B/C visual QA: About, Contact and Product Details at 320/390/768/1024/1440/1920 in light and dark OS schemes.
 * Every API call is intercepted (guest world), so nothing touches a shared database or sends email.
 * The storefront is light-only (compile-time SCSS colours, no prefers-color-scheme rules); the dark runs prove the pages stay
 * legible and unchanged under a dark OS preference rather than claiming a dark theme exists.
 */
const require = createRequire(import.meta.url);
const WIDTHS = [320, 390, 768, 1024, 1440, 1920] as const;
const SCHEMES = ['light', 'dark'] as const;
const finiteRunning = (page: Page) => page.evaluate(() => document.getAnimations().filter(animation =>
  animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)).length);
const evidence = (name: string) => `test-results/task06-2-evidence/${name}.png`;

/** Scrolls the page in viewport-sized steps; at each step waits (bounded) for images in view to decode. Returns to the top. */
async function scrollThrough(page: Page, onStep?: () => Promise<void>) {
  const step = await page.evaluate(() => Math.max(200, Math.round(window.innerHeight * 0.6)));
  const height = () => page.evaluate(() => document.documentElement.scrollHeight);
  // The height is re-read every step: lazy images grow the page while it is scrolled, and the last sections must be reached.
  for (let y = 0; y <= await height(); y += step) {
    await page.evaluate(async top => {
      // Instant: the storefront sets smooth scroll-behavior, and a smooth scroll would be interrupted by the next step.
      window.scrollTo({ top, left: 0, behavior: 'instant' });
      const inView = [...document.images].filter(image => {
        const box = image.getBoundingClientRect();
        return box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
      });
      await Promise.race([Promise.allSettled(inView.map(image => image.decode())), new Promise(resolve => setTimeout(resolve, 2_000))]);
      // Let two frames render at this position so IntersectionObserver-driven reveals see the section before the next jump.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, y);
    if (onStep) await onStep();
  }
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
}

async function settle(page: Page) {
  // One pass loads lazy images and fires the one-shot reveals; then every finite animation must finish before measuring.
  await scrollThrough(page);
  await expect.poll(() => finiteRunning(page), { timeout: 15_000 }).toBe(0);
  // Evidence must show the content: no heading in <main> may still sit inside a hidden (opacity < 1) reveal wrapper.
  await expect.poll(() => hiddenHeadings(page), { timeout: 5_000 }).toEqual([]);
}

const hiddenHeadings = (page: Page) => page.evaluate(() => [...document.querySelectorAll('main h1, main h2, main h3')]
  .filter(heading => {
    for (let element: Element | null = heading; element; element = element.parentElement) if (getComputedStyle(element).opacity !== '1') return true;
    return false;
  }).map(heading => heading.textContent?.trim() ?? ''));

async function audit(page: Page, info: TestInfo, label: string) {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const result = await page.evaluate(async () => (window as unknown as { axe: typeof axe }).axe.run(document,
    { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }));
  await info.attach(`${label}-axe.json`, { body: JSON.stringify(result.violations), contentType: 'application/json' });
  expect.soft(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), label).toEqual([]);
}

async function noHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect.soft(overflow, `${label} horizontal overflow`).toBeLessThanOrEqual(0);
}

const pages = [
  { name: 'about', path: '/about', ready: (page: Page) => expect(page.getByRole('heading', { level: 1, name: 'Technology made simple.' })).toBeVisible() },
  { name: 'contact', path: '/contact', ready: (page: Page) => expect(page.getByRole('link', { name: storeProfile.supportEmail })).toBeVisible() },
  { name: 'pdp', path: `/products/${product.slug}`, ready: (page: Page) => expect(page.getByRole('heading', { level: 2, name: 'Product Description' })).toBeVisible() },
] as const;

for (const scheme of SCHEMES) {
  for (const target of pages) {
    test(`${target.name} renders without overflow or axe violations at every width (${scheme})`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await world(page);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        await page.goto(target.path);
        await target.ready(page);
        await settle(page);
        const label = `${target.name}-${width}-${scheme}`;
        await noHorizontalOverflow(page, label);
        await audit(page, info, label);
        await page.screenshot({ path: evidence(label), fullPage: true });
      }
    });
  }
}

test('dark OS preference leaves the light-only storefront unchanged (documented contradiction)', async ({ page }) => {
  await world(page);
  const colours = async (scheme: 'light' | 'dark') => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/contact');
    await expect(page.getByRole('link', { name: storeProfile.supportEmail })).toBeVisible();
    return page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.body).color,
      scheme: matchMedia('(prefers-color-scheme: dark)').matches }));
  };
  const light = await colours('light');
  const dark = await colours('dark');
  expect(dark.scheme).toBe(true);
  expect(light.scheme).toBe(false);
  expect(dark.body).toBe(light.body);
  expect(dark.text).toBe(light.text);
});

test('Contact shows a polished empty state when no contact methods are configured', async ({ page }, info) => {
  await world(page, { overrides: async (path, route) => {
    if (path !== '/api/store/profile') return false;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...storeProfile,
      supportEmail: null, supportPhone: null, addressLine1: null, addressLine2: null, city: null, region: null, postalCode: null, country: null } }) });
    return true;
  } });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/contact');
    await expect(page.getByRole('heading', { name: 'Send us a message' })).toBeVisible();
    await expect(page.getByRole('link', { name: /@/ })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    await settle(page);
    await audit(page, info, `contact-empty-${width}`);
    await page.screenshot({ path: evidence(`contact-empty-${width}`), fullPage: true });
  }
});

test('Contact intro sits directly under the heading with no empty gap', async ({ page }) => {
  await world(page);
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/contact');
    const heading = page.getByRole('heading', { name: 'Contact Information' });
    await expect(heading).toBeVisible();
    const intro = page.getByText('We’re here to help.', { exact: false });
    const [headingBox, introBox] = [await heading.boundingBox(), await intro.boundingBox()];
    expect(headingBox && introBox).toBeTruthy();
    const gap = introBox!.y - (headingBox!.y + headingBox!.height);
    expect(gap, `gap at ${width}`).toBeGreaterThanOrEqual(0);
    expect(gap, `gap at ${width}`).toBeLessThanOrEqual(32);
  }
});

test('Product Details reviews tab shows the summary, distribution and review placeholder', async ({ page }, info) => {
  await world(page);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/products/${product.slug}#reviews`);
    const summary = page.getByTestId('review-summary');
    await expect(summary).toBeVisible({ timeout: 20_000 });
    await expect(summary.getByText('4.5', { exact: true })).toBeVisible();
    await expect(summary.getByText('Based on 6 reviews')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Rating distribution' }).getByRole('listitem')).toHaveCount(5);
    await expect(page.getByText('5 stars: 3 reviews, 50%')).toBeAttached();
    await settle(page);
    await summary.scrollIntoViewIfNeeded();
    await audit(page, info, `pdp-reviews-${width}`);
    await page.screenshot({ path: evidence(`pdp-reviews-${width}`), fullPage: true });
  }
  // The description tab: stored paragraphs only, "at a glance" facts from the product record.
  await page.goto(`/products/${product.slug}`);
  const glance = page.getByRole('complementary', { name: 'At a glance' });
  await expect(glance.getByText(product.sku, { exact: true })).toBeVisible();
  await expect(glance.getByText('4 more in the Specifications tab.')).toBeHidden();
  await expect(glance.getByText('8 more in the Specifications tab.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Product Description' }).getByText('Up to 29 hours of video playback.')).toBeVisible();
});

test('About reveals sections once: scrolling back up and down does not replay the motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await world(page);
  // Count every CSS animation that starts (finished animations are not reported by getAnimations()).
  await page.addInitScript(() => {
    (window as unknown as { __animationStarts: number }).__animationStarts = 0;
    document.addEventListener('animationstart', () => { (window as unknown as { __animationStarts: number }).__animationStarts += 1; }, true);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/about');
  await expect(page.getByRole('heading', { level: 1, name: 'Technology made simple.' })).toBeVisible();
  // First pass: every section enters the viewport once and plays its entrance.
  await scrollThrough(page);
  await expect.poll(() => finiteRunning(page), { timeout: 15_000 }).toBe(0);
  const animated = () => page.evaluate(() => (window as unknown as { __animationStarts: number }).__animationStarts);
  const afterFirstPass = await animated();
  expect(afterFirstPass, 'the first pass must actually animate something').toBeGreaterThan(0);
  // Second pass, down from the top: no section may start (or restart) a keyframe reveal, at any scroll position. CSS
  // transitions (the sticky header's compact state) and the infinite ambient CTA pulse are not reveals and are excluded.
  await scrollThrough(page, async () => {
    expect(await page.evaluate(() => document.getAnimations().filter(animation => animation instanceof CSSAnimation
      && animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => (animation as CSSAnimation).animationName))).toEqual([]);
  });
  expect(await animated()).toBe(afterFirstPass);
});

test('About honours reduced motion: content is visible without scroll-triggered animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await world(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/about');
  await expect(page.getByRole('heading', { level: 1, name: 'Technology made simple.' })).toBeVisible();
  const cta = page.getByRole('heading', { name: 'Find your next upgrade' });
  expect(await cta.evaluate(node => {
    for (let element: Element | null = node; element; element = element.parentElement) if (getComputedStyle(element).opacity !== '1') return false;
    return true;
  })).toBe(true);
  expect(await finiteRunning(page)).toBe(0);
});
