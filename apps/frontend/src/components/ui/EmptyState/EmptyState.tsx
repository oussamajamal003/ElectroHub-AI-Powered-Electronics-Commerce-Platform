import React from 'react';
import clsx from 'clsx';
import styles from './EmptyState.module.scss';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Heading level for the title so the state fits the page outline (defaults to h3). */
  headingLevel?: 2 | 3;
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon, title, description, action, headingLevel = 3, ...props }, ref) => (
    <div
      ref={ref}
      className={clsx(styles.emptyState, className)}
      {...props}
    >
      {icon && <div className={styles.iconWrapper}>{icon}</div>}
      {headingLevel === 2 ? <h2 className={styles.title}>{title}</h2> : <h3 className={styles.title}>{title}</h3>}
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.actionWrapper}>{action}</div>}
    </div>
  )
);
EmptyState.displayName = 'EmptyState';
