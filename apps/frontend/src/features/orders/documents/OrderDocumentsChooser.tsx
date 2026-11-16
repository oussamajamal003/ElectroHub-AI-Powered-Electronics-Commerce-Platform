import { useState } from 'react';
import { FileText, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/Dialog';
import { OrderDocumentsPanel } from './OrderDocumentsPanel';
import styles from './OrderDocuments.module.scss';

/**
 * My Orders card action: a sibling of the card link (never nested in it), stacked above the link's stretched overlay so pointer
 * and keyboard activation open the chooser without navigating. Metadata is fetched only while the chooser is open.
 */
export function OrderDocumentsChooser({ orderReference }: { orderReference: string }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button variant="outline" size="small" className={styles.chooserTrigger} aria-label={`Documents for order ${orderReference}`}>
        <FileText aria-hidden="true" />Documents
      </Button>
    </DialogTrigger>
    <DialogContent className={styles.chooserDialog} hideCloseButton>
      <div className={styles.chooserHeader}>
        <div className={styles.previewTitle}>
          <DialogTitle>Documents</DialogTitle>
          <DialogDescription>Order {orderReference}</DialogDescription>
        </div>
        <DialogClose asChild><Button variant="ghost" size="small" className={styles.closeButton} aria-label="Close documents"><X aria-hidden="true" /></Button></DialogClose>
      </div>
      {open && <OrderDocumentsPanel orderReference={orderReference} variant="chooser" />}
    </DialogContent>
  </Dialog>;
}
