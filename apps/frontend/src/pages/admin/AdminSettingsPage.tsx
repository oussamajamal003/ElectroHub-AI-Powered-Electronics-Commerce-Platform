import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Bell, Store, Truck, Users } from 'lucide-react';
import { ConfirmDialog, ButtonLink, PageHeader, QueryProblem } from '@/features/admin/shared/AdminUi';
import { useUnsavedChangesGuard } from '@/features/admin/shared/useUnsavedChangesGuard';
import styles from '@/features/admin/shared/AdminPages.module.scss';
import pageStyles from './AdminSettingsPage.module.scss';
import { StoreSettingsForm } from '@/features/admin/settings/components/StoreSettingsForm';
import { NotificationPreferencesForm } from '@/features/admin/settings/components/NotificationPreferencesForm';
import { ShippingSettingsForm } from '@/features/admin/settings/components/ShippingSettingsForm';
import { ShippingPreviewPanel } from '@/features/admin/settings/components/ShippingPreviewPanel';
import { SettingsSkeleton } from '@/features/admin/settings/components/SettingsSkeleton';
import {
  adminSettingsKeys, useNotificationPreferences, useShippingSettings, useStoreSettings,
} from '@/features/admin/settings/api';
import { useAdminProfile } from '@/features/admin/security/api';
import { canAccessAdministrators } from '@/features/admin/security/administratorsAccess';

/** Tab ids are part of the URL (`/admin/settings?tab=shipping`); an unknown or missing value opens Store. */
const TABS = ['store', 'notifications', 'shipping', 'administrators'] as const;
type Tab = (typeof TABS)[number];
const parseTab = (value: string | null): Tab => TABS.find(tab => tab === value) ?? 'store';

const TAB_LABEL: Record<Tab, string> = { store: 'Store', notifications: 'Notifications', shipping: 'Shipping', administrators: 'Administrators' };
const TAB_ICON = { store: Store, notifications: Bell, shipping: Truck, administrators: Users };

interface TabProps {
  /** Changes when the form must start again from saved values (after a save or a reload). */
  generation: number;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onReload: () => Promise<void>;
}

function StoreTab({ generation, onDirtyChange, onSaved, onReload }: TabProps) {
  const query = useStoreSettings();
  if (query.isPending) return <SettingsSkeleton section="store" />;
  if (!query.data) return <QueryProblem error={query.error} hasData={false} onRetry={() => void query.refetch()} retrying={query.isFetching} what="store settings" />;
  return <section className={styles.panel} aria-labelledby="store-settings-title">
    <h2 id="store-settings-title" className={styles.panelTitle}>Store Information</h2>
    <p className={styles.panelHint}>Manage the details customers use to identify and contact your store.</p>
    <StoreSettingsForm key={generation} profile={query.data} onDirtyChange={onDirtyChange} onSaved={onSaved} onReload={onReload} />
  </section>;
}

function NotificationsTab({ generation, onDirtyChange, onSaved, onReload }: TabProps) {
  const query = useNotificationPreferences();
  if (query.isPending) return <SettingsSkeleton section="notifications" />;
  if (!query.data) return <QueryProblem error={query.error} hasData={false} onRetry={() => void query.refetch()} retrying={query.isFetching} what="notification preferences" />;
  return <section className={styles.panel} aria-labelledby="notification-settings-title">
    <h2 id="notification-settings-title" className={styles.panelTitle}>Notification Preferences</h2>
    <p className={styles.panelHint}>Choose which operational updates you receive by email.</p>
    <NotificationPreferencesForm key={generation} preferences={query.data} onDirtyChange={onDirtyChange} onSaved={onSaved} onReload={onReload} />
  </section>;
}

function ShippingTab({ generation, onDirtyChange, onSaved, onReload }: TabProps) {
  const query = useShippingSettings();
  if (query.isPending) return <SettingsSkeleton section="shipping" />;
  if (!query.data) return <QueryProblem error={query.error} hasData={false} onRetry={() => void query.refetch()} retrying={query.isFetching} what="shipping settings" />;
  return <div className={pageStyles.stack}>
    <section className={styles.panel} aria-labelledby="shipping-settings-title">
      <h2 id="shipping-settings-title" className={styles.panelTitle}>Shipping Settings</h2>
      <p className={styles.panelHint}>Set delivery rates and the options available at checkout.</p>
      <ShippingSettingsForm key={generation} view={query.data} onDirtyChange={onDirtyChange} onSaved={onSaved} onReload={onReload} />
    </section>
    <ShippingPreviewPanel />
  </div>;
}

