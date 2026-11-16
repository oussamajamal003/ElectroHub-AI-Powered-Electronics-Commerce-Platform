import type { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { logSafely } from '../utils/logger.js';
import { ProfilePhotoStorage, type ProfilePhotoRole, isOwnedProfilePhotoPath } from '../integrations/storage/profile-photo.storage.js';
import { ProductMediaStorageError, resolveProductMediaStorageConfig } from '../integrations/storage/product-media.storage.js';
import { describeDatabaseTarget, DEV_PROJECT, PROD_PROJECT } from '../lib/database-target.js';
import { env } from '../config/env.js';

export const PROFILE_PHOTO_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const PROFILE_PHOTO_MAX_PIXELS = 20_000_000;
const PROFILE_PHOTO_SIZE = 512;
const ALLOWED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp']);

export class ProfilePhotoValidationError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = 'PROFILE_PHOTO_INVALID') {
    super(message);
    this.name = 'ProfilePhotoValidationError';
  }
}

type PhotoUser = { id: string; isActive: boolean; profilePhotoPath: string | null };
type PhotoDb = Pick<PrismaClient, 'user'>;
type PhotoStorage = Pick<ProfilePhotoStorage, 'upload' | 'createSignedReadUrl' | 'remove'>;

function defaultStorage(): PhotoStorage {
  const base = resolveProductMediaStorageConfig(process.env);
  if (!base) throw new ProductMediaStorageError('NOT_CONFIGURED', 'Profile photo storage is not configured.');
  const target = describeDatabaseTarget(env.DATABASE_URL);
  const expected = target.category === 'dev' ? DEV_PROJECT : target.category === 'production' ? PROD_PROJECT : null;
  if (!expected || base.projectRef !== expected) {
    throw new ProductMediaStorageError('NOT_CONFIGURED', 'Profile photo storage and database identities disagree.');
  }
  return new ProfilePhotoStorage({ ...base, bucket: 'profile-photos' });
}

async function normalizePhoto(input: Buffer): Promise<Buffer> {
  if (!Buffer.isBuffer(input) || input.length === 0) throw new ProfilePhotoValidationError('Choose an image to upload.');
  if (input.length > PROFILE_PHOTO_MAX_UPLOAD_BYTES) {
    throw new ProfilePhotoValidationError('Choose an image that is 5 MB or smaller.', 413, 'PROFILE_PHOTO_TOO_LARGE');
  }
  try {
    const metadata = await sharp(input, { limitInputPixels: PROFILE_PHOTO_MAX_PIXELS }).metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1 || !metadata.format || !ALLOWED_IMAGE_FORMATS.has(metadata.format)) {
      throw new ProfilePhotoValidationError('Use a JPEG, PNG, or WebP image.');
    }
    return await sharp(input, { limitInputPixels: PROFILE_PHOTO_MAX_PIXELS })
      .rotate()
      .resize(PROFILE_PHOTO_SIZE, PROFILE_PHOTO_SIZE, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
  } catch (error) {
    if (error instanceof ProfilePhotoValidationError) throw error;
    throw new ProfilePhotoValidationError('This image could not be opened. Choose a JPEG, PNG, or WebP photo.');
  }
}

export class ProfilePhotoService {
  constructor(
    private readonly db: PhotoDb = prisma,
    private readonly storage: () => PhotoStorage = defaultStorage,
  ) {}

  private async user(userId: string, role: ProfilePhotoRole): Promise<PhotoUser> {
    const user = await this.db.user.findFirst({
      where: { id: userId, isActive: true, role: { name: role } },
      select: { id: true, isActive: true, profilePhotoPath: true },
    }) as PhotoUser | null;
    if (!user) throw new AppError('Your account could not be found.', 404, 'PROFILE_PHOTO_ACCOUNT_NOT_FOUND');
    return user;
  }

