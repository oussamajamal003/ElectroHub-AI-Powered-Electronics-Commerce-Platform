import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminSettingsPage } from './AdminSettingsPage';
import { AdminToastProvider } from '@/features/admin/shared/AdminUi';
import { ApiError } from '@/lib/api';
import {
  useStoreSettings, useUpdateStoreSettings, useShippingSettings, useUpdateShippingSettings, useNotificationPreferences,
  useUpdateNotificationPreferences, useShippingPreview,
} from '@/features/admin/settings/api';
import { useAdminProfile } from '@/features/admin/security/api';

// The hooks are mocked (no network). The pure helpers (conflict detection, envelope types) stay real.
vi.mock('@/features/admin/settings/api', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/admin/settings/api')>()),
  useStoreSettings: vi.fn(),
  useUpdateStoreSettings: vi.fn(),
  useShippingSettings: vi.fn(),
  useUpdateShippingSettings: vi.fn(),
  useNotificationPreferences: vi.fn(),
  useUpdateNotificationPreferences: vi.fn(),
  useShippingPreview: vi.fn(),
}));

// Capabilities decide whether the Administrators section is offered; most tests run as an Owner.
vi.mock('@/features/admin/security/api', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/admin/security/api')>()),
  useAdminProfile: vi.fn(),
}));
// The team page and its gate have their own tests; here they are stubs so the tab's wiring is what is asserted.
vi.mock('@/pages/admin/AdminAdministratorsPage', () => ({
  AdminAdministratorsPage: ({ embedded }: { embedded?: boolean }) => <div data-testid="team" data-embedded={String(embedded)}>Team list</div>,
}));
vi.mock('@/pages/admin/AdministratorsAccessGate', () => ({
  AdministratorsAccessGate: ({ children }: { children: React.ReactNode }) => <div data-testid="gate">{children}</div>,
}));
const asAdministrator = (capabilities: { isOwner: boolean; canManageAdmins: boolean }) =>
  vi.mocked(useAdminProfile).mockReturnValue({ data: { capabilities } } as unknown as ReturnType<typeof useAdminProfile>);

const profile = {
  storeName: 'ElectroHub', businessHours: null, supportEmail: 'hello@electrohub.com', supportPhone: '+1 555 000 0000', addressLine1: '123 Commerce Street',
  addressLine2: null, city: 'New York', region: 'NY', postalCode: '10001', country: 'United States', timezone: 'America/New_York',
  currency: 'USD' as const, version: 4, updatedAt: '2026-11-01T00:00:00.000Z',
};

const shipping = {
  version: 2, currency: 'USD' as const, freeShippingThreshold: null,
  methods: [
    { method: 'STANDARD' as const, label: 'Standard Delivery', enabled: true, price: '0.00', minDays: 5, maxDays: 7, estimate: '5-7 business days' },
    { method: 'EXPRESS' as const, label: 'Express Delivery', enabled: true, price: '9.99', minDays: 2, maxDays: 3, estimate: '2-3 business days' },
    { method: 'OVERNIGHT' as const, label: 'Overnight Delivery', enabled: true, price: '19.99', minDays: 1, maxDays: 1, estimate: 'Next business day' },
  ],
};

const preferences = { orderPaid: true, lowStock: false, invitationAccepted: true, version: 3 };

type Hook<T extends (...args: never[]) => unknown> = ReturnType<T>;
const query = <T,>(data: T | undefined, overrides: Record<string, unknown> = {}) =>
  ({ data, error: null, isPending: data === undefined, isError: false, isFetching: false, refetch: vi.fn(), ...overrides });
const mutation = (mutateAsync: ReturnType<typeof vi.fn>) => ({ mutateAsync, isPending: false });

let storeSave: ReturnType<typeof vi.fn>;
let shippingSave: ReturnType<typeof vi.fn>;
let prefsSave: ReturnType<typeof vi.fn>;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(path = '/admin/settings') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = () => <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[path]}>
      <AdminToastProvider>
        <Routes>
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
        </Routes>
        <LocationProbe />
      </AdminToastProvider>
    </MemoryRouter>
  </QueryClientProvider>;
  const result = render(content());
  return { ...result, client, refresh: () => result.rerender(content()) };
}

/**
 * Typing uses fireEvent.change (one event per value, fast in jsdom). Submit buttons use fireEvent.click: under user-event's pointer
 * sequence jsdom does not dispatch the form submit for these buttons, so a real submit path would look broken here.
 */
