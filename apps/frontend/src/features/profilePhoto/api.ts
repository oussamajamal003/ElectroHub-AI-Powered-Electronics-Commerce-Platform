import { apiClient } from '@/lib/api';

export type ProfilePhotoScope = 'customer' | 'admin';
export interface ProfilePhotoData { url: string | null; expiresAt: string | null }
interface Envelope<T> { data: T }

function endpoint(scope: ProfilePhotoScope) {
  return scope === 'admin' ? '/api/admin/me/profile-photo' : '/api/account/profile-photo';
}

export const profilePhotoApi = {
  get: async (scope: ProfilePhotoScope, signal?: AbortSignal) =>
    (await apiClient<Envelope<ProfilePhotoData>>(endpoint(scope), { method: 'GET', signal })).data,
  upload: async (scope: ProfilePhotoScope, file: File) => {
    const form = new FormData();
    form.append('photo', file, file.name);
    return (await apiClient<Envelope<ProfilePhotoData>>(endpoint(scope), { method: 'POST', data: form })).data;
  },
  remove: async (scope: ProfilePhotoScope) => {
    await apiClient<Envelope<undefined>>(endpoint(scope), { method: 'DELETE' });
    return { url: null, expiresAt: null } satisfies ProfilePhotoData;
  },
};
