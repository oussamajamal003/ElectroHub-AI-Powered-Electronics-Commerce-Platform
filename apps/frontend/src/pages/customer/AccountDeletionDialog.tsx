import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { authApi } from '@/features/auth/api/auth';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput/PasswordInput';
import styles from './AccountDeletionDialog.module.scss';

interface AccountDeletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

export function AccountDeletionDialog({ open, onOpenChange, onDeleted }: AccountDeletionDialogProps) {
  const { user, clearSession } = useAuth();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [reauthenticated, setReauthenticated] = useState(false);
  const popup = useRef<Window | null>(null);
  const cleanup = useRef<() => void>(() => {});

  const hasPassword = user?.authMethods?.password ?? true;
  const hasGoogle = user?.authMethods?.google ?? false;

  const reset = () => {
    setPassword('');
    setConfirmation('');
    setError('');
    setIsBusy(false);
    setReauthenticated(false);
  };

  useEffect(() => () => {
    cleanup.current();
    popup.current?.close();
  }, []);

  const changeOpen = (next: boolean) => {
    if (isBusy) return;
    if (!next) {
      cleanup.current();
      popup.current?.close();
      reset();
    }
    onOpenChange(next);
  };

  const verifyPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsBusy(true);
    try {
      await authApi.reauthenticateDeletionWithPassword(password);
      setPassword('');
      setReauthenticated(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to verify your password. Please try again.');
    } finally {
      setIsBusy(false);
    }
  };

  const verifyGoogle = () => {
    if (isBusy) return;
    setError('');
    const width = Math.min(500, window.outerWidth);
    const height = Math.min(650, window.outerHeight);
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
    const channelId = crypto.randomUUID();
    const authPopup = window.open('about:blank', 'electrohub-account-deletion-google', `popup,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`);
    if (!authPopup) {
      setError('Allow popups to verify your Google account.');
      return;
    }

    popup.current = authPopup;
    setIsBusy(true);
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`electrohub-google-${channelId}`);
    let completed = false;
    const finish = (status?: unknown) => {
      if (completed) return;
      completed = true;
      cleanup.current();
      popup.current?.close();
      setIsBusy(false);
      if (status === 'success') setReauthenticated(true);
      else if (status !== 'cancelled') setError('Google verification could not be completed. Please try again.');
    };
    const receiveResult = (status: unknown) => {
      if (!['success', 'failure', 'cancelled'].includes(String(status))) return;
      finish(status);
    };
    const receive = (event: MessageEvent) => {
      const callbackOrigin = import.meta.env.DEV && window.location.origin === 'http://localhost:3000' ? 'http://localhost:5000' : window.location.origin;
      if ((event.origin !== callbackOrigin && event.origin !== window.location.origin) || event.source !== popup.current || event.data?.type !== 'electrohub-google') return;
      receiveResult(event.data.status);
    };
    if (channel) channel.onmessage = event => {
      if (event.origin === window.location.origin && event.data?.type === 'electrohub-google') receiveResult(event.data.status);
    };
    window.addEventListener('message', receive);
    const interval = window.setInterval(() => { if (popup.current?.closed && !completed) finish(); }, 500);
    const timeout = window.setTimeout(() => finish('failure'), 5 * 60 * 1000);
    cleanup.current = () => {
      channel?.close();
      window.removeEventListener('message', receive);
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };

    void authApi.prepareGoogleDeletionReauth(channelId).then(({ authorizationUrl }) => {
      if (!completed && popup.current) popup.current.location.href = authorizationUrl;
    }).catch(() => finish('failure'));
  };

  const deleteAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reauthenticated || confirmation !== 'DELETE' || isBusy) return;
    setError('');
    setIsBusy(true);
    try {
      await authApi.deleteAccount();
      onDeleted();
      clearSession();
      queryClient.clear();
      onOpenChange(false);
      reset();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        if (cause.status === 403) setReauthenticated(false);
      } else {
        setError('Account deletion could not be completed. Your account has not been changed. Please try again.');
      }
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent aria-describedby="account-deletion-description" className={styles.dialog}>
        <DialogTitle>Delete your account?</DialogTitle>
        <DialogDescription id="account-deletion-description">
          This permanently removes your sign-in access and personal profile. Existing orders and payment records are retained; active orders keep the shipping details required for fulfillment.
        </DialogDescription>

        {error && <Alert variant="error">{error}</Alert>}

        {!reauthenticated ? (
          <div className={styles.methods}>
            <p className={styles.methodLabel}>Verify your identity to continue.</p>
            {hasPassword && (
              <form onSubmit={verifyPassword} className={styles.form}>
                <PasswordInput label="Current Password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={isBusy} required fullWidth />
                <Button type="submit" variant="outline" className={styles.fullWidthButton} disabled={isBusy || !password} isLoading={isBusy}>Confirm with Password</Button>
              </form>
            )}
            {hasGoogle && (
              <Button type="button" variant="outline" className={styles.fullWidthButton} onClick={verifyGoogle} disabled={isBusy} isLoading={isBusy}>
                Continue with Google
              </Button>
            )}
          </div>
        ) : (
          <form onSubmit={deleteAccount} className={styles.form}>
            <p className={styles.methodLabel}>Type DELETE to confirm. This action cannot be undone.</p>
            <Input label="Type DELETE to confirm" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" disabled={isBusy} required fullWidth />
            <Button type="submit" variant="destructive" className={styles.fullWidthButton} disabled={isBusy || confirmation !== 'DELETE'} isLoading={isBusy}>
              Permanently Delete Account
            </Button>
          </form>
        )}

        <Button type="button" variant="ghost" className={styles.fullWidthButton} disabled={isBusy} onClick={() => changeOpen(false)}>Cancel</Button>
      </DialogContent>
    </Dialog>
  );
}
