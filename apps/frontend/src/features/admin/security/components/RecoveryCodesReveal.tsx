import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import styles from './AdminSecurity.module.scss';

export const RECOVERY_FILE_NAME = 'electrohub-admin-recovery-codes.txt';

export interface RecoveryCodesRevealProps {
  codes: string[];
  /** Called only after the administrator confirms the codes are stored somewhere safe. */
  onConfirmed: () => void;
  confirmLabel?: string;
  pending?: boolean;
}

/**
 * One-time reveal of recovery codes. They exist only in this component's state for the current view: they are never persisted, logged
 * or sent anywhere, and continuing requires an explicit confirmation that they have been saved.
 */
export function RecoveryCodesReveal({ codes, onConfirmed, confirmLabel = 'Continue', pending = false }: RecoveryCodesRevealProps) {
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState('');
  const checkboxId = useId();
  const headingId = useId();

  useEffect(() => {
    setSaved(false);
    setNotice('');
  }, [codes]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setNotice('Recovery codes copied.');
    } catch {
      setNotice('Copy is not available here. Download the file or write the codes down.');
    }
  };

  const download = () => {
    const blob = new Blob([`ElectroHub administrator recovery codes\nEach code works once. Keep these private.\n\n${codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = RECOVERY_FILE_NAME;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice('Recovery codes file downloaded.');
  };

  return (
    <section className={styles.enrollment} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.sectionTitle}>Save your recovery codes</h3>
      <p className={styles.note}>
        Each code signs you in once if you lose access to your authenticator app. They are shown only now. Store them in a password
        manager or print them, and keep them private.
      </p>
      <ol className={styles.codesGrid} aria-label="Recovery codes">
        {codes.map((code) => <li key={code}>{code}</li>)}
      </ol>
      <div className={styles.codesActions}>
        <Button type="button" variant="outline" size="small" onClick={copyAll}>Copy all</Button>
        <Button type="button" variant="outline" size="small" onClick={download}>Download .txt</Button>
      </div>
      <p className={styles.secretHint} role="status" aria-live="polite">{notice}</p>
      <label className={styles.checkRow} htmlFor={checkboxId}>
        <input id={checkboxId} type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
        <span>I have saved these codes somewhere safe.</span>
      </label>
      <Button type="button" onClick={onConfirmed} disabled={!saved || pending} isLoading={pending}>{confirmLabel}</Button>
    </section>
  );
}