const setValue = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });
const submit = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  vi.clearAllMocks();
  asAdministrator({ isOwner: true, canManageAdmins: true });
  storeSave = vi.fn().mockResolvedValue({ ...profile, version: 5 });
  shippingSave = vi.fn().mockResolvedValue(shipping);
  prefsSave = vi.fn().mockResolvedValue({ ...preferences, version: 4 });
  vi.mocked(useStoreSettings).mockReturnValue(query(profile) as unknown as Hook<typeof useStoreSettings>);
  vi.mocked(useShippingSettings).mockReturnValue(query(shipping) as unknown as Hook<typeof useShippingSettings>);
  vi.mocked(useNotificationPreferences).mockReturnValue(query(preferences) as unknown as Hook<typeof useNotificationPreferences>);
  vi.mocked(useUpdateStoreSettings).mockReturnValue(mutation(storeSave) as unknown as Hook<typeof useUpdateStoreSettings>);
  vi.mocked(useUpdateShippingSettings).mockReturnValue(mutation(shippingSave) as unknown as Hook<typeof useUpdateShippingSettings>);
  vi.mocked(useUpdateNotificationPreferences).mockReturnValue(mutation(prefsSave) as unknown as Hook<typeof useUpdateNotificationPreferences>);
  vi.mocked(useShippingPreview).mockReturnValue(query(undefined) as unknown as Hook<typeof useShippingPreview>);
});

