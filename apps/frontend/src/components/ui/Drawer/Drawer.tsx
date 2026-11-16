import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { motion, useReducedMotion } from 'framer-motion';
import { Dialog } from '../Dialog/Dialog';
import { useDialogCloseAutoFocus } from '../Dialog/dialogFocus';
import { X } from 'lucide-react';
import clsx from 'clsx';
import styles from './Drawer.module.scss';

export const Drawer = Dialog;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerPortal = DialogPrimitive.Portal;

export const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => {
  const reducedMotion = useReducedMotion();
  return (
  <DialogPrimitive.Overlay asChild ref={ref} {...props}>
    <motion.div
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.2 }}
      className={clsx(styles.overlay, className)}
    />
  </DialogPrimitive.Overlay>
  );
});
DrawerOverlay.displayName = DialogPrimitive.Overlay.displayName;

export const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ children, className, onCloseAutoFocus, ...props }, ref) => {
  const closeAutoFocus = useDialogCloseAutoFocus(onCloseAutoFocus);
  const reducedMotion = useReducedMotion();
  return (
  <DrawerPortal>
    <DrawerOverlay />
    <DialogPrimitive.Content asChild ref={ref} {...props} onCloseAutoFocus={closeAutoFocus}>
      <motion.div
        initial={reducedMotion ? false : { x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: reducedMotion ? 0 : 0.3, ease: 'circOut' }}
        className={clsx(styles.content, className)}
      >
        {children}
        <DialogPrimitive.Close className={styles.closeButton} aria-label="Close drawer">
          <X className={styles.closeIcon} aria-hidden="true" />
        </DialogPrimitive.Close>
      </motion.div>
    </DialogPrimitive.Content>
  </DrawerPortal>
  );
});
DrawerContent.displayName = DialogPrimitive.Content.displayName;

export const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={clsx(styles.title, className)} {...props} />
));
DrawerTitle.displayName = DialogPrimitive.Title.displayName;

export const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={clsx(styles.description, className)} {...props} />
));
DrawerDescription.displayName = DialogPrimitive.Description.displayName;
