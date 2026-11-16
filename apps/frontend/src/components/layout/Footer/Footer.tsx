import React from 'react';
import clsx from 'clsx';
import styles from './Footer.module.scss';

export type FooterProps = React.HTMLAttributes<HTMLElement>;

export const Footer = React.forwardRef<HTMLElement, FooterProps>(
  ({ className, children, ...props }, ref) => (
    <footer
      ref={ref}
      className={clsx(styles.footer, className)}
      {...props}
    >
      <div className={styles.container}>
        {children}
      </div>
    </footer>
  )
);
Footer.displayName = 'Footer';
