import type { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { AppError } from './errorHandler.js';
import { PROFILE_PHOTO_MAX_UPLOAD_BYTES } from '../services/profile-photo.service.js';

export const PROFILE_PHOTO_FIELD = 'photo';
let activeProfilePhotoUploads = 0;

/** Bound simultaneous image processing for the whole API process. */
export function admitProfilePhotoUpload(_req: Request, res: Response, next: NextFunction): void {
  if (activeProfilePhotoUploads >= 2) {
    next(new AppError('Photo processing is busy. Please retry shortly.', 429, 'PROFILE_PHOTO_BUSY'));
    return;
  }
  activeProfilePhotoUploads += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeProfilePhotoUploads -= 1;
  };
  res.locals.releaseProfilePhotoUpload = release;
  res.once('finish', release);
  res.once('close', () => { if (!res.locals.profilePhotoProcessing) release(); });
  next();
}

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PROFILE_PHOTO_MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 1, fieldNameSize: 32, headerPairs: 24 },
}).single(PROFILE_PHOTO_FIELD);

export function profilePhotoUpload(req: Request, res: Response, next: NextFunction): void {
  parser(req, res, error => {
    if (error) {
      const tooLarge = error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE';
      next(new AppError(tooLarge ? 'Choose an image that is 5 MB or smaller.' : 'Send one image in the photo field.',
        tooLarge ? 413 : 400, tooLarge ? 'PROFILE_PHOTO_TOO_LARGE' : 'PROFILE_PHOTO_UPLOAD_INVALID'));
      return;
    }
    if (!req.file || req.file.size === 0 || req.file.buffer.byteLength === 0) {
      next(new AppError('Choose a photo to upload.', 400, 'PROFILE_PHOTO_REQUIRED'));
      return;
    }
    next();
  });
}
