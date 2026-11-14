import { expect, test } from '@playwright/test';
import { apiOrigin, admins, distinctClientAddress, product, signInAdmin } from '../release/support';

test('record real API and route timings', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'Timing measurements use one fixed browser/environment.');
  await distinctClientAddress(page, info);
  const api: Record<string, number[]> = {};
  // Sequential, low-volume reads on the disposable database. No provider or financial mutations.
  for (const endpoint of ['/api/products?page=1&pageSize=12', '/api/search/products?q=aurora', '/api/recommendations/popular']) {
    api[endpoint] = [];
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now();
      const response = await request.get(`${apiOrigin}${endpoint}`);
      expect(response.ok(), `${endpoint}: ${response.status()}`).toBe(true);
      await response.body();
      api[endpoint].push(Math.round(performance.now() - start));
    }
  }
  const routes = [];
  await page.addInitScript(() => {
    const metrics = { lcpMs: 0, cls: 0 };
    (window as unknown as { qualityMetrics: typeof metrics }).qualityMetrics = metrics;
    new PerformanceObserver(list => { for (const entry of list.getEntries()) metrics.lcpMs = entry.startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
        if (!shift.hadRecentInput) metrics.cls += shift.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  for (const url of ['/', `/products/${product('REL-AURORA-HP').slug}`, '/admin']) {
    if (url === '/admin') await signInAdmin(page, admins(info).ownerEmail);
    const start = performance.now();
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const readyMs = Math.round(performance.now() - start);
    await page.waitForLoadState('networkidle');
    const timing = await page.evaluate(() => ({
      metrics: (window as unknown as { qualityMetrics: { lcpMs: number; cls: number } }).qualityMetrics,
      navigation: performance.getEntriesByType('navigation').map(entry => entry.toJSON()),
      paint: performance.getEntriesByType('paint').map(entry => entry.toJSON()),
      resources: performance.getEntriesByType('resource').map(entry => {
        const resource = entry as PerformanceResourceTiming;
        return { name: new URL(resource.name).pathname, duration: Math.round(resource.duration), transferSize: resource.transferSize };
      }),
    }));
    routes.push({ url, readyMs, ...timing });
  }
  await info.attach('performance.json', { body: JSON.stringify({ environment: 'Playwright real stack, local loopback, unthrottled; see run command for Vite dev/preview mode', api, routes }, null, 2), contentType: 'application/json' });
});
