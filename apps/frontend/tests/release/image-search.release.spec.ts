import { deflateSync } from 'node:zlib';
import { expect, test, type Page, type Request } from '@playwright/test';
import { distinctClientAddress, expectNoHorizontalOverflow } from './support';

/**
 * Image search on the hermetic release stack. No AI service is configured here (AI_SERVICE_URL is unset), so similarity
 * ranking itself is NOT exercised: the AI ranking is covered by the FastAPI pytest suite and the Express gateway tests. This
 * spec proves the user-facing contract around it: client-side file validation, and a truthful outcome that never pretends
 * results exist. When the build has image search switched off (VITE_IMAGE_SEARCH_ENABLED unset) the photo must never leave
 * the browser; when it is switched on, the gateway must answer "unavailable" and the UI must say so.
 */

/** A real, decodable 48×48 PNG with a varied pattern (not a blank image), built without any image dependency. */
function samplePng(): Buffer {
  const size = 48;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes: Buffer) => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const rows: number[] = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) rows.push((x * 5) % 256, (y * 5) % 256, ((x + y) * 3 + 90) % 256);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
}

async function openImageSearch(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search ElectroHub' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Search by image' }).click();
  await expect(dialog.getByRole('heading', { name: 'Search with a photo' })).toBeVisible();
  return dialog;
}

test.describe('image search', () => {
  test.beforeEach(async ({ page }, testInfo) => { await distinctClientAddress(page, testInfo); });

  test('@responsive unsupported and empty files are refused in the browser without any upload', async ({ page }) => {
    const uploads: Request[] = [];
    page.on('request', request => { if (request.url().includes('/api/search/image')) uploads.push(request); });
    const dialog = await openImageSearch(page);
    const picker = dialog.getByLabel('Choose a photo');
    // Each problem is shown beside the drop zone and announced through the polite status region.
    const announced = dialog.getByRole('status', { name: 'Photo search status' });
    const shown = (text: string) => dialog.getByRole('paragraph').filter({ hasText: text });
    await picker.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
    await expect(shown('That file isn’t a supported image. Use a JPEG, PNG or WebP photo.')).toBeVisible();
    await expect(announced).toHaveText('That file isn’t a supported image. Use a JPEG, PNG or WebP photo.');
    await picker.setInputFiles({ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
    await expect(shown('That file is empty. Choose another photo.')).toBeVisible();
    await expect(announced).toHaveText('That file is empty. Choose another photo.');
    await expectNoHorizontalOverflow(page, 'image search');
    expect(uploads).toHaveLength(0);
  });

  test('a valid photo gets a truthful outcome and never fabricated matches', async ({ page }, testInfo) => {
    const uploads: Request[] = [];
    page.on('request', request => { if (request.url().includes('/api/search/image')) uploads.push(request); });
    const dialog = await openImageSearch(page);
    await dialog.getByLabel('Choose a photo').setInputFiles({ name: 'speaker.png', mimeType: 'image/png', buffer: samplePng() });
    await dialog.getByRole('button', { name: 'Search similar products' }).click();

    const disabled = dialog.getByText('Image search isn’t available yet. Your photo was not sent.').first();
    const unavailable = dialog.getByText('Image search is unavailable right now. Search by text or browse products.').first();
    await expect(disabled.or(unavailable)).toBeVisible();
    const switchedOff = await disabled.isVisible();
    testInfo.annotations.push({ type: 'image-search-mode', description: switchedOff ? 'switched off in this build (photo not sent)' : 'enabled; gateway answered unavailable' });
    if (switchedOff) {
      // Switched off in this build: the photo stayed in the browser.
      expect(uploads).toHaveLength(0);
    } else {
      // Switched on, but no AI service behind the gateway: one upload, answered as unavailable (never as results).
      expect(uploads).toHaveLength(1);
      const response = await uploads[0].response();
      expect([404, 501, 503]).toContain(response?.status());
    }
    await expect(dialog.getByRole('region', { name: 'Visually similar products' })).toHaveCount(0);
  });
});
