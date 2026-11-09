import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/Alert';
import styles from '@/features/admin/shared/AdminPages.module.scss';

/**
 * Shown after a 409 VERSION_CONFLICT. The administrator's edits stay in the form; nothing is overwritten until they choose to reload
 * the latest saved values (which discards their edits by their own choice).
 */
export function SettingsConflictNotice({ subject, onReload }: { subject: string; onReload: () => Promise<void> }) {
  const [reloading, setReloading] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const reload = async () => {
    setReloading(true);
    setReloadFailed(false);
    try { await onReload(); } catch { setReloadFailed(true); } finally { setReloading(false); }
  };
  return <Alert variant="warning" role="alert">
    <AlertTitle>These {subject} changed elsewhere</AlertTitle>
    <AlertDescription>
      Another administrator saved newer values. Your edits are kept. Reload the latest values to compare before saving again.
    </AlertDescription>
    {reloadFailed && <p role="alert">Could not reload the latest values. Your edits are still here; try again.</p>}
    <div className={styles.actionsStart}>
      <Button type="button" variant="outline" size="small" onClick={reload} isLoading={reloading}>Reload latest values</Button>
    </div>
  </Alert>;
}
