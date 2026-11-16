import type { RefObject } from 'react';
import { Download, FileWarning, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import type { PreviewState } from './useOrderDocuments';
import styles from './OrderDocuments.module.scss';

interface Props {
  preview: PreviewState | null;
  orderReference: string;
  onClose: () => void;
  onDownload: () => void;
  onRetry: () => void;
  restoreFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * App-controlled preview of the actual returned PDF (blob URL in the browser's native viewer). Opens immediately with a scoped
 * loading state; Close and Download stay reachable at every width; a browser without an inline PDF viewer gets a working
 * Download fallback instead of a blank frame. Focus returns to the View button that opened it.
 */
export function DocumentPreviewDialog({ preview, orderReference, onClose, onDownload, onRetry, restoreFocusTo }: Props) {
  const label = preview?.entry.label ?? 'Document';
  return <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className={styles.previewDialog} containerClassName={styles.previewContainer} hideCloseButton
      onCloseAutoFocus={event => { if (restoreFocusTo?.current?.isConnected) { event.preventDefault(); restoreFocusTo.current.focus(); } }}>
      <div className={styles.previewHeader}>
        <div className={styles.previewTitle}>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>PDF preview for order {orderReference}</DialogDescription>
        </div>
        <div className={styles.previewActions}>
          <Button variant="outline" size="small" onClick={onDownload} disabled={!preview || preview.status === 'loading'}
            aria-label={`Download PDF: ${label}, order ${orderReference}`}><Download aria-hidden="true" />Download PDF</Button>
          <DialogClose asChild><Button variant="ghost" size="small" className={styles.closeButton} aria-label="Close preview"><X aria-hidden="true" /></Button></DialogClose>
        </div>
      </div>
      <div className={styles.viewer} aria-busy={preview?.status === 'loading' || undefined}>
        {preview?.status === 'loading' && <div className={styles.viewerState} role="status">
          <span className={styles.spinner} aria-hidden="true" /><p>Preparing your PDF…</p></div>}
        {preview?.status === 'ready' && preview.url && <iframe className={styles.frame} src={preview.url} title={`${label} for order ${orderReference}`} />}
        {preview?.status === 'unsupported' && <div className={styles.viewerState}>
          <FileWarning aria-hidden="true" className={styles.stateIcon} />
          <p>This browser can’t show PDFs inside the page.</p>
          <p className={styles.muted}>Download the PDF to open it in your PDF reader.</p>
          <Button onClick={onDownload}><Download aria-hidden="true" />Download PDF</Button>
        </div>}
        {preview?.status === 'error' && <div className={styles.viewerState} role="alert">
          <FileWarning aria-hidden="true" className={styles.stateIcon} />
          <p>{preview.message}</p>
          <Button variant="outline" onClick={onRetry}>Try again</Button>
        </div>}
      </div>
      {preview?.status === 'ready' && <p className={styles.previewHint}>Preview not showing? Use Download PDF to open it in your PDF reader.</p>}
    </DialogContent>
  </Dialog>;
}
