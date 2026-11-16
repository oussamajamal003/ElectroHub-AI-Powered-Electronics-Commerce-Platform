import { useId, useRef } from 'react';
import clsx from 'clsx';
import { ClipboardList, Download, Eye, FileText, Info, ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { DocumentPreviewDialog } from './DocumentPreviewDialog';
import { unavailableCopy, type DocumentKind, type OrderDocumentEntry } from './types';
import { useDocumentActions, useOrderDocumentsQuery } from './useOrderDocuments';
import styles from './OrderDocuments.module.scss';

const ICONS: Record<DocumentKind, typeof FileText> = { invoice: FileText, receipt: ReceiptText, summary: ClipboardList };

interface Props {
  orderReference: string;
  /** confirmation: "Your documents" card under the purchase summary; details: aside card; chooser: body of the My Orders dialog. */
  variant: 'confirmation' | 'details' | 'chooser';
}

/**
 * Task 03.9 document list shared by Confirmation, Order Details and the My Orders chooser. Loading, errors and busy states stay
 * inside this panel; the surrounding order content is never blocked or replaced.
 */
export function OrderDocumentsPanel({ orderReference, variant }: Props) {
  const headingId = useId();
  const query = useOrderDocumentsQuery(orderReference);
  const actions = useDocumentActions(orderReference);
  // The opener is restored explicitly: the preview dialog mounts while the click is still being handled.
  const opener = useRef<HTMLButtonElement | null>(null);
  const documents = query.data?.documents;
  const title = variant === 'confirmation' ? 'Your documents' : 'Documents';
  const Tag = variant === 'chooser' ? 'div' : 'section';

  return <Tag data-order-documents="" className={clsx(styles.panel, styles[variant])} {...(variant === 'chooser' ? {} : { 'aria-labelledby': headingId })}
    aria-busy={query.isFetching || Boolean(actions.busy) || undefined}>
    {variant !== 'chooser' && <h2 id={headingId} className={styles.heading}>{title}</h2>}
    {query.isPending && <div role="status" aria-label="Loading documents" className={styles.list}>
      {[0, 1, 2].map(index => <div key={index} className={styles.row} aria-hidden="true">
        <Skeleton width={36} height={36} /><div className={styles.skeletonText}><Skeleton width="45%" height={16} /><Skeleton width="80%" height={13} /></div>
      </div>)}
    </div>}
    {query.isError && !documents && <div className={styles.panelError} role="alert">
      <p>Documents could not be loaded. Your order is not affected.</p>
      <Button variant="outline" size="small" className={styles.action} onClick={() => void query.refetch()} isLoading={query.isFetching}>Retry</Button>
    </div>}
    {documents && <ul className={styles.list}>
      {documents.map(entry => <DocumentRow key={entry.kind} entry={entry} orderReference={query.data?.orderReference ?? orderReference} actions={actions}
        onView={button => { opener.current = button; void actions.view(entry); }} />)}
    </ul>}
    {query.isError && documents && <p className={styles.staleNote} role="status">Couldn’t refresh document availability. Showing the last loaded list.</p>}
    <p className={styles.visuallyHidden} role="status" aria-live="polite">{actions.announcement}</p>
    {actions.coolingDown && <p className={styles.staleNote} role="status">Please wait a few seconds before requesting another document.</p>}
    <DocumentPreviewDialog preview={actions.preview} orderReference={query.data?.orderReference ?? orderReference}
      onClose={actions.closePreview} onDownload={actions.downloadPreviewed} onRetry={actions.retryPreview} restoreFocusTo={opener} />
  </Tag>;
}

function DocumentRow({ entry, orderReference, actions, onView }: { entry: OrderDocumentEntry; orderReference: string;
  actions: ReturnType<typeof useDocumentActions>; onView: (button: HTMLButtonElement) => void }) {
  const Icon = ICONS[entry.kind];
  const available = entry.availability === 'AVAILABLE';
  const busy = actions.busy?.kind === entry.kind ? actions.busy.action : null;
  const locked = Boolean(actions.busy) || actions.coolingDown;
  const error = actions.errors[entry.kind];
  return <li className={clsx(styles.row, !available && styles.unavailableRow)}>
    <span className={styles.icon} aria-hidden="true"><Icon /></span>
    <div className={styles.text}>
      <strong className={styles.name}>{entry.label}</strong>
      <span className={styles.description}>{entry.description}</span>
      {!available && <span className={styles.reason}><Info aria-hidden="true" />{unavailableCopy(entry.reasonCode)}</span>}
      {error && <span className={styles.rowError} role="alert">{error}</span>}
    </div>
    {available && <div className={styles.actions}>
      {/* View stays enabled while its own preview loads (the dialog shows that state) so focus can return to it on close. */}
      <Button variant="outline" size="small" className={styles.action} onClick={event => onView(event.currentTarget)} disabled={locked && busy !== 'view'}
        aria-label={`View PDF: ${entry.label}, order ${orderReference}`}><Eye aria-hidden="true" />View PDF</Button>
      <Button variant="outline" size="small" className={styles.action} onClick={() => void actions.download(entry)} disabled={locked && busy !== 'download'}
        isLoading={busy === 'download'} aria-label={`Download PDF: ${entry.label}, order ${orderReference}`}>
        <Download aria-hidden="true" />{busy === 'download' ? 'Preparing…' : 'Download PDF'}</Button>
    </div>}
  </li>;
}
