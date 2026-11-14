import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { ProductMediaStorageError } from '../integrations/storage/product-media.storage.js';
import { ProfilePhotoValidationError, profilePhotoService } from '../services/profile-photo.service.js';

type Role = 'CUSTOMER' | 'ADMIN';
const identity = (req: Request) => req.user!.userId;

function mapError(error: unknown, next: NextFunction) {
  if (error instanceof AppError) return next(error);
  if (error instanceof ProfilePhotoValidationError) {
    return next(new AppError(error.message, error.statusCode, error.code));
  }
  if (error instanceof ProductMediaStorageError) {
    return next(new AppError('Profile photo storage is unavailable. Please try again later.', error.statusCode, 'PROFILE_PHOTO_STORAGE_UNAVAILABLE'));
  }
  return next(error);
}

function handle(operation: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const isUpload = Boolean(req.file);
    if (isUpload) res.locals.profilePhotoProcessing = true;
    try {
      const data = await operation(req, res);
      res.set('Cache-Control', 'private, no-store');
      if (!res.headersSent) res.status(200).json({ data });
    } catch (error) {
      mapError(error, next);
    } finally {
      if (isUpload) {
        res.locals.profilePhotoProcessing = false;
        (res.locals.releaseProfilePhotoUpload as (() => void) | undefined)?.();
      }
    }
  };
}

export const customerProfilePhotoController = {
  get: handle(req => profilePhotoService.get(identity(req), 'CUSTOMER')),
  upload: handle(req => profilePhotoService.upload(identity(req), 'CUSTOMER', req.file!.buffer)),
  remove: handle(req => profilePhotoService.remove(identity(req), 'CUSTOMER')),
};

export const adminProfilePhotoController = {
  get: handle(req => profilePhotoService.get(identity(req), 'ADMIN')),
  upload: handle(req => profilePhotoService.upload(identity(req), 'ADMIN', req.file!.buffer)),
  remove: handle(req => profilePhotoService.remove(identity(req), 'ADMIN')),
};

export function createProfilePhotoHandler(role: Role, action: 'get' | 'upload' | 'remove') {
  const controller = role === 'ADMIN' ? adminProfilePhotoController : customerProfilePhotoController;
  return controller[action];
}