  private async photo(user: PhotoUser, role: ProfilePhotoRole) {
    if (!user.profilePhotoPath) return { url: null, expiresAt: null };
    if (!isOwnedProfilePhotoPath(user.profilePhotoPath, role, user.id)) {
      throw new AppError('Your profile photo could not be loaded.', 503, 'PROFILE_PHOTO_STATE_INVALID');
    }
    return this.storage().createSignedReadUrl(user.profilePhotoPath);
  }

  async get(userId: string, role: ProfilePhotoRole) {
    return this.photo(await this.user(userId, role), role);
  }

  async upload(userId: string, role: ProfilePhotoRole, input: Buffer) {
    const existing = await this.user(userId, role);
    const normalized = await normalizePhoto(input);
    const storage = this.storage();
    const newPath = await storage.upload(role, userId, normalized);

    let signedPhoto: Awaited<ReturnType<PhotoStorage['createSignedReadUrl']>>;
    try {
      // Prove the signed read can be created before committing the path, so an upstream signing failure does not leave
      // the user's profile changed while the client receives an upload error.
      signedPhoto = await storage.createSignedReadUrl(newPath);
      const updated = await this.db.user.updateMany({
        where: { id: userId, isActive: true, role: { name: role }, profilePhotoPath: existing.profilePhotoPath },
        data: { profilePhotoPath: newPath },
      });
      if (updated.count !== 1) throw new AppError('Your account changed. Refresh and try again.', 409, 'PROFILE_PHOTO_ACCOUNT_CHANGED');
    } catch (error) {
      await storage.remove(newPath).catch(cleanupError => {
        logSafely('warn', 'Profile photo upload rollback cleanup failed.', {
          operation: 'profile_photo.upload_rollback_cleanup_failed', userId, error: cleanupError,
        });
      });
      throw error;
    }

    if (existing.profilePhotoPath && existing.profilePhotoPath !== newPath) {
      if (!isOwnedProfilePhotoPath(existing.profilePhotoPath, role, userId)) {
        logSafely('warn', 'Profile photo replacement found an invalid previous path.', {
          operation: 'profile_photo.replace_invalid_previous_path', userId,
        });
      } else await storage.remove(existing.profilePhotoPath).catch(error => {
        logSafely('warn', 'Profile photo replacement cleanup failed.', {
          operation: 'profile_photo.replace_cleanup', userId, error,
        });
      });
    }
    return signedPhoto;
  }

  async remove(userId: string, role: ProfilePhotoRole): Promise<void> {
    const existing = await this.user(userId, role);
    if (!existing.profilePhotoPath) return;
    if (!isOwnedProfilePhotoPath(existing.profilePhotoPath, role, userId)) {
      throw new AppError('Your profile photo could not be removed.', 503, 'PROFILE_PHOTO_STATE_INVALID');
    }
    const storage = this.storage();
    const updated = await this.db.user.updateMany({
      where: { id: userId, isActive: true, role: { name: role }, profilePhotoPath: existing.profilePhotoPath },
      data: { profilePhotoPath: null },
    });
    if (updated.count !== 1) throw new AppError('Your account changed. Refresh and try again.', 409, 'PROFILE_PHOTO_ACCOUNT_CHANGED');
    try {
      await storage.remove(existing.profilePhotoPath);
    } catch (error) {
      // Keep the profile association if Storage is temporarily unavailable. The null-only condition avoids overwriting
      // a new photo uploaded after this remove began.
      const restored = await this.db.user.updateMany({
        where: { id: userId, isActive: true, role: { name: role }, profilePhotoPath: null },
        data: { profilePhotoPath: existing.profilePhotoPath },
      }).catch(restoreError => {
        logSafely('error', 'Profile photo removal could not restore its previous association.', {
          operation: 'profile_photo.remove_restore_failed', userId, error: restoreError,
        });
        return { count: 0 };
      });
      if (restored.count !== 1) {
        logSafely('warn', 'Profile photo removal lost its previous association during recovery.', {
          operation: 'profile_photo.remove_restore_conflict', userId,
        });
      }
      throw error;
    }
  }
}

export const profilePhotoService = new ProfilePhotoService();
