import { useEffect, useId, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { adminSecurityApi } from '../api';
import { describeAdminAuthError } from '../errors';
import { OtpCodeInput } from './OtpCodeInput';
import { PasskeySupportNotice } from './PasskeySupportNotice';
import styles from './AdminSecurity.module.scss';

export interface StepUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after the server accepted the fresh verification; the caller retries its original action. */
  onVerified: () => void;
}

type Method = 'totp' | 'recovery' | 'passkey';

/**
 * Recent-verification prompt for sensitive changes. Offers the installed authenticator code, a recovery code or a passkey; the server
 * issues a short-lived step-up assurance and the caller then retries. Nothing here is stored beyond the open dialog.
 */
export function StepUpDialog({ open, onOpenChange, onVerified }: StepUpDialogProps) {
  const [method, setMethod] = useState<Method>('totp');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const recoveryId = useId();

  useEffect(() => {
    if (open) {
      setMethod('totp');
      setCode('');
      setRecovery('');
      setError('');
      setPending(false);
    }
  }, [open]);

  const finish = () => {
    setCode('');
    setRecovery('');
    onVerified();
  };

  const verifyTotp = async () => {
    if (code.length !== 6) { setError('Enter the 6-digit code from your authenticator app.'); return; }
    setPending(true);
    setError('');
    try {
      await adminSecurityApi.stepUp({ method: 'TOTP', code });
      finish();
    } catch (err) {
      setError(describeAdminAuthError(err, 'totp').message);
      setCode('');
    } finally {
      setPending(false);
    }
  };

  const verifyRecovery = async () => {
    const trimmed = recovery.trim();
    if (!trimmed) { setError('Enter one of your recovery codes.'); return; }
    setPending(true);
    setError('');
    try {
      await adminSecurityApi.stepUp({ method: 'RECOVERY_CODE', code: trimmed });
      finish();
    } catch (err) {
      setError(describeAdminAuthError(err, 'recovery').message);
      setRecovery('');
    } finally {
      setPending(false);
    }
  };

  const verifyPasskey = async () => {
    setPending(true);
    setError('');
    try {
      const options = await adminSecurityApi.stepUpPasskeyOptions();
      const response = await startAuthentication({ optionsJSON: options });
      await adminSecurityApi.stepUpPasskey({ response });
      finish();
    } catch (err) {
      setError(describeAdminAuthError(err, 'passkey').message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent>
        <DialogTitle>Confirm it's you</DialogTitle>
        <DialogDescription asChild>
          <div className={styles.dialogBody}>
            <p className={styles.note}>This change needs a fresh verification. Choose how to confirm.</p>
            <Tabs value={method} onValueChange={(next) => { setMethod(next as Method); setError(''); }}>
              <TabsList aria-label="Verification method">
                <TabsTrigger value="totp">Authenticator app</TabsTrigger>
                <TabsTrigger value="recovery">Recovery code</TabsTrigger>
                <TabsTrigger value="passkey">Passkey</TabsTrigger>
              </TabsList>
              <TabsContent value="totp" className={styles.methodPanel}>
                <OtpCodeInput id="step-up-code" label="6-digit code" value={code} onChange={setCode} error={error || undefined} disabled={pending} autoFocus />
                <Button type="button" onClick={verifyTotp} isLoading={pending}>Verify</Button>
              </TabsContent>
              <TabsContent value="recovery" className={styles.methodPanel}>
                <Input id={recoveryId} name="recoveryCode" label="Recovery code" autoComplete="off" spellCheck={false} value={recovery}
                  onChange={(event) => setRecovery(event.target.value)} error={error || undefined} disabled={pending} fullWidth />
                <Button type="button" onClick={verifyRecovery} isLoading={pending}>Verify</Button>
              </TabsContent>
              <TabsContent value="passkey" className={styles.methodPanel}>
                <PasskeySupportNotice />
                <p className={styles.note}>Use the passkey registered on this account. Your browser or device will ask you to confirm.</p>
                {error && <p role="alert" className={styles.note}>{error}</p>}
                <Button type="button" onClick={verifyPasskey} isLoading={pending}>Use passkey</Button>
              </TabsContent>
            </Tabs>
          </div>
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