describe('store section', () => {
  it.each([false, true])('renders selectable details without editing for non-Owner, manager=%s', manager => {
    asAdministrator({ isOwner: false, canManageAdmins: manager });
    renderPage();
    expect(screen.getByText(profile.supportEmail)).toBeVisible();
    expect(screen.getByText(/Only an Owner can update/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save Changes' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('announces the loading state without exposing decorative placeholder controls', () => {
    vi.mocked(useStoreSettings).mockReturnValue(query(undefined, { isPending: true }) as unknown as Hook<typeof useStoreSettings>);
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading store settings' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
  });
  it('keeps the original draft version when a background refetch brings newer store settings', async () => {
    const page = renderPage();
    setValue(screen.getByLabelText('Store name'), 'My edited name');
    vi.mocked(useStoreSettings).mockReturnValue(query({ ...profile, version: 5, supportEmail: 'new@qa.invalid' }) as unknown as Hook<typeof useStoreSettings>);
    page.refresh();
    submit('Save Changes');
    await waitFor(() => expect(storeSave).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 4, storeName: 'My edited name', supportEmail: profile.supportEmail,
    })));
  });
  it('shows the saved store details, with the currency fixed to USD and not editable', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Store Information' })).toBeInTheDocument();
    expect(screen.getByLabelText('Store name')).toHaveValue('ElectroHub');
    expect(screen.getByLabelText('Store email')).toHaveValue('hello@electrohub.com');
    expect(screen.getByLabelText('Currency')).toHaveValue('USD – US Dollar (fixed)');
    expect(screen.getByLabelText('Currency')).toHaveAttribute('readonly');
    expect(screen.queryByRole('combobox', { name: /currency/i })).not.toBeInTheDocument();
  });

  it('offers example placeholders for every public contact field, which are not saved values', async () => {
    vi.mocked(useStoreSettings).mockReturnValue(query({ ...profile, supportEmail: null, supportPhone: null, addressLine1: null, addressLine2: null,
      city: null, country: null, businessHours: null }) as unknown as Hook<typeof useStoreSettings>);
    renderPage();
    expect(screen.getByLabelText('Store email')).toHaveAttribute('placeholder', 'support@example.com');
    expect(screen.getByLabelText('Phone')).toHaveAttribute('placeholder', '+961 XX XXX XXX');
    expect(screen.getByLabelText('Business hours')).toHaveAttribute('placeholder', 'Monday–Friday, 9:00 AM–6:00 PM');
    expect(screen.getByLabelText('Address line 1')).toHaveAttribute('placeholder');
    // Untouched placeholders are not values: nothing is dirty and nothing can be saved.
    expect(screen.getByLabelText('Business hours')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });

  it('saves business hours with the rest of the profile, using the existing authenticated save', async () => {
    renderPage();
    setValue(screen.getByLabelText('Business hours'), 'Monday–Friday, 9:00 AM–6:00 PM');
    submit('Save Changes');
    await waitFor(() => expect(storeSave).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 4, businessHours: 'Monday–Friday, 9:00 AM–6:00 PM' })));
  });

  it('keeps Save disabled until a field actually changes, then saves with the expected version', async () => {
    renderPage();
    const save = screen.getByRole('button', { name: 'Save Changes' });
    expect(save).toBeDisabled();

    setValue(screen.getByLabelText('Store name'), 'Northwind');
    expect(save).toBeEnabled();
    submit('Save Changes');

    await waitFor(() => expect(storeSave).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 4, storeName: 'Northwind', timezone: 'America/New_York', supportPhone: '+1 555 000 0000',
    })));
    expect(storeSave.mock.calls[0]?.[0]).not.toHaveProperty('currency');
    expect(await screen.findByText('Store settings saved')).toBeInTheDocument();
  });

  it('a version conflict shows the banner and keeps the administrator edits', async () => {
    storeSave.mockRejectedValueOnce(new ApiError(409, 'changed', { error: { code: 'VERSION_CONFLICT', message: 'changed' }, data: { ...profile, version: 6 } }, 'VERSION_CONFLICT'));
    renderPage();

    setValue(screen.getByLabelText('Store name'), 'Northwind');
    submit('Save Changes');

    const banner = await screen.findByRole('alert');
    expect(within(banner).getByText('These settings changed elsewhere')).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: 'Reload latest values' })).toBeInTheDocument();
    expect(screen.getByLabelText('Store name')).toHaveValue('Northwind');
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });

  it('keeps the draft and offers retry when reloading after a conflict fails', async () => {
    storeSave.mockRejectedValueOnce(new ApiError(409, 'changed', { error: { code: 'VERSION_CONFLICT', message: 'changed' } }, 'VERSION_CONFLICT'));
    const { client } = renderPage();
    vi.spyOn(client, 'refetchQueries').mockImplementation(async (_filters, options) => {
      if (options?.throwOnError) throw new Error('network unavailable');
    });
    setValue(screen.getByLabelText('Store name'), 'Unsaved draft');
    submit('Save Changes');
    fireEvent.click(await screen.findByRole('button', { name: 'Reload latest values' }));
    expect(await screen.findByText(/could not reload the latest values/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Store name')).toHaveValue('Unsaved draft');
    expect(screen.getByRole('button', { name: 'Reload latest values' })).toBeEnabled();
  });

  it('shows a server validation message beside the field it belongs to', async () => {
    storeSave.mockRejectedValueOnce(new ApiError(400, 'Check the highlighted fields and try again.', {
      error: { code: 'VALIDATION_ERROR', message: 'x', fields: [{ field: 'storeName', message: 'Enter a store name of at least 2 characters.' }] },
    }, 'VALIDATION_ERROR'));
    renderPage();

    setValue(screen.getByLabelText('Store name'), 'N');
    submit('Save Changes');

    expect(await screen.findByText('Enter a store name of at least 2 characters.')).toBeInTheDocument();
  });

  it('shows a skeleton while loading, then a retryable message when the profile cannot be loaded', async () => {
    const user = userEvent.setup();
    vi.mocked(useStoreSettings).mockReturnValue(query(undefined, { isPending: true }) as unknown as Hook<typeof useStoreSettings>);
    const { unmount } = renderPage();
    expect(screen.getByLabelText('Loading store settings')).toBeInTheDocument();
    unmount();

    const refetch = vi.fn();
    vi.mocked(useStoreSettings).mockReturnValue(query(undefined, { isPending: false, isError: true, error: new Error('down'), refetch }) as unknown as Hook<typeof useStoreSettings>);
    renderPage();
    expect(screen.getByText('store settings could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('tabs and the URL', () => {
  it.each(['store', 'notifications', 'shipping', 'administrators'])('links back to Settings from the %s section', tab => {
    renderPage(`/admin/settings?tab=${tab}`);
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/admin/settings');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/admin');
  });

  it('opens the tab named in ?tab= and falls back to Store for an unknown value', () => {
    const { unmount } = renderPage('/admin/settings?tab=shipping');
    expect(screen.getByRole('heading', { name: 'Shipping Settings' })).toBeInTheDocument();
    unmount();
    renderPage('/admin/settings?tab=unknown');
    expect(screen.getByRole('heading', { name: 'Store Information' })).toBeInTheDocument();
  });

  it('switching tabs writes the tab into the URL', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'Notifications' }));
    expect(await screen.findByRole('heading', { name: 'Notification Preferences' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/settings?tab=notifications');
  });

  it('the Administrators tab shows the team list in place, behind the access gate', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'Administrators' }));
    const team = await screen.findByTestId('team');
    expect(team).toHaveAttribute('data-embedded', 'true');
    expect(within(screen.getByTestId('gate')).getByTestId('team')).toBe(team);
    expect(screen.queryByRole('link', { name: 'Manage administrators' })).not.toBeInTheDocument();
  });

  it('opens straight on the team list from ?tab=administrators', () => {
    asAdministrator({ isOwner: false, canManageAdmins: true });
    renderPage('/admin/settings?tab=administrators');
    expect(screen.getByTestId('team')).toBeInTheDocument();
  });

  it('offers the Administrators section to an administrator manager who is not an Owner', () => {
    asAdministrator({ isOwner: false, canManageAdmins: true });
    renderPage();
    expect(screen.getByRole('tab', { name: 'Administrators' })).toBeInTheDocument();
  });

  it('hides the Administrators section from an administrator without management access, even via ?tab=administrators', () => {
    asAdministrator({ isOwner: false, canManageAdmins: false });
    renderPage('/admin/settings?tab=administrators');
    expect(screen.queryByRole('tab', { name: 'Administrators' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.queryByTestId('team')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Store Information' })).toBeInTheDocument();
  });

  it('keeps a direct ?tab=administrators link on its tab while permissions load', () => {
    vi.mocked(useAdminProfile).mockReturnValue({ data: undefined, isError: false } as unknown as ReturnType<typeof useAdminProfile>);
    renderPage('/admin/settings?tab=administrators');
    expect(screen.getByRole('tab', { name: 'Administrators' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('gate')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Store Information' })).not.toBeInTheDocument();
  });

  it('shows the Administrators tab while capabilities are still loading', () => {
    vi.mocked(useAdminProfile).mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useAdminProfile>);
    renderPage();
    expect(screen.getByRole('tab', { name: 'Administrators' })).toBeInTheDocument();
  });

  it('asks before leaving a tab with unsaved changes, and keeps them when the administrator cancels', async () => {
    const user = userEvent.setup();
    renderPage();
    setValue(screen.getByLabelText('Store name'), 'ElectroHub!');
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
    expect(screen.getByText('Save this section to keep your updates.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Notifications' }));

    const dialog = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Store Information' })).toBeInTheDocument();
    expect(screen.getByLabelText('Store name')).toHaveValue('ElectroHub!');

    await user.click(screen.getByRole('tab', { name: 'Notifications' }));
    const again = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });
    await user.click(within(again).getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByRole('heading', { name: 'Notification Preferences' })).toBeInTheDocument();
  });
});

