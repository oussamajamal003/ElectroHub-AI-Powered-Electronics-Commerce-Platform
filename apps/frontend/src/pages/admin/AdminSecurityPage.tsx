import { useState } from 'react';
import { KeyRound, Smartphone, ShieldCheck } from 'lucide-react';
import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { OtpCodeInput } from '@/features/admin/security/components/OtpCodeInput';
import { TotpEnrollment } from '@/features/admin/security/components/TotpEnrollment';
import { RecoveryCodesReveal } from '@/features/admin/security/components/RecoveryCodesReveal';
import { PasskeySupportNotice } from '@/features/admin/security/components/PasskeySupportNotice';
import { LabelDialog } from '@/features/admin/security/components/LabelDialog';
import { describeAdminAuthError } from '@/features/admin/security/errors';
import { isStepUpCancelled, useStepUp } from '@/features/admin/security/useStepUp';
import {
  useAdminFactors, useStartTotp, useConfirmTotp, useRemoveTotp, useRegenerateRecoveryCodes, useAddPasskey, useRenamePasskey, useRemovePasskey,
  type AdminTotpEnrollment, type PasskeySummary, type TotpFactorSummary,
} from '@/features/admin/security/api';
import { ApiError } from '@/lib/api';
import { AdminPageSkeleton, ConfirmDialog, EmptyRows, PageHeader, QueryProblem, useAdminToast } from '@/features/admin/shared/AdminUi';
import { formatDate } from '@/features/admin/shared/format';
import styles from '@/features/admin/shared/AdminPages.module.scss';
import secStyles from './AdminSecurityPage.module.scss';

type OpenDialog =
  | { kind: 'addTotp' }
  | { kind: 'confirmTotp'; enrollment: AdminTotpEnrollment }
  | { kind: 'removeTotp'; factor: TotpFactorSummary }
  | { kind: 'addPasskey' }
  | { kind: 'renamePasskey'; passkey: PasskeySummary }
  | { kind: 'removePasskey'; passkey: PasskeySummary }
  | { kind: 'regenerate' }
  | { kind: 'codes'; codes: string[] };

const LAST_FACTOR_MESSAGE = 'This is your last usable sign-in method. Add an authenticator app or a passkey before removing it.';

/** The message for a failed factor change, or null when the administrator simply cancelled the verification prompt. */
function explainFailure(error: unknown, context: 'totp' | 'passkey' | 'recovery'): string | null {
  if (isStepUpCancelled(error)) return null;
  if (error instanceof ApiError && error.code === 'LAST_FACTOR') return LAST_FACTOR_MESSAGE;
  return describeAdminAuthError(error, context).message;
}

