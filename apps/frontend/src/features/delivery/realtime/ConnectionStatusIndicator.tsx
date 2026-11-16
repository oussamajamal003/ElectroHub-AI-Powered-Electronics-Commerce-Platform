import { Check, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { LiveState } from './useDeliveryLiveUpdates';
import styles from './ConnectionStatusIndicator.module.scss';

/**
 * Task 04.7 ConnectionStatusIndicator (handoff §9.3, design artifact). Icon + word pills; "Live" means only that the subscription is open,
 * never that GPS is live. The first connection is quiet (REST data is already showing). Banners are visual only: the page's single polite
 * live region carries the paused/restored announcements.
 */
const PILL: Partial<Record<LiveState, { icon: typeof Wifi; label: string; tone: string }>> = {
  connected: { icon: Wifi, label: 'Live updates on', tone: 'info' },
  reconnecting: { icon: RefreshCw, label: 'Reconnecting…', tone: 'warning' },
  paused: { icon: WifiOff, label: 'Live updates paused', tone: 'neutral' },
  resynced: { icon: Check, label: 'Back online · up to date', tone: 'success' },
  stopped: { icon: WifiOff, label: 'Updates stopped (delivered)', tone: 'neutral' },
};

export function ConnectionStatusPill({ state }: { state: LiveState }) {
  const pill = PILL[state];
  if (!pill) return null;
  const Icon = pill.icon;
  return <span className={`${styles.pill} ${styles[pill.tone]}`} data-live-state={state}><Icon aria-hidden="true" />{pill.label}</span>;
}

export function ConnectionStatusBanner({ state, lastSaved, onRefresh, refreshing }: { state: LiveState; lastSaved: string | null; onRefresh: () => void;
  refreshing: boolean }) {
  if (state === 'paused') return <div className={`${styles.banner} ${styles.neutral}`}>
    <WifiOff aria-hidden="true" className={styles.bannerIcon} />
    <p><strong>Live updates paused</strong>{lastSaved ? `Showing the last saved status from ${lastSaved}.` : 'Showing the last saved status.'} We will
      refresh automatically when the connection returns.</p>
    <Button type="button" variant="outline" size="large" onClick={onRefresh} isLoading={refreshing} disabled={refreshing} className={styles.refresh}>
      <RefreshCw aria-hidden="true" />Refresh now</Button>
  </div>;
  if (state === 'reconnecting') return <div className={`${styles.banner} ${styles.warning}`}>
    <RefreshCw aria-hidden="true" className={styles.bannerIcon} /><p><strong>Reconnecting…</strong>Showing the last saved status while we reconnect.</p></div>;
  if (state === 'resynced') return <div className={`${styles.banner} ${styles.success}`}>
    <Check aria-hidden="true" className={styles.bannerIcon} /><p><strong>Back online</strong>Tracking is up to date.</p></div>;
  return null;
}
