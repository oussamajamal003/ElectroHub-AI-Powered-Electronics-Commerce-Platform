import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { distinctClientAddress, product } from './support';

/**
 * Real visual-similarity ranking, end to end in the browser: storefront → Express → FastAPI (SigLIP2 encoder) → pgvector.
 * Runs only when RELEASE_E2E_AI=1, against a release stack whose backend has AI_SERVICE_* set and whose disposable database
 * holds an active index of the release products' catalog photos (procedure: docs/08_Quality/E2E.md, "AI similarity run").
 * The regular release run and CI have no AI service and skip it; image-search.release.spec.ts covers that path.
 *
 * The query photos are catalog photos that are NOT indexed for any release product, so a match proves similarity, not identity.
 */
const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/images/catalog/variety');
const photo = (file: string) => ({ name: file, mimeType: 'image/jpeg', buffer: readFileSync(path.join(publicRoot, file)) });

test.describe('image search with the AI service', () => {
  test.skip(process.env.RELEASE_E2E_AI !== '1', 'needs the local AI service and an indexed release catalog (RELEASE_E2E_AI=1)');
  test.beforeEach(async ({ page }, testInfo) => { await distinctClientAddress(page, testInfo); });

  for (const [query, expected, excluded] of [
    ['headphones-01.jpg', ['REL-AURORA-HP', 'REL-PULSE-EB'], ['REL-NIMBUS-14', 'REL-VECTOR-16', 'REL-ATLAS-DOCK']],
    ['laptop-generic-01.jpg', ['REL-NIMBUS-14'], ['REL-AURORA-HP', 'REL-PULSE-EB']],
  ] as const) {
    test(`an unseen ${query} photo is answered with visually similar products only`, async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Search ElectroHub' });
      await dialog.getByRole('button', { name: 'Search by image' }).click();
      await dialog.getByLabel('Choose a photo').setInputFiles(photo(query));
      const response = page.waitForResponse(res => res.url().includes('/api/search/image'));
      await dialog.getByRole('button', { name: 'Search similar products' }).click();
      expect((await response).status()).toBe(200);

      const results = dialog.getByRole('region', { name: 'Visually similar products' });
      await expect(results).toBeVisible({ timeout: 30_000 });
      for (const sku of expected) await expect(results.getByRole('link', { name: new RegExp(product(sku).name) })).toBeVisible();
      for (const sku of excluded) await expect(results.getByRole('link', { name: new RegExp(product(sku).name) })).toHaveCount(0);
      // The best match is ranked first.
      await expect(results.getByRole('listitem').first()).toContainText(product(expected[0]).name);
    });
  }
});
