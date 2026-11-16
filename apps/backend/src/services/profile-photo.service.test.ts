import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { ProfilePhotoService, ProfilePhotoValidationError } from './profile-photo.service.js';
import type { ProfilePhotoRole } from '../integrations/storage/profile-photo.storage.js';
import { AppError } from '../middleware/errorHandler.js';

vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../config/env.js', () => ({ env: { DATABASE_URL: 'postgresql://test:unused@127.0.0.1:5432/test' } }));
vi.mock('../lib/database-target.js', () => ({ describeDatabaseTarget: vi.fn(), DEV_PROJECT: 'dev-project', PROD_PROJECT: 'prod-project' }));
vi.mock('../utils/logger.js', () => ({ logSafely: vi.fn() }));

const userId = '2f1c7d52-74e5-4e54-9ce0-07b50a8ce320';
const oldPath = `customers/${userId}/7b44a3f0-8f29-4e3c-a8bd-3f5471a3819a.webp`;
const newPath = `customers/${userId}/8a1194a7-4110-4a58-8b27-9bcd2434d012.webp`;
const signed = { url: 'https://project.supabase.co/storage/v1/object/sign/profile-photos/photo.webp?token=test', expiresAt: '2030-01-01T00:30:00.000Z' };

async function png() {
  return sharp({ create: { width: 64, height: 40, channels: 3, background: '#2663eb' } }).png().toBuffer();
}

function fixture(path: string | null, updateCount = 1) {
  const user = { id: userId, isActive: true, profilePhotoPath: path };
  const findFirst = vi.fn(async () => user);
  const updateMany = vi.fn(async () => ({ count: updateCount }));
  const db = { user: { findFirst, updateMany } } as never;
  const storage = {
    upload: vi.fn(async (_role: ProfilePhotoRole, _user: string, _bytes: Buffer) => newPath),
    createSignedReadUrl: vi.fn(async () => signed),
    remove: vi.fn(async () => undefined),
  };
  const service = new ProfilePhotoService(db, () => storage as never);
  return { service, storage, findFirst, updateMany };
}

describe('ProfilePhotoService', () => {
  it('queries by active role, signs only an owned object, and returns no path or storage credential', async () => {
    const f = fixture(oldPath);
    await expect(f.service.get(userId, 'CUSTOMER')).resolves.toEqual(signed);
    expect(f.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: userId, isActive: true, role: { name: 'CUSTOMER' } },
    }));
    expect(f.storage.createSignedReadUrl).toHaveBeenCalledWith(oldPath);
    expect(JSON.stringify(signed)).not.toContain('serviceRoleKey');
  });

  it('rejects malformed and other-role stored paths before asking storage for a signed URL', async () => {
    const f = fixture(`admins/${userId}/7b44a3f0-8f29-4e3c-a8bd-3f5471a3819a.webp`);
    await expect(f.service.get(userId, 'CUSTOMER')).rejects.toBeInstanceOf(AppError);
    expect(f.storage.createSignedReadUrl).not.toHaveBeenCalled();
  });

  it('normalizes an uploaded image, atomically associates the new object, then removes the owned previous image', async () => {
    const f = fixture(oldPath);
    await expect(f.service.upload(userId, 'CUSTOMER', await png())).resolves.toEqual(signed);
    const normalized = f.storage.upload.mock.calls[0]?.[2];
    expect(normalized).toBeInstanceOf(Buffer);
    const metadata = await sharp(normalized!).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
    expect(f.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: userId, isActive: true, role: { name: 'CUSTOMER' }, profilePhotoPath: oldPath },
      data: { profilePhotoPath: newPath },
    }));
    expect(f.storage.remove).toHaveBeenCalledWith(oldPath);
  });

  it('rejects oversized files before storage and cleans up its own upload after a concurrent profile change', async () => {
    const f = fixture(null, 0);
    await expect(f.service.upload(userId, 'CUSTOMER', Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toBeInstanceOf(ProfilePhotoValidationError);
    expect(f.storage.upload).not.toHaveBeenCalled();
    await expect(f.service.upload(userId, 'CUSTOMER', await png())).rejects.toMatchObject({ code: 'PROFILE_PHOTO_ACCOUNT_CHANGED' });
    expect(f.storage.remove).toHaveBeenCalledWith(newPath);
  });

  it('does not delete a path owned by another user during removal', async () => {
    const f = fixture(`customers/8a1194a7-4110-4a58-8b27-9bcd2434d012/${'7b44a3f0-8f29-4e3c-a8bd-3f5471a3819a'}.webp`);
    await expect(f.service.remove(userId, 'CUSTOMER')).rejects.toBeInstanceOf(AppError);
    expect(f.storage.remove).not.toHaveBeenCalled();
  });

  it('clears the owned profile path before storage deletion and restores it if deletion fails', async () => {
    const f = fixture(oldPath);
    await expect(f.service.remove(userId, 'CUSTOMER')).resolves.toBeUndefined();
    expect(f.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: userId, isActive: true, role: { name: 'CUSTOMER' }, profilePhotoPath: oldPath },
      data: { profilePhotoPath: null },
    }));
    expect(f.storage.remove).toHaveBeenCalledWith(oldPath);

    const retry = fixture(oldPath);
    retry.storage.remove.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(retry.service.remove(userId, 'CUSTOMER')).rejects.toThrow('Storage unavailable');
    expect(retry.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: userId, isActive: true, role: { name: 'CUSTOMER' }, profilePhotoPath: null },
      data: { profilePhotoPath: oldPath },
    }));
  });
});
