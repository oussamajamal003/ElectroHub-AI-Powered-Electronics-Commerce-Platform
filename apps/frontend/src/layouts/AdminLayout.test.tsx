import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLayout } from './AdminLayout';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useAdminAlerts } from '@/features/admin/dashboard/api';
import { SIDEBAR_PREFERENCE_KEY } from '@/features/admin/shell/navigation';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/admin/dashboard/api', () => ({ useAdminAlerts: vi.fn() }));

const logout = vi.fn();
const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}>
  <Routes><Route element={<AdminLayout />}><Route path="/admin/*" element={<p>Page body</p>} /></Route></Routes>
</MemoryRouter>);

describe('AdminLayout shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'a', email: 'admin@example.test', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' }, logout } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useAdminAlerts).mockReturnValue({ data: { data: { lowStock: 2, outOfStock: 1, awaitingFulfillment: 3, preparing: 0, outForDelivery: 4, generatedAt: '' } },
      isPending: false, isError: false } as unknown as ReturnType<typeof useAdminAlerts>);
  });

  it('lists only implemented 05.1 modules and marks the current one', () => {
    renderAt('/admin/inventory');
    const nav = screen.getByRole('navigation', { name: 'Admin navigation' });
    const labels = within(nav).getAllByRole('link').map(link => link.textContent);
    expect(labels).toEqual(['Dashboard', 'Products', 'Categories', 'Inventory', 'Orders', 'Delivery', 'Customers']);
    expect(within(nav).queryByText(/analytics|settings/i)).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Inventory' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('announces real alert counts without unread semantics', () => {
    renderAt('/admin');
    expect(screen.getByRole('button', { name: 'Alerts: 6 items need attention' })).toBeInTheDocument();
  });

  it('remembers the collapsed sidebar and keeps accessible names on the icon rail', () => {
    renderAt('/admin');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY)).toBe('1');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('navigation', { name: 'Admin navigation' })).getByRole('link', { name: 'Orders' })).toBeInTheDocument();
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
});
