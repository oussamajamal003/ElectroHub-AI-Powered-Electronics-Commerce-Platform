import { chromium } from '@playwright/test';

const base = process.env.ELECTROHUB_LOCAL_URL ?? 'http://127.0.0.1:3101';
const browser = await chromium.launch({ headless: true });
const samples = [];

async function measure(path) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const requests = [];
  const byRequest = new WeakMap();
  const started = performance.now();
  page.on('request', request => {
    if (/\/api\/(search\/products|products(?:\/deals)?|categories)(?:\?|$)/.test(request.url())) {
      const entry = { url: new URL(request.url()).pathname + new URL(request.url()).search, method: request.method(), start: Math.round(performance.now() - started) };
      requests.push(entry);
      byRequest.set(request, entry);
    }
  });
  page.on('response', response => {
    const entry = byRequest.get(response.request());
    if (entry) entry.status = response.status();
  });
  page.on('requestfailed', request => {
    const entry = byRequest.get(request);
    if (entry) entry.failure = request.failure()?.errorText;
  });
  page.on('requestfinished', request => {
    const entry = byRequest.get(request);
    if (entry) entry.end = Math.round(performance.now() - started);
  });
  await page.addInitScript(() => {
    window.__loadTrace = {};
    const trace = window.__loadTrace;
    const inspect = () => {
      const now = Math.round(performance.now());
      const selectors = {
        products: 'section[aria-label="Search results"]',
        deals: 'section[aria-labelledby="deals-title"]',
        arrivals: 'section[aria-labelledby="new-arrivals-title"]',
        categories: 'section[aria-labelledby="categories-title"]',
      };
      for (const [name, selector] of Object.entries(selectors)) {
        const section = document.querySelector(selector);
        if (!section) continue;
        const state = trace[name] ??= {};
        if (!state.mounted) state.mounted = now;
        if (!state.skeleton && section.querySelector('[role="status"][aria-label^="Loading"] , [aria-hidden="true"] [data-testid="product-card-skeleton"]')) state.skeleton = now;
        if (!state.cards && section.querySelector('[data-testid="product-card"], a[href^="/products?category="]')) state.cards = now;
        if (state.cards && !state.firstImage && section.querySelector('[data-testid="product-card"] img.loaded, a[href^="/products?category="] img[complete]')) state.firstImage = now;
      }
    };
    new MutationObserver(inspect).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('DOMContentLoaded', inspect);
  });
  await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  if (path === '/') {
    await page.waitForFunction(() => ['deals', 'arrivals', 'categories'].every(key => window.__loadTrace[key]?.cards), null, { timeout: 60_000 });
  } else {
    await page.waitForFunction(() => window.__loadTrace.products?.cards, null, { timeout: 60_000 });
  }
  await page.waitForTimeout(300);
  const trace = await page.evaluate(() => ({
    dom: window.__loadTrace,
    resources: performance.getEntriesByType('resource').filter(entry => /\/api\/(search\/products|products(?:\/deals)?|categories)(?:\?|$)/.test(entry.name))
      .map(entry => ({ url: new URL(entry.name).pathname + new URL(entry.name).search, start: Math.round(entry.startTime), response: Math.round(entry.responseEnd) })),
    image: (() => { const image = document.querySelector('[data-testid="product-card"] img'); return image ? { complete: image.complete, naturalWidth: image.naturalWidth } : null; })(),
  }));
  const sample = { path, requests, ...trace };
  samples.push(sample);
  console.log(JSON.stringify(sample));
  await context.close();
}

async function measureCachedReturn() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const urls = [];
  page.on('request', request => { if (request.url().includes('/api/search/products')) urls.push(request.url()); });
  await page.goto(base + '/products?page=1', { waitUntil: 'domcontentloaded' });
  const first = page.locator('[data-testid="product-card"] h3').first();
  await first.waitFor({ timeout: 60_000 });
  const firstTitle = await first.innerText();
  await page.getByRole('button', { name: 'Go to page 2' }).click();
  await page.waitForURL(/page=2/);
  await page.waitForFunction(title => document.querySelector('[data-testid="product-card"] h3')?.textContent !== title,
    firstTitle, { timeout: 60_000 });
  const beforeBack = urls.length;
  const started = performance.now();
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(title => document.querySelector('[data-testid="product-card"] h3')?.textContent === title,
    firstTitle, { timeout: 10_000 });
  console.log(JSON.stringify({ cachedPageOneMs: Math.round(performance.now() - started),
    requestsOnReturn: urls.length - beforeBack, totalProductRequests: urls.length }));
  await context.close();
}

try {
  if (process.env.CACHE_ONLY === '1') await measureCachedReturn();
  else {
    await measure('/products?page=1');
    await measure('/products?page=2');
    await measure('/');
  }
} finally {
  await browser.close();
}
