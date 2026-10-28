import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';
import { ProductMediaStorageError } from '../integrations/storage/product-media.storage.js';
import { ProductMediaValidationError } from '../validators/product-media.validator.js';
import { ProductMediaService } from '../services/product-media.service.js';

const uuid = z.string().uuid();
const metadata = z.object({ altText: z.string().trim().max(255).optional(),
  isPrimary: z.literal(true).optional(), sortOrder: z.number().int().min(0).max(1000).optional() }).strict()
  .refine(value => Object.keys(value).length > 0);
const uploadMetadata = z.object({ altText: z.string().trim().max(255).optional() }).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError('Invalid media request.', 400, 'MEDIA_REQUEST_INVALID');
  return result.data;
}
function expected(req: Request) {
  const value = req.get('If-Match')?.replace(/^"|"$/g, '');
  if (!value || !z.iso.datetime().safeParse(value).success) throw new AppError('Refresh the gallery before updating it.', 409, 'MEDIA_REVISION_REQUIRED');
  return value;
}
const service = new ProductMediaService();
type Action = (req: Request, res: Response) => Promise<void>;
export const mediaAction = (action: Action) => async (req: Request, res: Response, next: NextFunction) => {
  try { await action(req, res); } catch (error) {
    if (error instanceof ProductMediaStorageError) next(new AppError('Photo storage is unavailable. Please retry.', error.statusCode, `MEDIA_STORAGE_${error.code}`));
    else if (error instanceof ProductMediaValidationError) next(new AppError(error.message, error.statusCode, error.code));
    else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new AppError('This media request conflicts with a concurrent change. Refresh and try again.', 409, 'MEDIA_CONFLICT'));
    }
    else next(error);
  }
};
export const listMediaProducts = mediaAction(async (req, res) => {
  const q = parse(z.string().trim().max(100), req.query.q ?? '');
  const page = parse(z.coerce.number().int().min(1).max(1_000_000), req.query.page ?? '1');
  const pageSize = parse(z.coerce.number().int().min(1).max(50), req.query.pageSize ?? '30');
  const result = await service.products(q, page, pageSize);
  res.json(result);
});
export const listProductMedia = mediaAction(async (req, res) => {
  res.json({ data: await service.list(parse(uuid, req.params.productId)) });
});
export const getMediaProduct = mediaAction(async (req, res) => {
  res.json({ data: await service.product(parse(uuid, req.params.productId)) });
});
const handleUploadProductMedia = mediaAction(async (req, res) => {
  const productId = parse(uuid, req.params.productId);
  const imageId = req.params.imageId ? parse(uuid, req.params.imageId) : undefined;
  const key = parse(uuid, req.get('Idempotency-Key'));
  if (!req.file) throw new AppError('Choose a photo.', 400, 'MEDIA_FILE_REQUIRED');
  const body = parse(uploadMetadata, req.body);
  const data = await service.upload({ actorId: req.user!.userId, productId, imageId,
    expected: imageId ? expected(req) : undefined, key, bytes: req.file.buffer, mime: req.file.mimetype, altText: body.altText });
  res.status(imageId ? 200 : 201).json({ data });
});
export const uploadProductMedia = async (req: Request, res: Response, next: NextFunction) => {
  res.locals.mediaProcessing = true;
  try { await handleUploadProductMedia(req, res, next); }
  finally { res.locals.mediaProcessing = false; res.locals.releaseMediaUpload?.(); }
};
export const patchProductMedia = mediaAction(async (req, res) => {
  res.json({ data: await service.patch(req.user!.userId, parse(uuid, req.params.productId),
    parse(uuid, req.params.imageId), expected(req), parse(metadata, req.body)) });
});
export const retireProductMedia = mediaAction(async (req, res) => {
  res.json({ data: await service.retire(req.user!.userId, parse(uuid, req.params.productId), parse(uuid, req.params.imageId), expected(req)) });
});
export const retryProductMedia = mediaAction(async (req, res) => {
  res.json({ data: await service.retry(req.user!.userId, parse(uuid, req.params.productId), parse(uuid, req.params.imageId)) });
});