describe('shipping section', () => {
  it('keeps the original shipping version when rates refetch during an edit', async () => {
    const page = renderPage('/admin/settings?tab=shipping');
    setValue(screen.getByLabelText('Express Shipping Rate ($)'), '12.00');
    vi.mocked(useShippingSettings).mockReturnValue(query({ ...shipping, version: 3 }) as unknown as Hook<typeof useShippingSettings>);
    page.refresh();
    submit('Save Shipping');
    await waitFor(() => expect(shippingSave).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 2 })));
  });
  it('shows the real method labels, estimates and rates, with the threshold off by default', () => {
    renderPage('/admin/settings?tab=shipping');
    expect(screen.getByLabelText('Standard Shipping Rate ($)')).toHaveValue('0.00');
    expect(screen.getByLabelText('Express Shipping Rate ($)')).toHaveValue('9.99');
    expect(screen.getByText('Express Delivery: 2-3 business days')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Enable free shipping for orders above threshold' })).not.toBeChecked();
    expect(screen.getByLabelText('Free Shipping Threshold ($)')).toBeDisabled();
  });

  it('saves a threshold and a rate change', async () => {
    const user = userEvent.setup();
    renderPage('/admin/settings?tab=shipping');

    await user.click(screen.getByRole('checkbox', { name: 'Enable free shipping for orders above threshold' }));
    setValue(screen.getByLabelText('Free Shipping Threshold ($)'), '50');
    setValue(screen.getByLabelText('Express Shipping Rate ($)'), '12.5');
    submit('Save Shipping');

    await waitFor(() => expect(shippingSave).toHaveBeenCalledWith({
      expectedVersion: 2,
      freeShippingThreshold: '50',
      methods: [
        { method: 'STANDARD', enabled: true, price: '0.00' },
        { method: 'EXPRESS', enabled: true, price: '12.5' },
        { method: 'OVERNIGHT', enabled: true, price: '19.99' },
      ],
    }));
  });

  it('sends a null threshold when the threshold option is turned off, and a disabled method as enabled false', async () => {
    const user = userEvent.setup();
    vi.mocked(useShippingSettings).mockReturnValue(query({ ...shipping, freeShippingThreshold: '75.00' }) as unknown as Hook<typeof useShippingSettings>);
    renderPage('/admin/settings?tab=shipping');
    expect(screen.getByLabelText('Free Shipping Threshold ($)')).toHaveValue('75.00');

    await user.click(screen.getByRole('checkbox', { name: 'Enable free shipping for orders above threshold' }));
    await user.click(screen.getByRole('checkbox', { name: 'Enable express delivery option' }));
    submit('Save Shipping');

    await waitFor(() => expect(shippingSave).toHaveBeenCalledWith(expect.objectContaining({ freeShippingThreshold: null })));
    expect(shippingSave.mock.calls[0]?.[0].methods[1]).toEqual({ method: 'EXPRESS', enabled: false, price: '9.99' });
  });

  it('places a server price error on the row it belongs to', async () => {
    shippingSave.mockRejectedValueOnce(new ApiError(400, 'Check', {
      error: { code: 'VALIDATION_ERROR', message: 'x', fields: [{ field: 'methods.1.price', message: 'Price must be at most 9999.99.' }] },
    }, 'VALIDATION_ERROR'));
    renderPage('/admin/settings?tab=shipping');

    setValue(screen.getByLabelText('Express Shipping Rate ($)'), '1');
    submit('Save Shipping');

    const message = await screen.findByText('Price must be at most 9999.99.');
    const row = message.closest('div');
    expect(row).toContainElement(screen.getByLabelText('Express Shipping Rate ($)'));
  });

  it('a shipping version conflict shows the banner and does not save again on its own', async () => {
    shippingSave.mockRejectedValueOnce(new ApiError(409, 'changed', { error: { code: 'VERSION_CONFLICT', message: 'changed' }, data: shipping }, 'VERSION_CONFLICT'));
    renderPage('/admin/settings?tab=shipping');

    setValue(screen.getByLabelText('Express Shipping Rate ($)'), '8');
    submit('Save Shipping');

    expect(await screen.findByText('These shipping settings changed elsewhere')).toBeInTheDocument();
    expect(shippingSave).toHaveBeenCalledTimes(1);
  });

  it('shows quotes only after a valid subtotal is checked, and only from the server result', async () => {
    vi.mocked(useShippingPreview).mockImplementation(subtotal => query(subtotal === '49.99' ? {
      subtotal: '49.99', currency: 'USD' as const, methods: [
        { id: 'STANDARD', label: 'Standard Delivery', price: '4.99', minDays: 5, maxDays: 7, estimate: '5-7 business days' },
      ],
    } : undefined) as unknown as Hook<typeof useShippingPreview>);
    renderPage('/admin/settings?tab=shipping');

    const check = screen.getByRole('button', { name: 'Check quotes' });
    expect(check).toBeDisabled();
    setValue(screen.getByLabelText('Cart subtotal ($)'), '49.99');
    submit('Check quotes');

    const list = await screen.findByRole('list', { name: 'Quotes for $49.99' });
    expect(within(list).getByText('$4.99')).toBeInTheDocument();
  });
});

describe('notifications section', () => {
  it('keeps the original notification version and hidden preference after a refetch', async () => {
    const page = renderPage('/admin/settings?tab=notifications');
    fireEvent.click(screen.getByRole('checkbox', { name: /Low stock alert/ }));
    vi.mocked(useNotificationPreferences).mockReturnValue(query({ ...preferences, version: 4, invitationAccepted: false }) as unknown as Hook<typeof useNotificationPreferences>);
    page.refresh();
    submit('Save Preferences');
    await waitFor(() => expect(prefsSave).toHaveBeenCalledWith({ expectedVersion: 3, orderPaid: true, lowStock: true, invitationAccepted: true }));
  });
  it('offers only the two alerts the server sends, and saves them with the expected version', async () => {
    const user = userEvent.setup();
    renderPage('/admin/settings?tab=notifications');
    expect(screen.getByRole('checkbox', { name: /New order received/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Low stock alert/ })).not.toBeChecked();
    expect(screen.queryByText(/maintenance/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/digest/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Low stock alert/ }));
    submit('Save Preferences');

    await waitFor(() => expect(prefsSave).toHaveBeenCalledWith({
      expectedVersion: 3, orderPaid: true, lowStock: true, invitationAccepted: true,
    }));
  });
});
