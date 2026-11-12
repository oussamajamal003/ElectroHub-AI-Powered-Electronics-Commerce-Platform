import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLayout } from './AdminLayout';
import { useAdminAuth } from '@/features/auth/context/AuthContext';
import { useAdminAlerts } from '@/features/admin/dashboard/api';
import { SIDEBAR_PREFERENCE_KEY } from '@/features/admin/shell/navigation';
import { ThemeProvider } from '@/features/theme';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAdminAuth: vi.fn() }));
vi.mock('@/features/admin/dashboard/api', () => ({ useAdminAlerts: vi.fn() }));
vi.mock('@/features/admin/dashboard/useAdminInventoryLiveUpdates', () => ({ useAdminInventoryLiveUpdates: vi.fn() }));
vi.mock('@/features/profilePhoto/queries', () => ({ useProfilePhoto: () => ({ data: undefined }) }));

const logout = vi.fn();
const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}>
  <Routes><Route element={<AdminLayout />}><Route path="/admin/*" element={<p>Page body</p>} /></Route></Routes>
</MemoryRouter>);

describe('AdminLayout shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(useAdminAuth).mockReturnValue({ user: { id: 'a', email: 'admin@example.test', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' }, logout } as unknown as ReturnType<typeof useAdminAuth>);
    vi.mocked(useAdminAlerts).mockReturnValue({ data: { data: { lowStock: 2, outOfStock: 1, awaitingFulfillment: 3, preparing: 0, outForDelivery: 4, generatedAt: '' } },
      isPending: false, isError: false } as unknown as ReturnType<typeof useAdminAlerts>);
  });

  it('lists only implemented modules (05.1 operations + 05.2 growth/administration) and marks the current one', () => {
    renderAt('/admin/inventory');
    const nav = screen.getByRole('navigation', { name: 'Admin navigation' });
    const labels = within(nav).getAllByRole('link').map(link => link.textContent);
    expect(labels).toEqual(['Dashboard', 'Products', 'Categories', 'Inventory', 'Orders', 'Delivery', 'Customers', 'Recommendations', 'Analytics', 'Settings']);
    // Personal account destinations live in the avatar menu, never in the main navigation.
    expect(within(nav).queryByText(/profile|security|sessions/i)).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Inventory' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('announces real alert counts without unread semantics', () => {
    renderAt('/admin');
    expect(screen.getByRole('button', { name: 'Alerts: 6 items need attention' })).toBeInTheDocument();
  });

  it('offers an explicit retry for a failed alerts request', async () => {
    const refetch = vi.fn();
    vi.mocked(useAdminAlerts).mockReturnValue({ isError: true, isPending: false, isFetching: false, refetch } as unknown as ReturnType<typeof useAdminAlerts>);
    renderAt('/admin');
    const trigger = screen.getByRole('button', { name: /^Alerts$/ });
    fireEvent.pointerDown(trigger); fireEvent.click(trigger);
    expect(await screen.findByRole('alert')).toHaveTextContent('Alerts could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry alerts' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('announces a successful zero-alert state', async () => {
    vi.mocked(useAdminAlerts).mockReturnValue({ data: { data: { lowStock: 0, outOfStock: 0, awaitingFulfillment: 0,
      preparing: 0, outForDelivery: 0, generatedAt: '' } }, isError: false, isPending: false } as unknown as ReturnType<typeof useAdminAlerts>);
    renderAt('/admin');
    const trigger = screen.getByRole('button', { name: 'Alerts: nothing needs attention' });
    fireEvent.pointerDown(trigger); fireEvent.click(trigger);
    expect(await screen.findByRole('status')).toHaveTextContent('No operational alerts need attention.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('remembers the collapsed sidebar and keeps accessible names on the icon rail', () => {
    renderAt('/admin');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY)).toBe('1');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('navigation', { name: 'Admin navigation' })).getByRole('link', { name: 'Orders' })).toBeInTheDocument();
  });

  it('opens another admin page at its top', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    renderAt('/admin/analytics');
    scrollTo.mockClear();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Admin navigation' })).getByRole('link', { name: 'Products' }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
    scrollTo.mockRestore();
  });

  const openSignOut = async () => {
    const trigger = screen.getByRole('button', { name: 'Account menu for Ada Admin' });
    expect(trigger).not.toHaveTextContent('Ada Admin'); // avatar only: the name lives in the menu
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }));
    return screen.findByRole('dialog', { name: 'Sign out of ElectroHub?' });
  };

  it('asks before signing out; Cancel keeps the session', async () => {
    renderAt('/admin');
    const dialog = await openSignOut();
    expect(within(dialog).getByText('Your admin session will end on this device.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(logout).not.toHaveBeenCalled();
  });

  it('signs out once through AuthContext after confirmation, ignoring repeated clicks', async () => {
    logout.mockImplementation(() => new Promise(() => undefined));
    renderAt('/admin');
    const dialog = await openSignOut();
    const confirm = within(dialog).getByRole('button', { name: 'Sign out' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });

  it('puts the collapse control on the MAIN heading row of the sidebar, not in the header', () => {
    renderAt('/admin');
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle.closest('aside')).not.toBeNull();
    expect(toggle.closest('header')).toBeNull();
    expect(toggle.parentElement).toHaveTextContent('Main');
  });

  it('styles rail links like expanded links (Tooltip trigger keeps the resolved class)', () => {
    window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, '1');
    renderAt('/admin/orders');
    const link = within(screen.getByRole('navigation', { name: 'Admin navigation' })).getByRole('link', { name: 'Orders' });
    expect(link.className).not.toMatch(/function|=>/);
    expect(link).toHaveAttribute('aria-current', 'page');
  });

  it('provides a skip link to the main content', () => {
    renderAt('/admin');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#admin-main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'admin-main');
  });

  it('offers the shared theme toggle in the admin header and switches the whole console (dark-mode task)', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    render(<ThemeProvider><MemoryRouter initialEntries={['/admin']}>
      <Routes><Route element={<AdminLayout />}><Route path="/admin/*" element={<p>Page body</p>} /></Route></Routes>
    </MemoryRouter></ThemeProvider>);
    const header = document.querySelector('[data-admin-header]') as HTMLElement;
    const toggle = within(header).getByRole('button', { name: 'Switch to dark mode' });
    fireEvent.click(toggle);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(within(header).getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
    expect(screen.getByText('Page body')).toBeInTheDocument();
    document.documentElement.removeAttribute('data-theme');
  });
});
