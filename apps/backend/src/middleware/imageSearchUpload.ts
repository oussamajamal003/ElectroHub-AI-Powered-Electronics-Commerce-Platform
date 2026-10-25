import type { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { AppError } from './errorHandler.js';
import type { AiImageSearchContentType } from '../integrations/ai/ai.schemas.js';

/** Task 04.2: single-image budget for public visual search (8 MiB). Enforced while streaming, before buffering completes. */
export const IMAGE_SEARCH_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_SEARCH_FIELD = 'image';

export interface SniffedImage {
  buffer: Buffer;
  contentType: AiImageSearchContentType;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decides the type from magic bytes only; the client filename, extension and Content-Type are ignored. */
export function sniffImageType(buffer: Buffer): AiImageSearchContentType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const parser = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: IMAGE_SEARCH_MAX_BYTES,
    // Text fields are never part of this contract: any extra field is rejected as an unexpected field.
    fields: 0,
    parts: 1,
    fieldNameSize: 64,
    fieldSize: 256,
    headerPairs: 32,
  },
}).single(IMAGE_SEARCH_FIELD);

function uploadError(error: unknown): AppError {
  if (error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return new AppError('This photo is too large. Upload an image up to 8 MB.', 413, 'IMAGE_TOO_LARGE');
  }
  if (error instanceof MulterError) {
    return new AppError('Send exactly one photo in the "image" field.', 400, 'IMAGE_REQUEST_INVALID');
  }
  return new AppError('The photo upload could not be read.', 400, 'IMAGE_REQUEST_INVALID');
}

/**
 * Parses exactly one `image` file (no other fields, no extra files), then checks it is non-empty and sniffs its type.
 * The sniffed image is exposed as `res.locals.sniffedImage`; raw bytes are never persisted or logged.
 */
export function imageSearchUpload(req: Request, res: Response, next: NextFunction): void {
  parser(req, res, (parseError?: unknown) => {
    if (parseError) {
      next(uploadError(parseError));
      return;
    }
    const file = req.file;
    if (!file || file.size === 0 || file.buffer.byteLength === 0) {
      next(new AppError('Choose a photo to search with.', 400, 'IMAGE_REQUIRED'));
      return;
    }
    const contentType = sniffImageType(file.buffer);
    if (!contentType) {
      next(new AppError('Unsupported photo type. Use a JPEG, PNG or WebP image.', 415, 'IMAGE_SEARCH_UNSUPPORTED_TYPE'));
      return;
    }
    res.locals.sniffedImage = { buffer: file.buffer, contentType } satisfies SniffedImage;
    next();
  });
}