function AdministratorsTab() {
  return <section className={styles.panel} aria-labelledby="administrators-title">
    <h2 id="administrators-title" className={styles.panelTitle}>Administrators</h2>
    <p className={styles.panelHint}>Manage administrator accounts and invitations on the team page.</p>
    <div>
      <ButtonLink to="/admin/settings/administrators" variant="outline">Manage administrators</ButtonLink>
    </div>
  </section>;
}

export function AdminSettingsPage() {
  const [params, setParams] = useSearchParams();
  // The Administrators section is offered only to Owners and administrator managers (the team page enforces the same rule).
  const canSeeAdministrators = canAccessAdministrators(useAdminProfile().data?.capabilities);
  const tabs = TABS.filter(tab => tab !== 'administrators' || canSeeAdministrators);
  const requested = parseTab(params.get('tab'));
  const active: Tab = tabs.includes(requested) ? requested : 'store';
  const client = useQueryClient();
  const [dirty, setDirty] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);
  const guard = useUnsavedChangesGuard(dirty);

  // Stable so the forms' effects do not re-run on every render of this page.
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);
  const bump = useCallback(() => setGeneration(current => current + 1), []);

  /** Refetches one query, then remounts its form from the fresh values (local edits are discarded by the administrator's choice). */
  const reloadKey = useCallback(async (key: readonly unknown[]) => {
    await client.refetchQueries({ queryKey: key, exact: true }, { throwOnError: true });
    bump();
  }, [client, bump]);

  const switchTab = (tab: Tab) => {
    setDirty(false);
    setPendingTab(null);
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('tab', tab);
      return next;
    });
  };

  const requestTab = (value: string) => {
    const tab = parseTab(value);
    if (tab === active) return;
    if (dirty) setPendingTab(tab);
    else switchTab(tab);
  };

  // A tab's form reloads its own query; the tab knows which key that is.
  const reloadFor = (tab: Tab) => () => reloadKey(
    tab === 'store' ? adminSettingsKeys.store : tab === 'shipping' ? adminSettingsKeys.shipping : adminSettingsKeys.preferences,
  );

  const common = { generation, onDirtyChange, onSaved: bump };

  return <div className={styles.page}>
    <PageHeader title="Settings" description="Store details, notification preferences and shipping rates." />
    <Tabs value={active} onValueChange={requestTab}>
      <TabsList aria-label="Settings sections" className={pageStyles.tabs}>
        {tabs.map(tab => { const Icon = TAB_ICON[tab]; return <TabsTrigger key={tab} value={tab}><Icon size={16} aria-hidden="true" />{TAB_LABEL[tab]}</TabsTrigger>; })}
      </TabsList>
      {dirty && <p className={pageStyles.dirty} role="status">You have unsaved changes.</p>}
      <TabsContent value="store">
        <StoreTab {...common} onReload={reloadFor('store')} />
      </TabsContent>
      <TabsContent value="notifications">
        <NotificationsTab {...common} onReload={reloadFor('notifications')} />
      </TabsContent>
      <TabsContent value="shipping">
        <ShippingTab {...common} onReload={reloadFor('shipping')} />
      </TabsContent>
      {canSeeAdministrators && <TabsContent value="administrators">
        <AdministratorsTab />
      </TabsContent>}
    </Tabs>

    <ConfirmDialog open={pendingTab !== null} onOpenChange={open => { if (!open) setPendingTab(null); }} title="Discard unsaved changes?"
      description="Switching sections discards the changes you have not saved." confirmLabel="Discard changes" destructive
      onConfirm={() => { if (pendingTab) switchTab(pendingTab); }} />
    <ConfirmDialog {...guard.dialog} title="Leave without saving?" description="Your unsaved settings changes will be lost."
      confirmLabel="Leave page" destructive />
  </div>;
}
