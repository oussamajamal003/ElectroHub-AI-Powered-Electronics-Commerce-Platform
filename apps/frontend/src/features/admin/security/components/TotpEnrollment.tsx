import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/Button';
import styles from './AdminSecurity.module.scss';

/** Groups the secret in fours for reading and typing (spaces are display-only; the copied value has none). */
export const groupSecret = (secret: string) => secret.replace(/\s+/g, '').match(/.{1,4}/g)?.join(' ') ?? '';

export interface TotpEnrollmentProps {
  /** `otpauth://totp/...` URI from the server. Rendered to a QR code locally: nothing is sent to any other host. */
  otpauthUri: string;
  secret: string;
}

/**
 * Authenticator setup: a locally generated QR code plus the manual key (grouped, monospace, copyable). Generating the secret is not
 * enrollment: the parent asks for a code from the app and confirms it.
 */
export function TotpEnrollment({ otpauthUri, secret }: TotpEnrollmentProps) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    let active = true;
    setQrUrl(null);
    setQrFailed(false);
    QRCode.toDataURL(otpauthUri, { margin: 1, width: 200, errorCorrectionLevel: 'M' })
      .then((url) => { if (active) setQrUrl(url); })
      .catch(() => { if (active) setQrFailed(true); });
    return () => { active = false; };
  }, [otpauthUri]);

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret.replace(/\s+/g, ''));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <div className={styles.enrollment}>
      <div className={styles.qrRow}>
        <div className={styles.qrFrame}>
          {qrUrl ? <img src={qrUrl} alt="QR code: scan with your authenticator app" width={200} height={200} />
            : qrFailed ? <span>QR code unavailable. Use the key instead.</span>
              : <span>Generating QR code…</span>}
        </div>
        <div className={styles.secretBlock}>
          <span className={styles.secretLabel} id="totp-secret-label">Can't scan? Enter this key in your app</span>
          <code className={styles.secret} aria-labelledby="totp-secret-label">{groupSecret(secret)}</code>
          <Button type="button" variant="outline" size="small" className={styles.copyButton} onClick={copySecret}>
            Copy key
          </Button>
          <p className={styles.secretHint} role="status" aria-live="polite">
            {copyState === 'copied' && 'Key copied.'}
            {copyState === 'failed' && 'Copy is not available here. Select the key and copy it manually.'}
            {copyState === 'idle' && 'Use a time-based (TOTP) account with the default settings: 6 digits, 30 seconds.'}
          </p>
        </div>
      </div>
    </div>
  );
}
