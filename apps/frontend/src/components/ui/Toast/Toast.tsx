import React from 'react';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import clsx from 'clsx';
import styles from './Toast.module.scss';

export const ToastProvider = ToastPrimitives.Provider;

export const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={clsx(styles.viewport, className)}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

export interface ToastProps extends React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> {
  variant?: 'default' | 'success' | 'error' | 'info';
  hideIcon?: boolean;
}

export const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  ToastProps
>(({ className, variant = 'default', hideIcon, children, ...props }, ref) => {
  let DefaultIcon = null;
  if (!hideIcon) {
    if (variant === 'success') DefaultIcon = <CheckCircle2 className={styles.iconSvg} />;
    else if (variant === 'error') DefaultIcon = <AlertCircle className={styles.iconSvg} />;
    else if (variant === 'info') DefaultIcon = <Info className={styles.iconSvg} />;
  }

  return (
    <ToastPrimitives.Root
      ref={ref}
      className={clsx(styles.toast, styles[`variant-${variant}`], className)}
      {...props}
    >
      {DefaultIcon && (
        <div className={styles.iconWrapper}>
          {DefaultIcon}
        </div>
      )}
      <div className={styles.content}>
        {children}
      </div>
    </ToastPrimitives.Root>
  );
});
Toast.displayName = ToastPrimitives.Root.displayName;

export const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={clsx(styles.title, className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

export const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={clsx(styles.description, className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

export const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={clsx(styles.closeButton, className)}
    toast-close=""
    {...props}
  >
    <X className={styles.closeIcon} />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

export const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={clsx(styles.actionButton, className)}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;
