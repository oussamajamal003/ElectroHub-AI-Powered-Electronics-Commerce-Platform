import React from 'react';
import clsx from 'clsx';
import { AlertCircle } from 'lucide-react';
import styles from './ErrorState.module.scss';

export interface ErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export const ErrorState = React.forwardRef<HTMLDivElement, ErrorStateProps>(
  ({ className, title, description, action, icon, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={clsx(styles.errorState, className)}
        role="alert"
        {...props}
      >
        <div className={styles.iconWrapper} aria-hidden="true">
          {icon || <AlertCircle className={styles.defaultIcon} />}
        </div>
        <h3 className={styles.title}>{title}</h3>
        {description && <p className={styles.description}>{description}</p>}
        {action && <div className={styles.actionWrapper}>{action}</div>}
      </div>
    );
  }
);
ErrorState.displayName = 'ErrorState';
