import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '@/lib/api';
import type { ItemResponse } from '@/features/admin/shared/api';

/*
 * Task 05.2 administrator settings API (store profile, shipping configuration, self-only notification preferences).
 * Contract: apps/backend/src/services/store-settings.service.ts and admin-notification.service.ts. Writes carry `expectedVersion`; a
 * stale version is a 409 VERSION_CONFLICT whose body includes the current state under `data`.
 */

export type ShippingMethodId = 'STANDARD' | 'EXPRESS' | 'OVERNIGHT';

export interface StoreProfile {
  storeName: string;
  supportEmail: string | null;
  supportPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  /** Free-text opening hours shown on the public Contact page. */
  businessHours: string | null;
  timezone: string;
  currency: 'USD';
  version: number;
  updatedAt: string | null;
}

export type StoreProfileInput = Omit<StoreProfile, 'currency' | 'version' | 'updatedAt'> & { expectedVersion: number };

export interface ShippingMethodView {
  method: ShippingMethodId;
  label: string;
  enabled: boolean;
  price: string;
  minDays: number;
  maxDays: number;
  estimate: string;
}

export interface ShippingView {
  version: number;
  currency: 'USD';
  freeShippingThreshold: string | null;
  methods: ShippingMethodView[];
}

export interface ShippingUpdateInput {
  expectedVersion: number;
  freeShippingThreshold: string | null;
  methods: { method: ShippingMethodId; enabled: boolean; price: string }[];
}

export interface ShippingPreview {
  subtotal: string;
  currency: 'USD';
  methods: { id: ShippingMethodId; label: string; price: string; minDays: number; maxDays: number; estimate: string }[];
}

export interface NotificationPreferences {
  orderPaid: boolean;
  lowStock: boolean;
  invitationAccepted: boolean;
  version: number;
}

export interface NotificationPreferencesInput extends Omit<NotificationPreferences, 'version'> {
  expectedVersion: number;
}

export const adminSettingsKeys = {
  all: ['admin', 'settings'] as const,
  store: ['admin', 'settings', 'store'] as const,
  shipping: ['admin', 'settings', 'shipping'] as const,
  shippingPreview: (subtotal: string) => ['admin', 'settings', 'shipping', 'preview', subtotal] as const,
  preferences: ['admin', 'settings', 'preferences'] as const,
};

const STORE = '/api/admin/settings/store';
const SHIPPING = '/api/admin/settings/shipping';
const PREFERENCES = '/api/admin/me/notification-preferences';

const enveloped = async <T>(endpoint: string, options?: { method?: string; data?: unknown; signal?: AbortSignal }): Promise<T> =>
  (await apiClient<ItemResponse<T>>(endpoint, options)).data;

export const adminSettingsApi = {
  getStore: (signal?: AbortSignal) => enveloped<StoreProfile>(STORE, { signal }),
  updateStore: (body: StoreProfileInput) => enveloped<StoreProfile>(STORE, { method: 'PATCH', data: body }),
  getShipping: (signal?: AbortSignal) => enveloped<ShippingView>(SHIPPING, { signal }),
  updateShipping: (body: ShippingUpdateInput) => enveloped<ShippingView>(SHIPPING, { method: 'PATCH', data: body }),
  previewShipping: (subtotal: string, signal?: AbortSignal) =>
    enveloped<ShippingPreview>(`${SHIPPING}/preview?subtotal=${encodeURIComponent(subtotal)}`, { signal }),
  getPreferences: (signal?: AbortSignal) => enveloped<NotificationPreferences>(PREFERENCES, { signal }),
  updatePreferences: (body: NotificationPreferencesInput) => enveloped<NotificationPreferences>(PREFERENCES, { method: 'PATCH', data: body }),
};

/** The current server state carried by a 409 body, or null for any other failure. */
export function conflictCurrent<T>(error: unknown): T | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  return ((error.data as { data?: T } | undefined)?.data) ?? null;
}

export const isVersionConflict = (error: unknown) => error instanceof ApiError && error.code === 'VERSION_CONFLICT';

export function useStoreSettings() {
  return useQuery({ queryKey: adminSettingsKeys.store, queryFn: ({ signal }) => adminSettingsApi.getStore(signal) });
}

export function useShippingSettings() {
  return useQuery({ queryKey: adminSettingsKeys.shipping, queryFn: ({ signal }) => adminSettingsApi.getShipping(signal) });
}

export function useNotificationPreferences() {
  return useQuery({ queryKey: adminSettingsKeys.preferences, queryFn: ({ signal }) => adminSettingsApi.getPreferences(signal) });
}

/** Saved quotes for a subtotal (the checkout's own calculation, server side). Only runs once a valid subtotal is entered. */
export function useShippingPreview(subtotal: string | null) {
  return useQuery({
    queryKey: adminSettingsKeys.shippingPreview(subtotal ?? ''),
    queryFn: ({ signal }) => adminSettingsApi.previewShipping(subtotal!, signal),
    enabled: subtotal !== null,
  });
}

export function useUpdateStoreSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: StoreProfileInput) => adminSettingsApi.updateStore(body),
    onSuccess: profile => {
      client.setQueryData(adminSettingsKeys.store, profile);
      for (const queryKey of [['store', 'profile'], ['admin', 'dashboard'], ['admin', 'analytics']]) {
        void client.invalidateQueries({ queryKey });
      }
    },
  });
}

export function useUpdateShippingSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ShippingUpdateInput) => adminSettingsApi.updateShipping(body),
    onSuccess: view => {
      client.setQueryData(adminSettingsKeys.shipping, view);
      // Quotes shown in the preview were computed from the previous configuration.
      void client.invalidateQueries({ queryKey: [...adminSettingsKeys.all, 'shipping', 'preview'] });
    },
  });
}

export function useUpdateNotificationPreferences() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: NotificationPreferencesInput) => adminSettingsApi.updatePreferences(body),
    onSuccess: prefs => client.setQueryData(adminSettingsKeys.preferences, prefs),
  });
}
