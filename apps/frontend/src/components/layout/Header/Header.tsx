import React from 'react';
import clsx from 'clsx';
import styles from './Header.module.scss';

export type HeaderProps = React.HTMLAttributes<HTMLElement>;

export const Header = React.forwardRef<HTMLElement, HeaderProps>(
  ({ className, children, ...props }, ref) => (
    <header
      ref={ref}
      className={clsx(styles.header, className)}
      {...props}
    >
      <div className={styles.container}>
        {children}
      </div>
    </header>
  )
);
Header.displayName = 'Header';
