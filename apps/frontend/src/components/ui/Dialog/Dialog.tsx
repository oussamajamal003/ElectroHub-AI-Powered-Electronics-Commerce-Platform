import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import styles from './Dialog.module.scss';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay asChild ref={ref} {...props}>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className={`${styles.overlay} ${className || ''}`.trim()}
    />
  </DialogPrimitive.Overlay>
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { 
    overlayClassName?: string;
    containerClassName?: string;
    hideCloseButton?: boolean;
  }
>(({ children, className, overlayClassName, containerClassName, hideCloseButton, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <div className={`${styles.container} ${containerClassName || ''}`.trim()}>
      <DialogPrimitive.Content asChild ref={ref} {...props}>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
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
));
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
