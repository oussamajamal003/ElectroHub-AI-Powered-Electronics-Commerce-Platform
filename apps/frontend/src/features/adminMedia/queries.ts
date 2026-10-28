import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { mediaConcurrencyTag, type AdminMediaProduct, type ApiData, type MediaImage } from './types';

const mediaKeys = {
  products: (query: string) => ['admin', 'media', 'products', query] as const,
  product: (productId: string) => ['admin', 'media', 'product', productId] as const,
  images: (productId: string) => ['admin', 'media', 'images', productId] as const,
};

export function useAdminMediaProducts(query: string) {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  const suffix = params.size ? `?${params.toString()}` : '';
  return useQuery({
    queryKey: mediaKeys.products(query.trim()),
    queryFn: ({ signal }) => apiClient<ApiData<AdminMediaProduct[]>>(`/api/admin/products${suffix}`, { signal }),
    staleTime: 30_000,
  });
}
export function useAdminMediaProduct(productId: string) {
  return useQuery({
    queryKey: mediaKeys.product(productId),
    queryFn: ({ signal }) => apiClient<ApiData<AdminMediaProduct>>(`/api/admin/products/${encodeURIComponent(productId)}`, { signal }),
    enabled: Boolean(productId),
  });
}
export function useAdminProductImages(productId: string) {
  return useQuery({
    queryKey: mediaKeys.images(productId),
    queryFn: ({ signal }) => apiClient<ApiData<MediaImage[]>>(`/api/admin/products/${encodeURIComponent(productId)}/images`, { signal }),
    enabled: Boolean(productId),
    refetchInterval: query => query.state.data?.data.some(image => ['PENDING', 'PROCESSING', 'RETRY_WAIT'].includes(image.indexing.state)) ? 5_000 : false,
  });
}

function uploadFile(productId: string, file: File, altText: string, idempotencyKey: string, replace?: MediaImage) {
  const form = new FormData();
  form.set('file', file);
  form.set('altText', altText);
  const headers = new Headers({ 'Idempotency-Key': idempotencyKey });
  if (replace) headers.set('If-Match', mediaConcurrencyTag(replace));
  const path = `/api/admin/products/${encodeURIComponent(productId)}/images`;
  return apiClient<ApiData<MediaImage>>(replace ? `${path}/${encodeURIComponent(replace.id)}/file` : path,
    { method: replace ? 'PUT' : 'POST', headers, data: form });
}

type ImagePatch = { altText?: string; isPrimary?: true; sortOrder?: number };
export function useMediaMutations(productId: string) {
  const client = useQueryClient();
  const imagesKey = mediaKeys.images(productId);
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: imagesKey }),
      client.invalidateQueries({ queryKey: queryKeys.products.all }),
      client.invalidateQueries({ queryKey: queryKeys.search.all }),
    ]);
  };
  const upload = useMutation({ mutationFn: ({ file, altText = '', idempotencyKey }: { file: File; altText?: string; idempotencyKey: string }) => uploadFile(productId, file, altText, idempotencyKey), onSuccess: refresh });
  const replace = useMutation({ mutationFn: ({ image, file, altText, idempotencyKey }: { image: MediaImage; file: File; altText: string; idempotencyKey: string }) => uploadFile(productId, file, altText, idempotencyKey, image), onSuccess: refresh });
  const patch = useMutation({ mutationFn: ({ image, changes }: { image: MediaImage; changes: ImagePatch }) =>
    apiClient<ApiData<MediaImage>>(`/api/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.id)}`,
      { method: 'PATCH', headers: { 'If-Match': mediaConcurrencyTag(image) }, data: changes }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (image: MediaImage) => apiClient<ApiData<{ id: string }>>(
    `/api/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.id)}`,
    { method: 'DELETE', headers: { 'If-Match': mediaConcurrencyTag(image) } }), onSuccess: refresh });
  const retry = useMutation({ mutationFn: (image: MediaImage) => apiClient<ApiData<MediaImage>>(
    `/api/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.id)}/retry`, { method: 'POST' }), onSuccess: refresh });
  return { upload, replace, patch, remove, retry };
}

export const adminMediaQueryKeys = mediaKeys;
