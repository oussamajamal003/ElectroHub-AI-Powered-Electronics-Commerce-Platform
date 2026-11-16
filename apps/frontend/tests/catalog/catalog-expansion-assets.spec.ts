import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

type Asset = { path: string; width: number; height: number };

test('all 166 expansion assets return 200 and decode at their reviewed dimensions', async ({ page, request }) => {
  test.setTimeout(120_000);
  const manifest = JSON.parse(readFileSync(path.resolve('../backend/prisma/data/catalog-expansion-media.json'), 'utf8')) as { assets: Asset[] };
  expect(manifest.assets).toHaveLength(166);
  expect(new Set(manifest.assets.map(asset => asset.path)).size).toBe(166);
  // An image document supplies the real local origin without requiring a running commerce API.
  await page.goto(manifest.assets[0].path);
  for (let offset = 0; offset < manifest.assets.length; offset += 8) {
    const assets = manifest.assets.slice(offset, offset + 8);
    for (const asset of assets) {
      const response = await request.get(asset.path);
      expect(response.status(), asset.path).toBe(200);
      expect(response.headers()['content-type'], asset.path).toMatch(/^image\//);
    }
    const decoded = await page.evaluate(async entries => Promise.all(entries.map(async asset => {
      const image = new Image();
      image.src = asset.path;
      await image.decode();
      const result = { path: asset.path, width: image.naturalWidth, height: image.naturalHeight };
      image.removeAttribute('src');
      return result;
    })), assets);
    for (const actual of decoded) {
      const reviewed = assets.find(asset => asset.path === actual.path)!;
      expect(actual.width, actual.path).toBe(reviewed.width);
      expect(actual.height, actual.path).toBe(reviewed.height);
    }
  }
});
