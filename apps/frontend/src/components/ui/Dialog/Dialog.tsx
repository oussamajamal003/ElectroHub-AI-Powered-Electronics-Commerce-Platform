import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import styles from './Dialog.module.scss';

const DialogReturnFocus = React.createContext<HTMLElement | null>(null);

export function Dialog({ open, defaultOpen = false, onOpenChange, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const [localOpen, setLocalOpen] = React.useState(defaultOpen);
  const isOpen = open ?? localOpen;
  // Capture before children mount: an input's autoFocus can run before Radix's open-focus event.
  const opener = React.useMemo(() => isOpen && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement : null, [isOpen]);
  return <DialogReturnFocus.Provider value={opener}>
    <DialogPrimitive.Root {...props} open={isOpen} onOpenChange={next => {
      if (open === undefined) setLocalOpen(next);
      onOpenChange?.(next);
    }} />
  </DialogReturnFocus.Provider>;
}
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => {
  const reducedMotion = useReducedMotion();
  return (
  <DialogPrimitive.Overlay asChild ref={ref} {...props}>
    <motion.div
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.2 }}
      className={`${styles.overlay} ${className || ''}`.trim()}
    />
  </DialogPrimitive.Overlay>
  );
});
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { 
    overlayClassName?: string;
    containerClassName?: string;
    hideCloseButton?: boolean;
  }
>(({ children, className, overlayClassName, containerClassName, hideCloseButton, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const opener = React.useContext(DialogReturnFocus);
  const reducedMotion = useReducedMotion();
  React.useEffect(() => { if (opener) returnFocus.current = opener; }, [opener]);
  return (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <div className={`${styles.container} ${containerClassName || ''}`.trim()}>
      <DialogPrimitive.Content asChild ref={ref} {...props}
        onOpenAutoFocus={event => {
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={event => {
          onCloseAutoFocus?.(event);
          // Controlled dialogs may have no Radix Trigger. Keep their keyboard return target as well.
          if (!event.defaultPrevented && returnFocus.current?.isConnected && returnFocus.current !== document.body) {
            event.preventDefault();
            returnFocus.current.focus();
          }
        }}>
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.2, ease: 'easeOut' }}
          className={`${styles.content} ${className || ''}`.trim()}
        >
          {children}
          {!hideCloseButton && (
            <DialogPrimitive.Close className={styles.closeButton} aria-label="Close">
              <X className={styles.closeIcon} aria-hidden="true" />
            </DialogPrimitive.Close>
          )}
        </motion.div>
      </DialogPrimitive.Content>
    </div>
  </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={`${styles.title} ${className || ''}`.trim()} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={`${styles.description} ${className || ''}`.trim()} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;
