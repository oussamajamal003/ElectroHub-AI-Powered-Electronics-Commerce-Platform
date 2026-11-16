import React from 'react';
import { clsx } from 'clsx';
import styles from './ChartContainer.module.scss';
import { Skeleton } from '../Skeleton';

export interface ChartContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The title of the chart.
   */
  title: string;
  /**
   * Optional description text displayed below the title.
   */
  description?: string;
  /**
   * If true, displays the loading skeleton matching the Figma design.
   */
  loading?: boolean;
  /**
   * If true, displays the empty state message.
   */
  empty?: boolean;
  /**
   * The message to display when empty.
   * @default 'No data available'
   */
  emptyMessage?: React.ReactNode;
}

export const ChartContainer = React.forwardRef<HTMLDivElement, ChartContainerProps>(
  (
    {
      className,
      title,
      description,
      loading = false,
      empty = false,
      emptyMessage = 'No data available',
      children,
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={clsx(styles.container, className)}
        {...props}
      >
        {loading ? (
          <div className={styles.loadingContainer}>
            <div className={styles.loadingHeader}>
              <Skeleton width={229} height={47} className={styles.skeletonBlock} />
              <Skeleton width={151} height={47} className={styles.skeletonBlock} />
            </div>
            <div className={styles.loadingContent}>
              <Skeleton width={283} height={47} className={styles.skeletonBlock} />
              <Skeleton width={219} height={47} className={styles.skeletonBlock} />
              <Skeleton width="100%" height={47} className={styles.skeletonBlock} />
            </div>
          </div>
        ) : (
          <>
            <div className={styles.header}>
              <h3 className={styles.title}>{title}</h3>
              {description && <p className={styles.description}>{description}</p>}
            </div>
            <div className={styles.content}>
              {empty ? (
                <div className={styles.empty}>
                  <p>{emptyMessage}</p>
                </div>
              ) : (
                children
              )}
            </div>
          </>
        )}
      </div>
    );
  }
);

ChartContainer.displayName = 'ChartContainer';
