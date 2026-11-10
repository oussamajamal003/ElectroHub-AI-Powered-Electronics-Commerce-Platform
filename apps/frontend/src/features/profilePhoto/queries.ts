import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profilePhotoApi, type ProfilePhotoScope } from './api';

export const profilePhotoKey = (scope: ProfilePhotoScope, userId: string) => ['profile-photo', scope, userId] as const;
const SIGNED_URL_REFRESH_MS = 18 * 60 * 1000;

export function useProfilePhoto(scope: ProfilePhotoScope, userId: string | undefined) {
  return useQuery({
    queryKey: profilePhotoKey(scope, userId ?? 'signed-out'),
    queryFn: ({ signal }) => profilePhotoApi.get(scope, signal),
    enabled: Boolean(userId),
    staleTime: SIGNED_URL_REFRESH_MS,
    refetchInterval: query => query.state.data?.url ? SIGNED_URL_REFRESH_MS : false,
    retry: 1,
  });
}

export function useProfilePhotoMutations(scope: ProfilePhotoScope, userId: string) {
  const client = useQueryClient();
  const queryKey = profilePhotoKey(scope, userId);
  const upload = useMutation({
    mutationFn: (file: File) => profilePhotoApi.upload(scope, file),
    onSuccess: data => client.setQueryData(queryKey, data),
  });
  const remove = useMutation({
    mutationFn: () => profilePhotoApi.remove(scope),
    onSuccess: data => client.setQueryData(queryKey, data),
  });
  return { upload, remove };
}
