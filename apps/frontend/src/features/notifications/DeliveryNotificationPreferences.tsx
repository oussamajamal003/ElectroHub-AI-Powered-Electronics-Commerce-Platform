import { useCallback, useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { enablePush, disablePush, pushStatus, pushSupported } from './pushClient';
import styles from './DeliveryNotificationPreferences.module.scss';
export function DeliveryNotificationPreferences({ userId }: { userId: string }) {
  const supported = pushSupported();
  const [available, setAvailable] = useState(false); const [enabled, setEnabled] = useState(false); const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true); const [message, setMessage] = useState(''); const [error, setError] = useState(false);
  const refresh = useCallback(async () => { setLoading(true); try { const state = await pushStatus(userId); setEnabled(state.enabled); setAvailable(state.available); setError(false);
    setMessage(state.available ? (Notification.permission === 'denied' ? 'Notifications are blocked. You can allow them in your browser settings.' : '') : 'Delivery notifications are not available yet. Please try again later.');
  } catch { setMessage('Unable to check notification preferences. Please retry.'); setError(true); } finally { setLoading(false); } }, [userId]);
  useEffect(() => { if (supported) void refresh(); else setLoading(false); /* Consent is never requested by an effect. */
  }, [refresh, supported]);
  const change = async () => { setBusy(true); setError(false); setMessage(''); try {
    if (enabled) await disablePush(userId); else await enablePush(userId);
    setEnabled(!enabled); setMessage(enabled ? 'Delivery notifications disabled for this browser.' : 'Delivery notifications enabled for this browser.');
  } catch (failure) { setError(true); setMessage(failure instanceof Error ? failure.message : 'Unable to update notification preferences. Please retry.'); }
    finally { setBusy(false); } };
  return <section className={styles.card} aria-labelledby="delivery-notifications-title">
    <h2 id="delivery-notifications-title">Delivery Notifications</h2>
    <p>Get a system notification when your ElectroHub order is out for delivery.</p>
    <p>Email updates are separate. Browser and operating system settings may prevent notifications from appearing.</p>
    {!supported ? <p role="status">This browser cannot enable Web Push here. Use a supported browser in a secure context. On iPhone or iPad, use an installed Home Screen web app.</p> : <>
      <p role="status" aria-busy={loading || undefined}>{loading
        ? <><span className={styles.srOnly}>Checking notification preferences…</span><span aria-hidden="true"><Skeleton width="min(14rem, 70%)" height={18} /></span></>
        : enabled ? 'Enabled on this browser' : 'Not enabled on this browser'}</p>
      <Button type="button" disabled={busy || loading || (!enabled && !available)} onClick={() => void change()}>{busy ? 'Updating…' : enabled ? 'Disable Delivery Notifications' : 'Enable Delivery Notifications'}</Button>
      {error && <Button variant="outline" type="button" disabled={busy} onClick={() => void refresh()}>Retry</Button>}
    </>}
    {message && <p role={error ? 'alert' : 'status'}>{message}</p>}
  </section>;
}
