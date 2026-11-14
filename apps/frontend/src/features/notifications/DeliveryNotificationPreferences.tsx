import { useCallback, useEffect, useRef, useState } from 'react';
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
type Availability = 'checking' | 'enabled' | 'permission-required' | 'blocked' | 'temporary';

const BADGES: Partial<Record<Availability, { label: string; tone: string | undefined }>> = {
  enabled: { label: 'On', tone: styles.badgeEnabled },
  'permission-required': { label: 'Permission required', tone: styles.badgeReady },
  blocked: { label: 'Permission blocked', tone: styles.badgeUnavailable },
  temporary: { label: 'Temporarily unavailable', tone: styles.badgeUnavailable },
};

const browserBlocked = () => typeof Notification !== 'undefined' && Notification.permission === 'denied';

export function DeliveryNotificationPreferences({ userId }: { userId: string }) {
  const supported = pushSupported();
  const [availability, setAvailability] = useState<Availability>('checking');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const actionLock = useRef(false);

  /** `announce` is set only for a check the customer asked for, so the result is spoken and visible even when nothing changed. */
  const refresh = useCallback(async (announce = false) => {
    setAvailability('checking');
    setError(false);
    setMessage('');
    try {
      const state = await pushStatus(userId);
      const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
      const next: Availability = permission === 'denied' ? 'blocked'
        : permission === 'default' ? 'permission-required'
          : state.enabled ? 'enabled' : 'temporary';
      setAvailability(next);
      if (announce) setMessage(next === 'temporary' ? 'Checked just now: notifications still need setup. You can retry.'
        : next === 'blocked' ? 'Checked just now: this browser is still blocking notifications.'
          : next === 'enabled' ? 'Checked just now: delivery notifications are on for this browser.'
            : next === 'permission-required' ? 'Checked just now: browser permission is still required.' : '');
    } catch {
      if (browserBlocked()) {
        setAvailability('blocked');
        setError(false);
        setMessage('');
      } else {
        setAvailability('temporary');
        setError(true);
        setMessage('We could not check notification setup right now. Check your connection and try again.');
      }
    }
  }, [userId]);

  useEffect(() => {
    // Reading the current state never asks for permission: the browser prompt opens only from the Enable button below.
    if (supported) void refresh();
  }, [refresh, supported]);

  const change = async () => {
    if (actionLock.current) return;
    actionLock.current = true;
    const turningOff = availability === 'enabled';
    setBusy(true);
    setError(false);
    setMessage('');
    try {
      if (turningOff) await disablePush(userId);
      else {
        await enablePush(userId);
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
          throw new Error('Browser permission was not granted, so delivery notifications are not active.');
        }
      }
      // The status line below is a live region and already states the new on/off state, so no second message repeats it.
      setAvailability(turningOff ? (browserBlocked() ? 'blocked' : 'permission-required') : 'enabled');
    } catch (failure) {
      setError(true);
      setMessage(failure instanceof Error ? failure.message : 'We could not update your notification settings. Please try again.');
      if (browserBlocked()) setAvailability('blocked');
      else if (failure instanceof Error) setAvailability('temporary');
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const checking = availability === 'checking';
  const enabled = availability === 'enabled';
  const badge = supported ? BADGES[availability] : { label: 'Not supported here', tone: styles.badgeUnavailable };
  // Browser permission is requested in the click flow; server and push initialization failures remain retryable.
  const canChange = enabled || availability === 'permission-required' || availability === 'temporary';

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
        {availability === 'permission-required' && <div className={styles.notice} role="status">
          <p><strong>Permission required.</strong> Allow browser notifications when prompted to receive delivery alerts. Order emails remain on separately.</p>
        </div>}
        {availability === 'blocked' && <div className={clsx(styles.notice, styles.noticeUnavailable)} role="status">
          <p><strong>Notifications are blocked for ElectroHub.</strong> Change this site’s notification permission in your browser settings, then check again.</p>
        </div>}
        {availability === 'temporary' && <div className={clsx(styles.notice, styles.noticeUnavailable)} role="status">
          <p><strong>Notifications are temporarily unavailable.</strong> Setup could not be completed. Retry in a moment; order emails remain unaffected.</p>
        </div>}
        <div className={styles.controls}>
          <div className={styles.state} role="status" aria-busy={checking || undefined}>
            {checking
              ? <><span className={styles.srOnly}>Checking notification settings…</span><span aria-hidden="true"><Skeleton width="min(14rem, 70%)" height={18} /></span></>
              : enabled ? 'Notifications are on for this browser.'
                : availability === 'permission-required' ? 'Browser permission has not been granted.'
                    : availability === 'blocked' ? 'Browser permission is blocked.'
                      : 'Notifications are not active on this browser.'}
          </div>
          <div className={styles.actions}>
            {availability !== 'blocked' && <Button type="button" disabled={busy || !canChange} onClick={() => void change()}>
              {busy ? 'Updating…' : enabled ? 'Turn off notifications' : availability === 'temporary' ? 'Retry notifications setup' : 'Enable delivery notifications'}
            </Button>}
            {(availability === 'temporary' || availability === 'blocked') &&
              <Button variant="outline" type="button" disabled={busy} onClick={() => void refresh(true)}>Check again</Button>}
          </div>
        </div>
      </>}
      {message && <p className={error ? styles.errorMessage : styles.message} role={error ? 'alert' : 'status'}>{message}</p>}
    </div>
  </section>;
}
