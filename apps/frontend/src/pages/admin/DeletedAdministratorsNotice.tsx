import { Tooltip } from '@/components/ui/Tooltip';
import { useState } from 'react';
import { Info, X } from 'lucide-react';
import { useAcknowledgeDeletionNotice, useDeletionNotice } from '@/features/admin/security/api';
import styles from './DeletedAdministratorsNotice.module.scss';

/**
 * Compact one-time notice for an Owner after administrators were deleted. The server decides whether anything is new and records the
 * acknowledgement per Owner, so it survives refreshes and other devices; this component only shows what the server reports and never
 * receives who was deleted. A failed or non-Owner request simply renders nothing.
 */
export function DeletedAdministratorsNotice({ enabled }: { enabled: boolean }) {
  const notice = useDeletionNotice(enabled);
  const acknowledge = useAcknowledgeDeletionNotice();
  // Close immediately on click; the server acknowledgement runs in the background and the banner returns only if it fails.
  const [closedThrough, setClosedThrough] = useState<string | null>(null);
  const data = notice.data;
  if (!enabled || !data || data.count < 1 || !data.through || closedThrough === data.through) return null;
  const many = data.count > 1;
  return (
    <div className={styles.banner} role="status" aria-label="Administrator deletion notice">
      <Info className={styles.icon} aria-hidden="true" size={18} />
      <div className={styles.text}>
        <p className={styles.title}>{many ? `${data.count} administrator accounts deleted` : 'Administrator account deleted'}</p>
        <p className={styles.body}>
          {many ? 'Administrator accounts were permanently deleted and removed from this list.' : 'An administrator account was permanently deleted and removed from this list.'}
          {' '}Required audit records remain available.
        </p>
      </div>
      <Tooltip content="Dismiss notice"><button type="button" className={styles.dismiss} aria-label="Dismiss notice" onClick={() => {
          const through = data.through!;
          setClosedThrough(through);
          acknowledge.mutate(through, { onError: () => setClosedThrough(null) });
        }}>
        <X aria-hidden="true" size={16} />
      </button></Tooltip>
    </div>
  );
}
