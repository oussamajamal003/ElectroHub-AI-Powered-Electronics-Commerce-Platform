import React from 'react';
import clsx from 'clsx';
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import styles from './Alert.module.scss';

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info';
  icon?: React.ReactNode;
  onDismiss?: () => void;
  hideIcon?: boolean;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = 'default', icon, onDismiss, hideIcon, children, ...props }, ref) => {
    let DefaultIcon = null;
    if (!hideIcon) {
      if (variant === 'success') DefaultIcon = <CheckCircle2 className={styles.iconSvg} />;
      else if (variant === 'error') DefaultIcon = <AlertCircle className={styles.iconSvg} />;
      else if (variant === 'warning') DefaultIcon = <AlertTriangle className={styles.iconSvg} />;
      else if (variant === 'info') DefaultIcon = <Info className={styles.iconSvg} />;
    }

    return (
      <div
        ref={ref}
        role="alert"
        className={clsx(
          styles.alert,
          styles[`variant-${variant}`],
          className
        )}
        {...props}
      >
        {!hideIcon && (icon || DefaultIcon) && (
          <div className={styles.iconWrapper}>
            {icon || DefaultIcon}
          </div>
        )}
        <div className={styles.content}>
          {children}
        </div>
        {onDismiss && (
          <button
            type="button"
            className={styles.closeButton}
            onClick={onDismiss}
            aria-label="Close alert"
          >
            <X className={styles.closeIcon} />
          </button>
        )}
      </div>
    );
  }
);
Alert.displayName = 'Alert';

export const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={clsx(styles.title, className)}
      {...props}
    />
  )
);
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={clsx(styles.description, className)}
      {...props}
    />
  )
);
AlertDescription.displayName = 'AlertDescription';
