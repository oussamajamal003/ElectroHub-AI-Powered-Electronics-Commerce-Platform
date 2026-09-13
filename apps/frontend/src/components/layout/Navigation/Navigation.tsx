import React from 'react';
import clsx from 'clsx';
import styles from './Navigation.module.scss';

export type NavigationProps = React.HTMLAttributes<HTMLElement>;

export const Navigation = React.forwardRef<HTMLElement, NavigationProps>(
  ({ className, children, ...props }, ref) => (
    <nav
      ref={ref}
      className={clsx(styles.nav, className)}
      {...props}
    >
      {children}
    </nav>
  )
);
Navigation.displayName = 'Navigation';

export type NavigationListProps = React.HTMLAttributes<HTMLUListElement>;

export const NavigationList = React.forwardRef<HTMLUListElement, NavigationListProps>(
  ({ className, children, ...props }, ref) => (
    <ul
      ref={ref}
      className={clsx(styles.list, className)}
      {...props}
    >
      {children}
    </ul>
  )
);
NavigationList.displayName = 'NavigationList';

export type NavigationItemProps = React.LiHTMLAttributes<HTMLLIElement>;

export const NavigationItem = React.forwardRef<HTMLLIElement, NavigationItemProps>(
  ({ className, children, ...props }, ref) => (
    <li
      ref={ref}
      className={clsx(styles.item, className)}
      {...props}
    >
      {children}
    </li>
  )
);
NavigationItem.displayName = 'NavigationItem';
