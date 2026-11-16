import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { PasswordInput } from '@/components/ui/PasswordInput/PasswordInput';
import { Alert } from '@/components/ui/Alert';
import { authApi } from '../api/auth';
import styles from './AuthModals.module.scss';

interface GoogleAuthButtonProps {
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  onSuccess: () => Promise<void>;
  onLinkingChange?: (linking: boolean) => void;
}

export function GoogleAuthButton({ disabled, onBusyChange, onSuccess, onLinkingChange }: GoogleAuthButtonProps) {
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const popup = useRef<Window | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const active = useRef(false);

  useEffect(() => () => { cleanup.current(); popup.current?.close(); }, []);

  const finish = () => {
    active.current = false;
    cleanup.current();
    setBusy(false);
    onBusyChange(false);
  };

  const start = () => {
    if (disabled || active.current) return;
    setError('');
    setLinking(false);
    setPassword('');
    const width = Math.min(500, window.outerWidth);
    const height = Math.min(650, window.outerHeight);
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
    const channelId = crypto.randomUUID();
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`electrohub-google-${channelId}`);
    popup.current = window.open(`/api/auth/google/start?channel=${encodeURIComponent(channelId)}`, 'electrohub-google', `popup,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`);
    if (!popup.current) { channel?.close(); setError('Allow popups to continue with Google.'); return; }
    active.current = true;
    setBusy(true);
    onBusyChange(true);
    const receiveResult = async (status: unknown) => {
      if (typeof status !== 'string' || !['success', 'failure', 'cancelled', 'linking_required'].includes(status) || !active.current) return;
      active.current = false;
      cleanup.current();
      popup.current?.close();
      if (status === 'linking_required') {
        setLinking(true);
        onLinkingChange?.(true);
      }
      else if (status === 'success') {
        try { await onSuccess(); }
        catch { setError('Google sign-in could not be completed. Please try again.'); }
      } else if (status !== 'cancelled') setError('Google sign-in could not be completed. Please try again.');
      finish();
    };
    const receive = (event: MessageEvent) => {
      const callbackOrigin = import.meta.env.DEV && window.location.origin === 'http://localhost:3000' ? 'http://localhost:5000' : window.location.origin;
      if ((event.origin !== callbackOrigin && event.origin !== window.location.origin) || event.source !== popup.current || event.data?.type !== 'electrohub-google') return;
      void receiveResult(event.data.status);
    };
    if (channel) channel.onmessage = event => {
      if (event.origin === window.location.origin && event.data?.type === 'electrohub-google') void receiveResult(event.data.status);
    };
    window.addEventListener('message', receive);
    const interval = window.setInterval(() => { if (popup.current?.closed) finish(); }, 500);
    const timeout = window.setTimeout(() => { popup.current?.close(); setError('Google sign-in expired. Please try again.'); finish(); }, 5 * 60 * 1000);
    cleanup.current = () => { channel?.close(); window.removeEventListener('message', receive); window.clearInterval(interval); window.clearTimeout(timeout); };
  };

  const link = async (event: React.FormEvent) => {
    event.preventDefault();
    if (active.current || !password) return;
    active.current = true;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      await authApi.linkGoogle(password);
      setPassword('');
      await onSuccess();
    } catch { setError('Unable to connect Google. Check your account password and verified email, or try Google sign-in again.'); }
    finally { finish(); }
  };

  return (
    <div className={styles.form}>
      {error && <Alert variant="error">{error}</Alert>}
      {linking ? (
        <form onSubmit={link} className={styles.form}>
          <p>An existing ElectroHub account uses this email. Enter its password to connect Google securely. Your account email must already be verified.</p>
          <PasswordInput label="ElectroHub account password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" disabled={busy} fullWidth />
          <Button type="submit" disabled={busy || !password} isLoading={busy}>Connect Google</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => { setLinking(false); setPassword(''); setError(''); onLinkingChange?.(false); }}>Cancel linking</Button>
        </form>
      ) : (
        <Button type="button" variant="outline" className={styles.googleButton} onClick={start} disabled={disabled || busy} isLoading={busy} aria-busy={busy}>
          {!busy && <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" />
            <path fill="#34A853" d="M12 22c2.7 0 4.96-.89 6.62-2.41l-3.24-2.51c-.89.6-2.02.96-3.38.96-2.6 0-4.81-1.76-5.6-4.13H3.05v2.59A10 10 0 0 0 12 22Z" />
            <path fill="#FBBC05" d="M6.4 13.91a6 6 0 0 1 0-3.82V7.5H3.05a10 10 0 0 0 0 9l3.35-2.59Z" />
            <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.82 1.49l2.86-2.86A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.5l3.35 2.59c.79-2.37 3-4.13 5.6-4.13Z" />
          </svg>}{busy ? 'Connecting to Google...' : 'Continue with Google'}
        </Button>
      )}
      {!linking && <div className={styles.authDivider}><span>OR</span></div>}
    </div>
  );
}
