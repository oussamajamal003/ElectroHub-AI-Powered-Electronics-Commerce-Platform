import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface StorefrontProfile {
  storeName: string; supportEmail: string | null; supportPhone: string | null;
  addressLine1: string | null; addressLine2: string | null; city: string | null; region: string | null;
  postalCode: string | null; country: string | null; businessHours?: string | null; currency: 'USD';
}
export const storefrontProfileKey = ['store', 'profile'] as const;
export const getStorefrontProfile = async (signal?: AbortSignal) =>
  (await apiClient<{ data: StorefrontProfile }>('/api/store/profile', { signal })).data;
export function useStorefrontProfile() {
  return useQuery({ queryKey: storefrontProfileKey, queryFn: ({ signal }) => getStorefrontProfile(signal), staleTime: 60_000 });
}

export interface ContactMessage { name: string; email: string; subject: string; message: string; /** Honeypot: always empty for people. */ website?: string }
export async function sendContactMessage(body: ContactMessage) {
  return apiClient<{ data: { accepted: true } }>('/api/store/contact', { method: 'POST', data: body });
}
