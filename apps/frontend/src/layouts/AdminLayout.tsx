import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigationType } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, Bell, ExternalLink, LogOut, Menu, PackageX, PanelLeftClose, PanelLeftOpen, Truck, ClipboardList, UserRound, ShieldCheck, MonitorSmartphone } from 'lucide-react';
import { useAdminAuth } from '@/features/auth/context/AuthContext';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/Drawer';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/DropdownMenu';
import { Tooltip } from '@/components/ui/Tooltip';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { Avatar } from '@/components/ui/Avatar';
import { useProfilePhoto } from '@/features/profilePhoto/queries';
import { ADMIN_NAVIGATION, SIDEBAR_PREFERENCE_KEY, type AdminNavItem } from '@/features/admin/shell/navigation';
import { useAdminAlerts } from '@/features/admin/dashboard/api';
import { useAdminInventoryLiveUpdates } from '@/features/admin/dashboard/useAdminInventoryLiveUpdates';
import { AdminToastProvider, ConfirmDialog } from '@/features/admin/shared/AdminUi';
import { formatCount, initials } from '@/features/admin/shared/format';
import styles from './AdminLayout.module.scss';
import { usePageTitle } from './usePageTitle';

function readCollapsed() {
  try { return window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY) === '1'; } catch { return false; }
}

// The class is resolved here, not through NavLink's className callback: the rail wraps links in a Radix Tooltip trigger, whose Slot
// merges class names as strings and would turn a callback into an unusable string (the unstyled, cramped rail seen before).
function NavItem({ item, collapsed, onNavigate }: { item: AdminNavItem; collapsed?: boolean; onNavigate?: () => void }) {
  const active = Boolean(useMatch({ path: item.to, end: Boolean(item.end) }));
  const Icon = item.icon;
  const link = <NavLink to={item.to} end={item.end} onClick={onNavigate} aria-label={collapsed ? item.label : undefined}
    className={clsx(styles.navLink, active && styles.navLinkActive)}>
    <Icon className={styles.navIcon} aria-hidden="true" />
    {!collapsed && <span>{item.label}</span>}
  </NavLink>;
  return <li>{collapsed ? <Tooltip content={item.label} side="right" sideOffset={10}>{link}</Tooltip> : link}</li>;
}

/** `onToggle` (desktop sidebar only) puts the collapse control on the first section's heading row. */
function Navigation({ collapsed, onNavigate, onToggle }: { collapsed?: boolean; onNavigate?: () => void; onToggle?: () => void }) {
  return <nav className={styles.nav} aria-label="Admin navigation">
    {ADMIN_NAVIGATION.map((section, index) => <div key={section.label} className={styles.navSection}>
      <div className={clsx(styles.navHeadingRow, collapsed && styles.navHeadingRowCollapsed)}>
        <p className={clsx(styles.navHeading, collapsed && styles.visuallyHidden)}>{section.label}</p>
        {index === 0 && onToggle && <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right" sideOffset={10}>
          <button type="button" className={styles.collapseButton} onClick={onToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={collapsed}>
            {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </button>
        </Tooltip>}
      </div>
      <ul className={styles.navList}>
        {section.items.map(item => <NavItem key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />)}
      </ul>
    </div>)}
  </nav>;
}

function AlertsMenu() {
  const alerts = useAdminAlerts();
  const data = alerts.data?.data;
  const attention = data ? data.lowStock + data.outOfStock + data.awaitingFulfillment : 0;
  const entries = data ? [
    { to: '/admin/inventory?status=OUT_OF_STOCK', icon: PackageX, label: 'Out of stock', count: data.outOfStock, tone: styles.alertError },
    { to: '/admin/inventory?status=LOW_STOCK', icon: AlertTriangle, label: 'Low stock', count: data.lowStock, tone: styles.alertWarning },
    { to: '/admin/orders?status=CONFIRMED&payment=PAID', icon: ClipboardList, label: 'Paid orders awaiting fulfillment', count: data.awaitingFulfillment, tone: styles.alertInfo },
    { to: '/admin/deliveries?status=OUT_FOR_DELIVERY', icon: Truck, label: 'Out for delivery', count: data.outForDelivery, tone: styles.alertNeutral },
  ] : [];
  const label = data ? (attention ? `Alerts: ${attention} items need attention` : 'Alerts: nothing needs attention') : 'Alerts';
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" className={styles.iconButton} aria-label={label}>
        <Bell aria-hidden="true" />
        {attention > 0 && <span className={styles.badge} aria-hidden="true">{attention > 99 ? '99+' : attention}</span>}
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={8} className={`${styles.menu} ${styles.animatedMenu}`}>
      <DropdownMenuLabel className={styles.menuLabel}>Operational alerts</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {alerts.isPending && <p className={styles.menuNote} role="status">Loading alerts…</p>}
      {alerts.isError && !data && <p className={styles.menuNote} role="alert">Alerts could not be loaded.</p>}
      {entries.map(entry => <DropdownMenuItem key={entry.label} asChild>
        <Link to={entry.to} className={styles.alertItem}>
          <span className={clsx(styles.alertIcon, entry.tone)} aria-hidden="true"><entry.icon /></span>
          <span className={styles.alertText}>{entry.label}</span>
          <span className={styles.alertCount}>{formatCount(entry.count)}</span>
        </Link>
      </DropdownMenuItem>)}
      {data && <p className={styles.menuFoot}>Live counts from orders and inventory. Refreshed every minute.</p>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** Avatar-only trigger; the name, email and actions live in the menu. Sign out asks first, then uses the existing AuthContext logout. */
function ProfileMenu() {
  const { user, logout } = useAdminAuth();
  const profilePhoto = useProfilePhoto('admin', user?.id);
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
  usePageTitle('admin-main', 'ElectroHub Admin');
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useAdminInventoryLiveUpdates();

  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, collapsed ? '1' : '0'); } catch { /* preference only */ }
  }, [collapsed]);
  // A navigation (including back/forward) always closes the mobile drawer.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  // Opening another admin page (a link, a drill-down, the sidebar) starts at its top. Back/forward keep the browser's position, and
  // query-only changes on the same page (filters, pager) are left to the page itself.
  const navigationType = useNavigationType();
  useLayoutEffect(() => {
    if (navigationType !== 'POP') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return <AdminToastProvider>
    <div className={clsx(styles.shell, collapsed && styles.shellCollapsed)}>
      <a href="#admin-main" tabIndex={0} className={styles.skipLink}>Skip to content</a>
      <header className={styles.header} data-admin-header>
        <div className={styles.headerStart}>
          <button type="button" className={clsx(styles.iconButton, styles.menuButton)} onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation" aria-expanded={drawerOpen} aria-controls="admin-drawer">
            <Menu aria-hidden="true" />
          </button>
          <Link to="/admin" className={styles.brand} aria-label="ElectroHub admin — Dashboard">
            <BrandLogo />
            <span className={styles.adminPill}>Admin</span>
          </Link>
        </div>
        <div className={styles.headerEnd}>
          <AlertsMenu />
          <ProfileMenu />
        </div>
      </header>

      <aside className={styles.sidebar} aria-label="Sidebar">
        <Navigation collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} />
      </aside>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent id="admin-drawer" className={styles.drawer}>
          <DrawerTitle className={styles.drawerTitle}>ElectroHub Admin</DrawerTitle>
          <DrawerDescription className={styles.visuallyHidden}>Admin console navigation</DrawerDescription>
          <Navigation onNavigate={() => setDrawerOpen(false)} />
        </DrawerContent>
      </Drawer>

      <main id="admin-main" className={styles.main} tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  </AdminToastProvider>;
}
