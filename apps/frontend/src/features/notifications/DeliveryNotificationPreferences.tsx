import { useCallback, useEffect, useState } from 'react';
import { BellRing, Truck } from 'lucide-react';
import clsx from 'clsx';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { enablePush, disablePush, pushStatus, pushSupported } from './pushClient';
import styles from './DeliveryNotificationPreferences.module.scss';

/**
 * What the customer can do right now, decided from the server's answer and this browser's own permission.
 * `unknown` is a failed lookup: nothing is claimed about availability until a check succeeds.
 */
type Availability = 'checking' | 'enabled' | 'ready' | 'blocked' | 'unavailable' | 'unknown';

const BADGES: Partial<Record<Availability, { label: string; tone: string | undefined }>> = {
  enabled: { label: 'On', tone: styles.badgeEnabled },
  ready: { label: 'Available', tone: styles.badgeReady },
  blocked: { label: 'Blocked in browser', tone: styles.badgeUnavailable },
  unavailable: { label: 'Unavailable', tone: styles.badgeUnavailable },
};

const browserBlocked = () => typeof Notification !== 'undefined' && Notification.permission === 'denied';

export function DeliveryNotificationPreferences({ userId }: { userId: string }) {
  const supported = pushSupported();
  const [availability, setAvailability] = useState<Availability>('checking');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  /** `announce` is set only for a check the customer asked for, so the result is spoken and visible even when nothing changed. */
  const refresh = useCallback(async (announce = false) => {
    setAvailability('checking');
    setError(false);
    setMessage('');
    try {
      const state = await pushStatus(userId);
      const next: Availability = state.enabled ? 'enabled' : !state.available ? 'unavailable' : browserBlocked() ? 'blocked' : 'ready';
      setAvailability(next);
      if (announce) setMessage(next === 'unavailable' ? 'Checked just now: browser alerts are still unavailable.'
        : next === 'blocked' ? 'Checked just now: this browser is still blocking notifications.'
          : next === 'enabled' ? 'Checked just now: delivery notifications are on for this browser.'
            : 'Checked just now: browser alerts are available. You can turn them on.');
    } catch {
      setAvailability('unknown');
      setError(true);
      setMessage('We could not check your notification settings. Check your connection and try again.');
    }
  }, [userId]);

  useEffect(() => {
    // Reading the current state never asks for permission: the browser prompt opens only from the Enable button below.
    if (supported) void refresh();
  }, [refresh, supported]);

  const change = async () => {
    const turningOff = availability === 'enabled';
    setBusy(true);
    setError(false);
    setMessage('');
    try {
      if (turningOff) await disablePush(userId);
      else await enablePush(userId);
      setAvailability(turningOff ? 'ready' : 'enabled');
      setMessage(turningOff ? 'Delivery notifications are off for this browser.' : 'Delivery notifications are on for this browser.');
    } catch (failure) {
      setError(true);
      setMessage(failure instanceof Error ? failure.message : 'We could not update your notification settings. Please try again.');
      if (browserBlocked()) setAvailability('blocked');
    } finally {
      setBusy(false);
    }
  };

  const checking = availability === 'checking';
  const enabled = availability === 'enabled';
  const badge = supported ? BADGES[availability] : { label: 'Not supported here', tone: styles.badgeUnavailable };
  // The server decides availability: the control stays disabled until it reports that push can be delivered.
  const canChange = enabled || availability === 'ready' || availability === 'blocked';

  return <section className={styles.card} aria-labelledby="delivery-notifications-title">
    <div className={styles.header}>
      <span className={styles.icon} aria-hidden="true"><BellRing /></span>
      <div className={styles.heading}>
        <div className={styles.titleRow}>
          <h2 id="delivery-notifications-title">Delivery Notifications</h2>
          {badge && <span className={clsx(styles.badge, badge.tone)}>
            <span className={styles.badgeDot} aria-hidden="true" />
            {badge.label}
          </span>}
        </div>
        <p className={styles.subtitle}>Know the moment your order is out for delivery.</p>
      </div>
    </div>

    <div className={styles.content}>
      <div className={styles.explainer}>
        <span className={styles.previewIcon} aria-hidden="true"><Truck /></span>
        <div>
          <p className={styles.explainerTitle}>An alert on this device, even when ElectroHub is closed</p>
          <p>Your browser shows a notification when your order leaves for delivery. Order emails are sent separately and do not depend on this setting.</p>
        </div>
      </div>

      {!supported ? <div className={clsx(styles.notice, styles.noticeUnavailable)} role="status">
        <p><strong>This browser cannot show delivery alerts here.</strong> Use an up-to-date browser on a secure (https) page. On iPhone or iPad, add ElectroHub to your Home Screen first.</p>
      </div> : <>
        {availability === 'unavailable' && <div className={clsx(styles.notice, styles.noticeUnavailable)} role="status">
          <p><strong>Browser alerts are not available right now.</strong> Nothing is wrong with your account or this browser, and you will still get order updates by email. You can check again in a moment.</p>
        </div>}
        {availability === 'blocked' && <div className={clsx(styles.notice, styles.noticeUnavailable)} role="status">
          <p><strong>This browser is blocking notifications for ElectroHub.</strong> Allow notifications for this site in your browser settings, then check again.</p>
        </div>}
        <div className={styles.controls}>
          <p className={styles.state} role="status" aria-busy={checking || undefined}>
            {checking
              ? <><span className={styles.srOnly}>Checking notification settings…</span><span aria-hidden="true"><Skeleton width="min(14rem, 70%)" height={18} /></span></>
              : enabled ? 'Notifications are on for this browser.'
                : availability === 'unknown' ? 'Notification status could not be checked.'
                  : 'Notifications are off for this browser.'}
          </p>
          <div className={styles.actions}>
            <Button type="button" disabled={busy || !canChange} onClick={() => void change()}>
              {busy ? 'Updating…' : enabled ? 'Turn off notifications' : 'Enable delivery notifications'}
            </Button>
            {(availability === 'unavailable' || availability === 'blocked' || availability === 'unknown') &&
              <Button variant="outline" type="button" disabled={busy} onClick={() => void refresh(true)}>Check again</Button>}
          </div>
        </div>
      </>}
      {message && <p className={error ? styles.errorMessage : styles.message} role={error ? 'alert' : 'status'}>{message}</p>}
    </div>
  </section>;
}
