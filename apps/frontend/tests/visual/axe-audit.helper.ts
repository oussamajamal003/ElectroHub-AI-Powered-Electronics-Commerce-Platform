import { createRequire } from 'node:module';
import { expect, type Page } from '@playwright/test';
import type axe from 'axe-core';

const require = createRequire(import.meta.url);

/** WCAG 2.0/2.1 A+AA scan, matching tests/quality/accessibility.quality.spec.ts: waits for entrance motion to settle first. */
export async function expectNoAxeViolations(page: Page, label: string, scope?: string) {
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation =>
    animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)).length), { timeout: 10_000 }).toBe(0);
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const result = await page.evaluate(async selector => {
    const engine = (window as unknown as { axe: typeof axe }).axe;
    const context = selector ? document.querySelector(selector) ?? document : document.querySelector('[role="dialog"], [role="menu"]') ?? document;
    return engine.run(context, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
  }, scope ?? null);
  expect(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target).slice(0, 5) })), label).toEqual([]);
}
