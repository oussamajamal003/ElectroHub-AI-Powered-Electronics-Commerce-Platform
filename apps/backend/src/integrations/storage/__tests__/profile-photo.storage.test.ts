import { describe, expect, it, vi } from 'vitest';
import {
  isOwnedProfilePhotoPath, ProfilePhotoStorage, profilePhotoObjectPath,
  type ProfilePhotoRole,
} from '../profile-photo.storage.js';
import { ProductMediaStorageError, type ProductMediaStorageConfig } from '../product-media.storage.js';

const config: ProductMediaStorageConfig = {
  supabaseUrl: new URL('https://testproject.supabase.co'),
  serviceRoleKey: 'unit-test-only-key-with-no-real-privileges-000000000000',
  projectRef: 'testproject',
  bucket: 'profile-photos',
  timeoutMs: 500,
};
const userId = '2f1c7d52-74e5-4e54-9ce0-07b50a8ce320';
const objectId = '7b44a3f0-8f29-4e3c-a8bd-3f5471a3819a';

describe('profile photo object identity', () => {
  it.each<ProfilePhotoRole>(['CUSTOMER', 'ADMIN'])('derives a %s-only path and rejects cross-role paths', role => {
    const path = profilePhotoObjectPath(role, userId, objectId);
    expect(isOwnedProfilePhotoPath(path, role, userId)).toBe(true);
    expect(isOwnedProfilePhotoPath(path, role === 'ADMIN' ? 'CUSTOMER' : 'ADMIN', userId)).toBe(false);
    expect(isOwnedProfilePhotoPath(path, role, objectId)).toBe(false);
  });

  it('rejects non-UUID identities before constructing an object path', () => {
    expect(() => profilePhotoObjectPath('CUSTOMER', '../another-user', objectId)).toThrowError(ProductMediaStorageError);
  });
});

describe('private signed reads and object deletion', () => {
  it('accepts only a same-project signed URL and records a bounded expiry', async () => {
    const path = profilePhotoObjectPath('ADMIN', userId, objectId);
    const fetch = vi.fn(async (_input: Request | string | URL, _init?: RequestInit) => new Response(JSON.stringify({ signedURL: `/object/sign/profile-photos/${path}?token=one-time` }), { status: 200 }));
    const storage = new ProfilePhotoStorage(config, fetch as unknown as typeof globalThis.fetch, 500);
    const before = Date.now();
    const result = await storage.createSignedReadUrl(path);
    expect(new URL(result.url).origin).toBe(config.supabaseUrl.origin);
    expect(new URL(result.url).searchParams.get('token')).toBe('one-time');
    expect(Date.parse(result.expiresAt)).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
    expect(Date.parse(result.expiresAt)).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000 + 1000);
  });

  it('rejects a storage response that attempts to redirect reads off the configured project', async () => {
    const path = profilePhotoObjectPath('CUSTOMER', userId, objectId);
    const fetch = vi.fn(async (_input: Request | string | URL, _init?: RequestInit) => new Response(JSON.stringify({ signedURL: `https://attacker.example/storage/v1/object/sign/profile-photos/${path}?token=x` }), { status: 200 }));
    const storage = new ProfilePhotoStorage(config, fetch as unknown as typeof globalThis.fetch, 500);
    await expect(storage.createSignedReadUrl(path)).rejects.toThrowError(ProductMediaStorageError);
  });

  it('removes only a validated private-bucket object path', async () => {
    const path = profilePhotoObjectPath('CUSTOMER', userId, objectId);
    const fetch = vi.fn(async (_input: Request | string | URL, _init?: RequestInit) => new Response(null, { status: 200 }));
    const storage = new ProfilePhotoStorage(config, fetch as unknown as typeof globalThis.fetch, 500);
    await storage.remove(path);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://testproject.supabase.co/storage/v1/object/profile-photos');
    expect(init?.method).toBe('DELETE');
    expect(JSON.parse(String(init?.body))).toEqual({ prefixes: [path] });
    await expect(storage.remove('../escape.webp')).rejects.toThrowError(ProductMediaStorageError);
  });
});
