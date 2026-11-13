import { useLayoutEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigationType } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, Bell, ExternalLink, LogOut, PackageX, Truck, ClipboardList, UserRound, ShieldCheck, MonitorSmartphone } from 'lucide-react';
import { useAdminAuth } from '@/features/auth/context/AuthContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/DropdownMenu';
import { Tooltip } from '@/components/ui/Tooltip';
import { Button } from '@/components/ui/Button';
import { ThemeToggle } from '@/features/theme';
import { Avatar } from '@/components/ui/Avatar';
import { useProfilePhoto } from '@/features/profilePhoto/queries';
import { useAcknowledgeAdminAlerts, useAdminAlerts } from '@/features/admin/dashboard/api';
import { useAdminInventoryLiveUpdates } from '@/features/admin/dashboard/useAdminInventoryLiveUpdates';
import { AdminToastProvider, ConfirmDialog } from '@/features/admin/shared/AdminUi';
import { formatCount, initials } from '@/features/admin/shared/format';
import styles from './AdminLayout.module.scss';
import { AdminShellFrame } from './AdminShellFrame';
import { usePageTitle } from './usePageTitle';
import { BRAND_TITLE } from '@/lib/pageTitle';

function AlertsMenu() {
  const alerts = useAdminAlerts();
  const acknowledge = useAcknowledgeAdminAlerts();
  const data = alerts.data?.data;
  // Unread is the server's per-administrator remainder; the operational counts below it stay visible as read history.
  const unread = data?.unread ?? { lowStock: 0, outOfStock: 0, awaitingFulfillment: 0, total: 0 };
  // Opening the menu acknowledges what is displayed. The "new" markers shown while it is open come from this snapshot, so they do not
  // vanish under the administrator's eyes the moment the badge clears.
  const [shownUnread, setShownUnread] = useState<typeof unread | null>(null);
  const attention = data ? data.lowStock + data.outOfStock + data.awaitingFulfillment : 0;
  const entries = data ? [
    { key: 'outOfStock', to: '/admin/inventory?status=OUT_OF_STOCK', icon: PackageX, label: 'Out of stock', count: data.outOfStock, unread: (shownUnread ?? unread).outOfStock, tone: styles.alertError },
    { key: 'lowStock', to: '/admin/inventory?status=LOW_STOCK', icon: AlertTriangle, label: 'Low stock', count: data.lowStock, unread: (shownUnread ?? unread).lowStock, tone: styles.alertWarning },
    { key: 'awaitingFulfillment', to: '/admin/orders?status=CONFIRMED&payment=PAID', icon: ClipboardList, label: 'Paid orders awaiting fulfillment', count: data.awaitingFulfillment, unread: (shownUnread ?? unread).awaitingFulfillment, tone: styles.alertInfo },
    { key: 'outForDelivery', to: '/admin/deliveries?status=OUT_FOR_DELIVERY', icon: Truck, label: 'Out for delivery', count: data.outForDelivery, unread: 0, tone: styles.alertNeutral },
  ] : [];
  const label = data ? (unread.total ? `Alerts: ${unread.total} unread` : attention ? `Alerts: no unread, ${attention} items need attention` : 'Alerts: nothing needs attention') : 'Alerts';
  const onOpenChange = (open: boolean) => {
    if (!open) { setShownUnread(null); return; }
    setShownUnread(unread);
    if (data && unread.total > 0 && !acknowledge.isPending) acknowledge.mutate({ lowStock: data.lowStock, outOfStock: data.outOfStock, awaitingFulfillment: data.awaitingFulfillment });
  };
  return <DropdownMenu onOpenChange={onOpenChange}>
    <Tooltip content="Operational alerts">
      <DropdownMenuTrigger asChild>
        <button type="button" className={styles.iconButton} aria-label={label}>
          <Bell aria-hidden="true" />
          {unread.total > 0 && <span className={styles.badge} aria-hidden="true">{unread.total > 99 ? '99+' : unread.total}</span>}
        </button>
      </DropdownMenuTrigger>
    </Tooltip>
    <DropdownMenuContent align="end" sideOffset={8} className={`${styles.menu} ${styles.animatedMenu}`}>
      <DropdownMenuLabel className={styles.menuLabel}>Operational alerts</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {alerts.isPending && <p className={styles.menuNote} role="status">Loading alerts…</p>}
      {alerts.isError && !data && <div className={styles.menuNote} role="alert">
        <p>Alerts could not be loaded.</p>
        <Button type="button" variant="outline" size="small" disabled={alerts.isFetching} onClick={() => void alerts.refetch()}>Retry alerts</Button>
      </div>}
      {acknowledge.isError && <p className={styles.menuNote} role="alert">Alerts could not be marked as read. They will stay unread until you try again.</p>}
      {data && entries.every(entry => entry.count === 0) && <p className={styles.menuNote} role="status">No operational alerts need attention.</p>}
      {entries.map(entry => <DropdownMenuItem key={entry.key} asChild>
        <Link to={entry.to} className={styles.alertItem}>
          <span className={clsx(styles.alertIcon, entry.tone)} aria-hidden="true"><entry.icon /></span>
          <span className={styles.alertText}>{entry.label}{entry.unread > 0 && <span className={styles.newMarker}> · {entry.unread} new</span>}</span>
          <span className={styles.alertCount}>{formatCount(entry.count)}</span>
        </Link>
      </DropdownMenuItem>)}
      {data && <DropdownMenuSeparator />}
      {data && <DropdownMenuItem asChild>
        <Link to="/admin" className={styles.seeAll}>See all alerts</Link>
      </DropdownMenuItem>}
      {data && <p className={styles.menuFoot}>Live counts from orders and inventory. Reading alerts clears the unread badge; the counts clear only when the work is done.</p>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** Avatar-only trigger; the name, email and actions live in the menu. Sign out asks first, then uses the existing AuthContext logout. */
function ProfileMenu() {
  const { user, logout, isSessionVerified } = useAdminAuth();
  const profilePhoto = useProfilePhoto('admin', user?.id, isSessionVerified);
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const name = user ? `${user.firstName} ${user.lastName}`.trim() : '';
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    // logout() always ends the local session (tokens and cached admin data are cleared even if the server call fails); the protected
    // route then redirects to /admin/login. Reset only matters if this component is still mounted.
    try { await logout(); } finally { setSigningOut(false); }
  };
  return <>
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" className={styles.profileButton} aria-label={`Account menu for ${name || 'administrator'}`}>
        <Avatar src={profilePhoto.data?.url ?? undefined} initials={initials(name, 'A')} className={styles.avatar} aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={8} className={`${styles.menu} ${styles.animatedMenu}`}>
      <DropdownMenuLabel className={styles.profileLabel}>
        <strong>{name || 'Administrator'}</strong>
        {user?.email && <span>{user.email}</span>}
        <span className={styles.rolePill}>Administrator</span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {/* Task 05.2 personal account destinations (per administrator; store-wide configuration lives under Settings). */}
      <DropdownMenuItem asChild>
        <Link to="/admin/profile" className={styles.menuLink}><UserRound aria-hidden="true" /> My profile</Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/admin/profile/security" className={styles.menuLink}><ShieldCheck aria-hidden="true" /> Security</Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/admin/profile/sessions" className={styles.menuLink}><MonitorSmartphone aria-hidden="true" /> Sessions &amp; login history</Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <a href="/" target="_blank" rel="noopener noreferrer" className={styles.menuLink}><ExternalLink aria-hidden="true" /> View storefront</a>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)} className={styles.menuLink}>
        <LogOut aria-hidden="true" /> Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
  <ConfirmDialog open={confirming} onOpenChange={setConfirming} pending={signingOut} destructive title="Sign out of ElectroHub?"
    confirmLabel="Sign out" onConfirm={() => { void signOut(); }} description={<p>Your admin session will end on this device.</p>} />
  </>;
}

export function AdminLayout() {
  usePageTitle('admin-main', BRAND_TITLE, 'Admin');
  const location = useLocation();
  useAdminInventoryLiveUpdates();

  // Opening another admin page (a link, a drill-down, the sidebar) starts at its top. Back/forward keep the browser's position, and
  // query-only changes on the same page (filters, pager) are left to the page itself.
  const navigationType = useNavigationType();
  useLayoutEffect(() => {
    if (navigationType !== 'POP') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return <AdminToastProvider>
    <AdminShellFrame headerEnd={<>
      <ThemeToggle className={styles.iconButton} />
      <AlertsMenu />
      <ProfileMenu />
    </>}>
      <Outlet />
    </AdminShellFrame>
  </AdminToastProvider>;
}