export function AdminSecurityPage() {
  const factors = useAdminFactors();
  const { runWithStepUp, dialog: stepUpDialog } = useStepUp();
  const toast = useAdminToast();
  const startTotp = useStartTotp();
  const confirmTotp = useConfirmTotp();
  const removeTotp = useRemoveTotp();
  const regenerate = useRegenerateRecoveryCodes();
  const addPasskey = useAddPasskey();
  const renamePasskey = useRenamePasskey();
  const removePasskey = useRemovePasskey();
  const [open, setOpen] = useState<OpenDialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const passkeysSupported = browserSupportsWebAuthn();

  const close = () => {
    if (busy) return;
    setOpen(null);
    setDialogError(null);
    setCode('');
  };

  /** Runs one factor change under the step-up guard, reports success, and keeps the dialog open with a truthful message on failure. */
  const perform = async (context: 'totp' | 'passkey' | 'recovery', action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setDialogError(null);
    try {
      await runWithStepUp(action);
      setOpen(null);
      setCode('');
      toast(success);
      return true;
    } catch (error) {
      const message = explainFailure(error, context);
      if (message) setDialogError(message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onStartTotp = async (label: string) => {
    setBusy(true);
    setDialogError(null);
    try {
      const enrollment = await runWithStepUp(() => startTotp.mutateAsync({ label }));
      setDialogError(null);
      setCode('');
      setOpen({ kind: 'confirmTotp', enrollment });
    } catch (error) {
      const message = explainFailure(error, 'totp');
      if (message) setDialogError(message);
    } finally {
      setBusy(false);
    }
  };

  const onConfirmTotp = (enrollment: AdminTotpEnrollment) => perform('totp',
    () => confirmTotp.mutateAsync({ factorId: enrollment.factorId, code }), 'Authenticator app added.');

  const onRegenerate = async () => {
    setBusy(true);
    setDialogError(null);
    try {
      const result = await runWithStepUp(() => regenerate.mutateAsync(undefined));
      setOpen({ kind: 'codes', codes: result.codes });
    } catch (error) {
      const message = explainFailure(error, 'recovery');
      if (message) setDialogError(message);
    } finally {
      setBusy(false);
    }
  };

  const onAddPasskey = async (label: string) => {
    setBusy(true);
    setDialogError(null);
    try {
      await runWithStepUp(() => addPasskey.mutateAsync(label));
      setOpen(null);
      toast('Passkey added.');
    } catch (error) {
      const message = explainFailure(error, 'passkey');
      if (message) setDialogError(message);
    } finally {
      setBusy(false);
    }
  };

  const onRenamePasskey = (passkey: PasskeySummary, label: string) => perform('passkey',
    () => renamePasskey.mutateAsync({ id: passkey.id, label }), 'Passkey renamed.');

  const onRemoveTotp = (factor: TotpFactorSummary) => perform('totp',
    () => removeTotp.mutateAsync(factor.id), 'Authenticator app removed.');

  const onRemovePasskey = (passkey: PasskeySummary) => perform('passkey',
    () => removePasskey.mutateAsync(passkey.id), 'Passkey removed.');

  if (factors.isPending) {
    return <div className={styles.page}><PageHeader title="Security" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'My Profile', to: '/admin/profile' }, { label: 'Security' }]} /><AdminPageSkeleton /></div>;
  }

  const data = factors.data;
  const methodCount = data ? data.totp.length + data.passkeys.length : 0;

  return <div className={styles.page}>
    <PageHeader title="Security" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'My Profile', to: '/admin/profile' }, { label: 'Security' }]}
      description="How you confirm your identity when you sign in and when you change sensitive settings." />
    {factors.isError && !data && <QueryProblem error={factors.error} hasData={false} onRetry={() => void factors.refetch()} retrying={factors.isFetching} what="Your security settings" />}
    {data && <>
      <p className={styles.notice}>
        {methodCount >= 2 ? 'You have more than one sign-in method. Keep at least one available.'
          : 'Keep at least two sign-in methods, such as an authenticator app and a passkey, so you are not locked out.'}
      </p>

      <section className={styles.panelFlush} aria-labelledby="security-totp-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="security-totp-title" className={styles.panelTitle}><Smartphone aria-hidden="true" size={18} /> Authenticator apps</h2>
            <p className={styles.panelHint}>Time-based codes from an app such as Google Authenticator, Microsoft Authenticator or 1Password.</p>
          </div>
          <Button type="button" variant="outline" size="small" onClick={() => setOpen({ kind: 'addTotp' })}>Add authenticator app</Button>
        </div>
        {data.totp.length === 0
          ? <EmptyRows title="No authenticator app yet" hint="Add one so you can sign in with a code." />
          : <ul className={secStyles.factorList}>
            {data.totp.map(factor => <li key={factor.id} className={secStyles.factorItem}>
              <span className={styles.cellText}>
                <strong>{factor.label}</strong>
                <span>Added {formatDate(factor.createdAt)}{factor.lastUsedAt ? ` · last used ${formatDate(factor.lastUsedAt)}` : ' · not used yet'}</span>
              </span>
              <Button type="button" variant="outline" size="small" onClick={() => setOpen({ kind: 'removeTotp', factor })}>Remove</Button>
            </li>)}
          </ul>}
      </section>

      <section className={styles.panelFlush} aria-labelledby="security-passkey-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="security-passkey-title" className={styles.panelTitle}><KeyRound aria-hidden="true" size={18} /> Passkeys</h2>
            <p className={styles.panelHint}>Sign in with this device's screen lock, a security key, or your password manager.</p>
          </div>
          <Button type="button" variant="outline" size="small" disabled={!passkeysSupported} onClick={() => setOpen({ kind: 'addPasskey' })}>Add passkey</Button>
        </div>
        {!passkeysSupported && <div className={secStyles.passkeyNotice}><PasskeySupportNotice supported={false} /></div>}
        {data.passkeys.length === 0
          ? <EmptyRows title="No passkeys yet" hint="Passkeys are optional and can be used alongside your authenticator app." />
          : <ul className={secStyles.factorList}>
            {data.passkeys.map(passkey => <li key={passkey.id} className={secStyles.factorItem}>
              <span className={styles.cellText}>
                <strong>{passkey.label}</strong>
                <span>Added {formatDate(passkey.createdAt)}{passkey.lastUsedAt ? ` · last used ${formatDate(passkey.lastUsedAt)}` : ' · not used yet'}</span>
              </span>
              <span className={styles.rowActions}>
                <Button type="button" variant="outline" size="small" onClick={() => setOpen({ kind: 'renamePasskey', passkey })}>Rename</Button>
                <Button type="button" variant="outline" size="small" onClick={() => setOpen({ kind: 'removePasskey', passkey })}>Remove</Button>
              </span>
            </li>)}
          </ul>}
      </section>

      <section className={styles.panelFlush} aria-labelledby="security-recovery-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="security-recovery-title" className={styles.panelTitle}><ShieldCheck aria-hidden="true" size={18} /> Recovery codes</h2>
            <p className={styles.panelHint}>
              {data.recoveryCodes.remaining} unused {data.recoveryCodes.remaining === 1 ? 'code' : 'codes'} remaining
              {data.recoveryCodes.generatedAt ? `, generated ${formatDate(data.recoveryCodes.generatedAt)}` : ''}.
              Creating new codes makes every older code stop working.
            </p>
          </div>
          <Button type="button" variant="outline" size="small" onClick={() => setOpen({ kind: 'regenerate' })}>Create new codes</Button>
        </div>
        {data.recoveryCodes.remaining <= 2 && <p className={`${styles.notice} ${styles.noticeWarning} ${secStyles.recoveryWarning}`}>
          You are running low on recovery codes. Create a new set and store it safely.
        </p>}
      </section>
    </>}

    <LabelDialog open={open?.kind === 'addTotp'} onOpenChange={(next) => { if (!next) close(); }} title="Add an authenticator app"
      description="Name this app so you can recognise it later. Next you will scan a code and confirm it."
      label="Name" initialValue="Authenticator app" submitLabel="Continue" pending={busy} error={dialogError}
      onSubmit={(label) => void onStartTotp(label)} />

    <Dialog open={open?.kind === 'confirmTotp'} onOpenChange={(next) => { if (!next) close(); }}>
      {open?.kind === 'confirmTotp' && <DialogContent>
        <DialogTitle>Scan and confirm</DialogTitle>
        <DialogDescription asChild>
          <div className={secStyles.dialogStack}>
            <TotpEnrollment otpauthUri={open.enrollment.otpauthUri} secret={open.enrollment.secret} />
            {dialogError && <p role="alert" className={styles.formError}>{dialogError}</p>}
            <form noValidate onSubmit={(event) => { event.preventDefault(); if (code.length === 6) void onConfirmTotp(open.enrollment); else setDialogError('Enter the 6-digit code from your app.'); }}
              className={styles.form}>
              <OtpCodeInput id="security-totp-confirm" label="Code from your app" value={code} onChange={setCode} disabled={busy} error={undefined} />
              <div><Button type="submit" isLoading={busy}>Confirm and add</Button></div>
            </form>
          </div>
        </DialogDescription>
      </DialogContent>}
    </Dialog>

    <ConfirmDialog open={open?.kind === 'removeTotp'} onOpenChange={(next) => { if (!next) close(); }} title="Remove this authenticator app?"
      description="You will no longer be able to sign in with codes from this app. Make sure another sign-in method remains available."
      confirmLabel="Remove app" destructive pending={busy} error={dialogError} onConfirm={() => { if (open?.kind === 'removeTotp') void onRemoveTotp(open.factor); }} />

    <LabelDialog open={open?.kind === 'addPasskey'} onOpenChange={(next) => { if (!next) close(); }} title="Add a passkey"
      description="Name this passkey, then confirm with your device when the browser asks."
      label="Name" initialValue="This device" submitLabel="Create passkey" pending={busy} error={dialogError}
      onSubmit={(label) => void onAddPasskey(label)} />

    <LabelDialog open={open?.kind === 'renamePasskey'} onOpenChange={(next) => { if (!next) close(); }} title="Rename passkey"
      description="The name helps you recognise the device later."
      label="Name" initialValue={open?.kind === 'renamePasskey' ? open.passkey.label : ''} submitLabel="Save name" pending={busy} error={dialogError}
      onSubmit={(label) => { if (open?.kind === 'renamePasskey') void onRenamePasskey(open.passkey, label); }} />

    <ConfirmDialog open={open?.kind === 'removePasskey'} onOpenChange={(next) => { if (!next) close(); }} title="Remove this passkey?"
      description="This device will no longer be able to sign in with this passkey."
      confirmLabel="Remove passkey" destructive pending={busy} error={dialogError} onConfirm={() => { if (open?.kind === 'removePasskey') void onRemovePasskey(open.passkey); }} />

    <ConfirmDialog open={open?.kind === 'regenerate'} onOpenChange={(next) => { if (!next) close(); }} title="Create new recovery codes?"
      description="Every recovery code you already have stops working as soon as the new set is created."
      confirmLabel="Create new codes" pending={busy} error={dialogError} onConfirm={() => void onRegenerate()} />

    <Dialog open={open?.kind === 'codes'} onOpenChange={(next) => { if (!next) setOpen(null); }}>
      {open?.kind === 'codes' && <DialogContent>
        <DialogTitle className={styles.visuallyHidden}>Recovery codes</DialogTitle>
        <DialogDescription asChild>
          <div>
            <RecoveryCodesReveal codes={open.codes} onConfirmed={() => { setOpen(null); toast('New recovery codes created.'); }} />
          </div>
        </DialogDescription>
      </DialogContent>}
    </Dialog>

    {stepUpDialog}
  </div>;
}
