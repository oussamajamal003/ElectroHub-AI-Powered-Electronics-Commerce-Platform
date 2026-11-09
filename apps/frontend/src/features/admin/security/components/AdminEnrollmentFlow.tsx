import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { adminAuthApi, type AdminEnrollmentConfirmation, type AdminSessionResponse, type AdminTotpEnrollment } from '../api';
import { describeAdminAuthError } from '../errors';
import { useVerificationFocus } from '../useVerificationFocus';
import { OtpCodeInput } from './OtpCodeInput';
import { RecoveryCodesReveal } from './RecoveryCodesReveal';
import { TotpEnrollment } from './TotpEnrollment';
import styles from './AdminSecurity.module.scss';

export interface AdminEnrollmentFlowProps {
  /** Short-lived pre-auth transaction token. Held only in the parent's React state. */
  mfaToken: string;
  /** Called once the administrator has confirmed the saved recovery codes. The parent establishes the session. */
  onComplete: (session: AdminSessionResponse) => void;
  /** The pre-auth transaction is gone; the parent explains and offers a restart. */
  onChallengeLost: (message: string) => void;
}

type Stage =
  | { name: 'intro' }
  | { name: 'scan'; enrollment: AdminTotpEnrollment }
  | { name: 'codes'; session: AdminEnrollmentConfirmation };

/**
 * Mandatory administrator two-step enrollment: start (secret generated, not yet active), scan or type the key, confirm a live code,
 * reveal recovery codes once, then hand the session to the parent. Shared by admin login and invitation acceptance.
 */
export function AdminEnrollmentFlow({ mfaToken, onComplete, onChallengeLost }: AdminEnrollmentFlowProps) {
  const [stage, setStage] = useState<Stage>({ name: 'intro' });
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const rememberVerificationFocus = useVerificationFocus(pending);

  const handleFailure = (err: unknown) => {
    const failure = describeAdminAuthError(err, 'enrollment');
    if (failure.restart) onChallengeLost(failure.message);
    else setError(failure.message);
  };

  const startSetup = async () => {
    if (pending) return;
    rememberVerificationFocus();
    setPending(true);
    setError('');
    try {
      const enrollment = await adminAuthApi.startEnrollment({ mfaToken });
      setCode('');
      setStage({ name: 'scan', enrollment });
    } catch (err) {
      handleFailure(err);
    } finally {
      setPending(false);
    }
  };

  const confirmSetup = async (enrollment: AdminTotpEnrollment) => {
    if (pending) return;
    if (code.length !== 6) { setError('Enter the 6-digit code from your authenticator app.'); return; }
    rememberVerificationFocus();
    setPending(true);
    setError('');
    try {
      const session = await adminAuthApi.confirmEnrollment({ mfaToken, factorId: enrollment.factorId, code });
      setCode('');
      setStage({ name: 'codes', session });
    } catch (err) {
      setCode('');
      handleFailure(err);
    } finally {
      setPending(false);
    }
  };

  if (stage.name === 'codes') {
    return (
      <div className={styles.enrollment}>
        <RecoveryCodesReveal
          codes={stage.session.recoveryCodes}
          confirmLabel="I have saved my codes, continue"
          onConfirmed={() => onComplete({ accessToken: stage.session.accessToken, user: stage.session.user })}
        />
      </div>
    );
  }

  if (stage.name === 'scan') {
    const { enrollment } = stage;
    return (
      <div className={styles.enrollment}>
        <h2 className={styles.sectionTitle}>Set up two-step verification</h2>
        <p className={styles.note}>Scan the code with your authenticator app, then enter the 6-digit code it shows to finish setup.</p>
        <TotpEnrollment otpauthUri={enrollment.otpauthUri} secret={enrollment.secret} />
        <form className={styles.enrollment} noValidate onSubmit={(event) => { event.preventDefault(); void confirmSetup(enrollment); }}>
          <OtpCodeInput id="enrollment-code" label="Code from your app" value={code} onChange={setCode} error={error || undefined} disabled={pending} />
          <Button type="submit" isLoading={pending}>Confirm and continue</Button>
        </form>
      </div>
    );
  }

  return (
    <div className={styles.enrollment}>
      <h2 className={styles.sectionTitle}>Set up two-step verification</h2>
      <p className={styles.note}>
        Administrator accounts must use an authenticator app. You will scan a code once, confirm it, and save recovery codes for emergencies.
      </p>
      {error && <Alert variant="error">{error}</Alert>}
      <Button type="button" onClick={startSetup} isLoading={pending}>Set up authenticator app</Button>
    </div>
  );
}
