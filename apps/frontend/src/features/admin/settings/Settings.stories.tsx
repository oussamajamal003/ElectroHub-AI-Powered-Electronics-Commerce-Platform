import { useEffect, useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminToastProvider } from '@/features/admin/shared/AdminUi';
import { ApiError } from '@/lib/api';
import { adminSettingsApi, type StoreProfile, type ShippingView, type NotificationPreferences } from './api';
import { StoreSettingsForm } from './components/StoreSettingsForm';
import { ShippingSettingsForm } from './components/ShippingSettingsForm';
import { NotificationPreferencesForm } from './components/NotificationPreferencesForm';

// Fixed synthetic fixtures; every write is intercepted at the existing API boundary.
const profile: StoreProfile = {
  storeName: 'ElectroHub', supportEmail: 'help@example.test', supportPhone: '+1 555 0100', addressLine1: '123 Commerce Street',
  addressLine2: null, city: 'New York', region: 'NY', postalCode: '10001', country: 'United States', timezone: 'America/New_York',
  currency: 'USD', version: 4, updatedAt: '2026-11-01T00:00:00.000Z',
};
const shipping: ShippingView = { version: 2, currency: 'USD', freeShippingThreshold: '50.00', methods: [
  { method: 'STANDARD', label: 'Standard Delivery', enabled: true, price: '5.00', minDays: 5, maxDays: 7, estimate: '5-7 business days' },
  { method: 'EXPRESS', label: 'Express Delivery', enabled: true, price: '9.99', minDays: 2, maxDays: 3, estimate: '2-3 business days' },
  { method: 'OVERNIGHT', label: 'Overnight Delivery', enabled: true, price: '19.99', minDays: 1, maxDays: 1, estimate: 'Next business day' },
] };
const preferences: NotificationPreferences = { orderPaid: true, lowStock: true, invitationAccepted: true, version: 3 };
type Outcome = 'success' | 'validation' | 'conflict' | 'failure' | 'pending';
const fail = (outcome: Outcome): never => {
  if (outcome === 'conflict') throw new ApiError(409, 'Changed elsewhere', { data: {} }, 'VERSION_CONFLICT');
  if (outcome === 'validation') throw new ApiError(400, 'Check the highlighted fields', {
    error: { code: 'VALIDATION_ERROR', fields: [{ field: 'storeName', message: 'Enter a store name of at least 2 characters.' }] },
  }, 'VALIDATION_ERROR');
  throw new ApiError(503, 'Unavailable');
};
function Sandbox({ outcome, children }: { outcome: Outcome; children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { mutations: { retry: false } } }));
  useEffect(() => {
    const original = { ...adminSettingsApi };
    const respond = async <T,>(value: T): Promise<T> => {
      if (outcome === 'pending') return new Promise<T>(() => undefined);
      if (outcome !== 'success') return fail(outcome);
      return value;
    };
    adminSettingsApi.updateStore = async body => respond({ ...profile, ...body, version: profile.version + 1 });
    adminSettingsApi.updateShipping = async () => respond({ ...shipping, version: shipping.version + 1 });
    adminSettingsApi.updatePreferences = async body => respond({ ...preferences, ...body, version: preferences.version + 1 });
    return () => { Object.assign(adminSettingsApi, original); };
  }, [outcome]);
  return <QueryClientProvider client={client}><AdminToastProvider><div style={{ padding: 24, maxWidth: 900 }}>{children}</div></AdminToastProvider></QueryClientProvider>;
}
const noop = () => undefined;
const reload = async () => undefined;
type Section = 'store' | 'shipping' | 'notifications';
function SettingsStory({ section, outcome = 'success' }: { section: Section; outcome?: Outcome }) {
  return <Sandbox outcome={outcome}>
    {section === 'store' && <StoreSettingsForm profile={profile} onDirtyChange={noop} onSaved={noop} onReload={reload} />}
    {section === 'shipping' && <ShippingSettingsForm view={shipping} onDirtyChange={noop} onSaved={noop} onReload={reload} />}
    {section === 'notifications' && <NotificationPreferencesForm preferences={preferences} onDirtyChange={noop} onSaved={noop} onReload={reload} />}
  </Sandbox>;
}
const meta = { title: 'Admin/Settings', component: SettingsStory, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof SettingsStory>;
export default meta;
type Story = StoryObj<typeof meta>;
const changeStore = async (canvasElement: HTMLElement, value = 'ElectroHub Updated') => {
  const canvas = within(canvasElement);
  await userEvent.clear(canvas.getByLabelText('Store name'));
  await userEvent.type(canvas.getByLabelText('Store name'), value);
};
const saveStore = async (canvasElement: HTMLElement, value?: string) => {
  await changeStore(canvasElement, value);
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Save Changes' }));
};
const changeShipping = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement);
  for (const [label, value] of [['Free Shipping Threshold ($)', '75.00'], ['Express Shipping Rate ($)', '12.50']] as const) {
    await userEvent.clear(canvas.getByLabelText(label));
    await userEvent.type(canvas.getByLabelText(label), value);
  }
};
const changeNotifications = async (canvasElement: HTMLElement) => {
  await userEvent.click(within(canvasElement).getByRole('checkbox', { name: /New order received/ }));
};
export const StorePopulated: Story = { args: { section: 'store' } };
export const StoreDirty: Story = { args: { section: 'store' }, play: async ({ canvasElement }) => changeStore(canvasElement) };
export const StoreValidation: Story = { args: { section: 'store', outcome: 'validation' }, play: async ({ canvasElement }) => saveStore(canvasElement, 'N') };
export const StoreSaveSuccess: Story = { args: { section: 'store' }, play: async ({ canvasElement }) => saveStore(canvasElement) };
export const StoreVersionConflict: Story = { args: { section: 'store', outcome: 'conflict' }, play: async ({ canvasElement }) => saveStore(canvasElement) };
export const ShippingPopulated: Story = { args: { section: 'shipping' } };
export const ShippingChangedRateAndThreshold: Story = { args: { section: 'shipping' }, play: async ({ canvasElement }) => changeShipping(canvasElement) };
export const ShippingDisabledOption: Story = { args: { section: 'shipping' }, play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole('checkbox', { name: 'Enable overnight delivery option' })); } };
export const ShippingVersionConflict: Story = { args: { section: 'shipping', outcome: 'conflict' }, play: async ({ canvasElement }) => { await changeShipping(canvasElement); await userEvent.click(within(canvasElement).getByRole('button', { name: 'Save Shipping' })); } };
export const NotificationsEnabled: Story = { args: { section: 'notifications' } };
export const NotificationsPending: Story = { args: { section: 'notifications', outcome: 'pending' }, play: async ({ canvasElement }) => { await changeNotifications(canvasElement); await userEvent.click(within(canvasElement).getByRole('button', { name: 'Save Preferences' })); } };
export const NotificationsSuccess: Story = { args: { section: 'notifications' }, play: async ({ canvasElement }) => { await changeNotifications(canvasElement); await userEvent.click(within(canvasElement).getByRole('button', { name: 'Save Preferences' })); } };
export const NotificationsFailure: Story = { args: { section: 'notifications', outcome: 'failure' }, play: async ({ canvasElement }) => { await changeNotifications(canvasElement); await userEvent.click(within(canvasElement).getByRole('button', { name: 'Save Preferences' })); } };
