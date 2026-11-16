import React from 'react';
import { clsx } from 'clsx';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { Slot } from '@radix-ui/react-slot';
import styles from './Breadcrumb.module.scss';

export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  separator?: React.ReactNode;
}

export const Breadcrumb = React.forwardRef<HTMLElement, BreadcrumbProps>(
  ({ className, ...props }, ref) => (
    <nav
      ref={ref}
      aria-label="Breadcrumb"
      className={clsx(styles.nav, className)}
      {...props}
    />
  )
);
Breadcrumb.displayName = 'Breadcrumb';

export type BreadcrumbListProps = React.HTMLAttributes<HTMLOListElement>;

export const BreadcrumbList = React.forwardRef<HTMLOListElement, BreadcrumbListProps>(
  ({ className, ...props }, ref) => (
    <ol
      ref={ref}
      className={clsx(styles.list, className)}
      {...props}
    />
  )
);
BreadcrumbList.displayName = 'BreadcrumbList';

export type BreadcrumbItemProps = React.HTMLAttributes<HTMLLIElement>;

export const BreadcrumbItem = React.forwardRef<HTMLLIElement, BreadcrumbItemProps>(
  ({ className, ...props }, ref) => (
    <li
      ref={ref}
      className={clsx(styles.item, className)}
      {...props}
    />
  )
);
BreadcrumbItem.displayName = 'BreadcrumbItem';

export interface BreadcrumbLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  asChild?: boolean;
}

export const BreadcrumbLink = React.forwardRef<HTMLAnchorElement, BreadcrumbLinkProps>(
  ({ className, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : 'a';
    return (
      <Comp
        ref={ref}
        className={clsx(styles.link, className)}
        {...props}
      />
    );
  }
);
BreadcrumbLink.displayName = 'BreadcrumbLink';

export type BreadcrumbPageProps = React.HTMLAttributes<HTMLSpanElement>;

export const BreadcrumbPage = React.forwardRef<HTMLSpanElement, BreadcrumbPageProps>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={clsx(styles.page, className)}
      {...props}
    />
  )
);
BreadcrumbPage.displayName = 'BreadcrumbPage';

export type BreadcrumbSeparatorProps = React.HTMLAttributes<HTMLSpanElement>;

export const BreadcrumbSeparator = React.forwardRef<HTMLSpanElement, BreadcrumbSeparatorProps>(
  ({ className, children, ...props }, ref) => (
    <span
      ref={ref}
      role="presentation"
      aria-hidden="true"
      className={clsx(styles.separator, className)}
      {...props}
    >
      {children ?? <ChevronRight />}
    </span>
  )
);
BreadcrumbSeparator.displayName = 'BreadcrumbSeparator';

export type BreadcrumbEllipsisProps = React.HTMLAttributes<HTMLSpanElement>;

export const BreadcrumbEllipsis = React.forwardRef<HTMLSpanElement, BreadcrumbEllipsisProps>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      role="presentation"
      aria-hidden="true"
      className={clsx(styles.ellipsis, className)}
      {...props}
    >
      <MoreHorizontal className="h-4 w-4" />
      <span style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', borderWidth: 0 }}>More</span>
    </span>
  )
);
BreadcrumbEllipsis.displayName = 'BreadcrumbEllipsis';
