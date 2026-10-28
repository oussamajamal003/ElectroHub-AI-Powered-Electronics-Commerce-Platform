import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  normalizeProductMedia,
  PRODUCT_MEDIA_MAX_INPUT_BYTES,
  type ProductMediaInputType,
} from './product-media.validator.js';

const image = (width = 256, height = 192, format: 'jpeg' | 'png' | 'webp' = 'jpeg') =>
  sharp({ create: { width, height, channels: 3, background: { r: 35, g: 80, b: 180 } } })[format]().toBuffer();

describe('normalizeProductMedia', () => {
  it.each([
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ] as const)('normalizes %s to canonical WebP with digest and dimensions', async (format, mime) => {
    const output = await normalizeProductMedia(await image(320, 240, format), mime satisfies ProductMediaInputType);
    expect(output.mimeType).toBe('image/webp');
    expect(output.width).toBe(320);
    expect(output.height).toBe(240);
    expect(output.byteSize).toBe(output.bytes.length);
    expect(output.sha256).toMatch(/^[a-f0-9]{64}$/);
    const metadata = await sharp(output.bytes).metadata();
    expect(metadata.format).toBe('webp');
  });

  it('rejects absent, over-limit, mismatched MIME/signature and unsupported formats', async () => {
    await expect(normalizeProductMedia(Buffer.alloc(0), 'image/jpeg')).rejects.toMatchObject({ code: 'IMAGE_REQUIRED', statusCode: 400 });
    await expect(normalizeProductMedia(Buffer.alloc(PRODUCT_MEDIA_MAX_INPUT_BYTES + 1), 'image/jpeg')).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE', statusCode: 413 });
    const jpeg = await image();
    await expect(normalizeProductMedia(jpeg, 'image/png')).rejects.toMatchObject({ code: 'IMAGE_UNSUPPORTED_TYPE', statusCode: 415 });
    await expect(normalizeProductMedia(Buffer.from('not an image'), 'image/jpeg')).rejects.toMatchObject({ code: 'IMAGE_UNSUPPORTED_TYPE', statusCode: 415 });
    await expect(normalizeProductMedia(await image(160, 160, 'webp'), 'image/gif')).rejects.toMatchObject({ code: 'IMAGE_UNSUPPORTED_TYPE', statusCode: 415 });
  });

  it('rejects images below minimum, above maximum and above the decoded pixel budget', async () => {
    await expect(normalizeProductMedia(await image(127, 256), 'image/jpeg')).rejects.toMatchObject({ code: 'IMAGE_DIMENSIONS', statusCode: 422 });
    await expect(normalizeProductMedia(await image(6001, 256), 'image/jpeg')).rejects.toMatchObject({ code: 'IMAGE_DIMENSIONS', statusCode: 422 });
    await expect(normalizeProductMedia(await image(5000, 5000), 'image/jpeg')).rejects.toMatchObject({ code: 'IMAGE_DIMENSIONS', statusCode: 422 });
  });

  it('rejects truncated data without leaking decoder details', async () => {
    await expect(normalizeProductMedia(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'))
      .rejects.toMatchObject({ code: 'IMAGE_INVALID', message: 'Image could not be safely decoded.' });
  });
});
