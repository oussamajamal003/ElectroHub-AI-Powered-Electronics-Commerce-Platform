import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useMatch } from 'react-router-dom';
import clsx from 'clsx';
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/Drawer';
import { Tooltip } from '@/components/ui/Tooltip';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { Skeleton } from '@/components/ui/Skeleton';
import { ThemeToggle } from '@/features/theme';
import { ADMIN_NAVIGATION, SIDEBAR_PREFERENCE_KEY, type AdminNavItem } from '@/features/admin/shell/navigation';
import styles from './AdminLayout.module.scss';

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

/**
 * The admin console frame: header, sidebar, mobile drawer and main region. It holds no administrator data (no identity, alerts, live
 * updates or photo), so the same frame can be painted while the administrator session is still being restored.
 */
export function AdminShellFrame({ headerEnd, children }: { headerEnd: ReactNode; children: ReactNode }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, collapsed ? '1' : '0'); } catch { /* preference only */ }
  }, [collapsed]);
  // A navigation (including back/forward) always closes the mobile drawer.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  return <div className={clsx(styles.shell, collapsed && styles.shellCollapsed)}>
    <a href="#admin-main" tabIndex={0} className={styles.skipLink}>Skip to content</a>
    <header className={styles.header} data-admin-header>
      <div className={styles.headerStart}>
        <Tooltip content="Open navigation menu">
        <button type="button" className={clsx(styles.iconButton, styles.menuButton)} onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation" aria-expanded={drawerOpen} aria-controls="admin-drawer">
          <Menu aria-hidden="true" />
        </button>
        </Tooltip>
        <Link to="/admin" className={styles.brand} aria-label="ElectroHub admin — Dashboard">
          <BrandLogo />
          <span className={styles.adminPill}>Admin</span>
        </Link>
      </div>
      <div className={styles.headerEnd}>{headerEnd}</div>
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
      {children}
    </main>
  </div>;
}

/**
 * Session restore inside the real console frame. The alerts and account controls are neutral placeholders: nothing that needs the
 * administrator session (identity, photo, alerts, live inventory updates) is requested or painted until the session is verified.
 */
export function AdminSessionRestoreShell({ children }: { children: ReactNode }) {
  return <AdminShellFrame headerEnd={<>
    <ThemeToggle className={styles.iconButton} />
    <span className={styles.iconButton} data-admin-header-placeholder="alerts" aria-hidden="true"><Skeleton variant="circular" width={20} height={20} /></span>
    <span className={styles.profileButton} data-admin-header-placeholder="account" aria-hidden="true"><Skeleton variant="circular" className={styles.avatar} /></span>
  </>}>{children}</AdminShellFrame>;
}
