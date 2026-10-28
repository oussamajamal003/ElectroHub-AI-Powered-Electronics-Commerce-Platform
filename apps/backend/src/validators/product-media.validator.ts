import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const PRODUCT_MEDIA_MAX_INPUT_BYTES = 6 * 1024 * 1024;
export const PRODUCT_MEDIA_MAX_PIXELS = 20_000_000;
export const PRODUCT_MEDIA_MIN_DIMENSION = 128;
export const PRODUCT_MEDIA_MAX_DIMENSION = 6_000;
export const PRODUCT_MEDIA_MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
export const PRODUCT_MEDIA_ALLOWED_INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ProductMediaInputType = (typeof PRODUCT_MEDIA_ALLOWED_INPUT_TYPES)[number];

export interface NormalizedProductMedia {
  bytes: Buffer;
  sha256: string;
  width: number;
  height: number;
  mimeType: 'image/webp';
  byteSize: number;
}

export class ProductMediaValidationError extends Error {
  constructor(readonly code: 'IMAGE_REQUIRED' | 'IMAGE_TOO_LARGE' | 'IMAGE_UNSUPPORTED_TYPE' | 'IMAGE_INVALID' | 'IMAGE_DIMENSIONS' | 'IMAGE_OUTPUT_TOO_LARGE', message: string, readonly statusCode: number) {
    super(message);
    this.name = 'ProductMediaValidationError';
  }
}

const MIME_FORMAT: Record<ProductMediaInputType, 'jpeg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function hasDeclaredSignature(buffer: Buffer, mimeType: ProductMediaInputType): boolean {
  switch (mimeType) {
    case 'image/jpeg':
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  }
}

function isWebp(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
}

/** Fully decodes and canonicalizes a bounded catalog image; sharp strips metadata and autorotates from EXIF. */
export async function normalizeProductMedia(buffer: Buffer, declaredMimeType: string): Promise<NormalizedProductMedia> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ProductMediaValidationError('IMAGE_REQUIRED', 'Choose a product image.', 400);
  }
  if (buffer.length > PRODUCT_MEDIA_MAX_INPUT_BYTES) {
    throw new ProductMediaValidationError('IMAGE_TOO_LARGE', 'Product images must be 6 MiB or smaller.', 413);
  }
  if (!PRODUCT_MEDIA_ALLOWED_INPUT_TYPES.includes(declaredMimeType as ProductMediaInputType)) {
    throw new ProductMediaValidationError('IMAGE_UNSUPPORTED_TYPE', 'Use a JPEG, PNG, or WebP image.', 415);
  }
  const inputType = declaredMimeType as ProductMediaInputType;
  if (!hasDeclaredSignature(buffer, inputType)) {
    throw new ProductMediaValidationError('IMAGE_UNSUPPORTED_TYPE', 'Image signature does not match the declared format.', 415);
  }

  try {
    const image = sharp(buffer, { failOn: 'error', animated: false });
    const metadata = await image.metadata();
    const expectedFormat = MIME_FORMAT[inputType];
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
      throw new ProductMediaValidationError('IMAGE_UNSUPPORTED_TYPE', 'Use a single-frame JPEG, PNG, or WebP image.', 415);
    }

    const swapsDimensions = [5, 6, 7, 8].includes(metadata.orientation ?? 0);
    const width = swapsDimensions ? metadata.height : metadata.width;
    const height = swapsDimensions ? metadata.width : metadata.height;
    if (
      width < PRODUCT_MEDIA_MIN_DIMENSION || height < PRODUCT_MEDIA_MIN_DIMENSION ||
      width > PRODUCT_MEDIA_MAX_DIMENSION || height > PRODUCT_MEDIA_MAX_DIMENSION ||
      width * height > PRODUCT_MEDIA_MAX_PIXELS
    ) {
      throw new ProductMediaValidationError('IMAGE_DIMENSIONS', 'Image dimensions are outside the allowed range.', 422);
    }

    const { data, info } = await sharp(buffer, { limitInputPixels: PRODUCT_MEDIA_MAX_PIXELS, failOn: 'error', animated: false })
      .rotate().webp({ quality: 90, effort: 4, smartSubsample: true }).toBuffer({ resolveWithObject: true });
    if (info.format !== 'webp' || !isWebp(data)) {
      throw new ProductMediaValidationError('IMAGE_INVALID', 'Normalized image output failed validation.', 422);
    }
    if (data.length > PRODUCT_MEDIA_MAX_OUTPUT_BYTES) {
      throw new ProductMediaValidationError('IMAGE_OUTPUT_TOO_LARGE', 'Normalized image exceeds the storage limit.', 422);
    }
    return {
      bytes: data,
      sha256: createHash('sha256').update(data).digest('hex'),
      width: info.width,
      height: info.height,
      mimeType: 'image/webp',
      byteSize: data.length,
    };
  } catch (error) {
    if (error instanceof ProductMediaValidationError) throw error;
    throw new ProductMediaValidationError('IMAGE_INVALID', 'Image could not be safely decoded.', 422);
  }
}
