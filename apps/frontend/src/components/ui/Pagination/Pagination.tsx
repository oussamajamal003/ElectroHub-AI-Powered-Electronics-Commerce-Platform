import React from 'react';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import styles from './Pagination.module.scss';

export type PaginationProps = React.ComponentProps<'nav'>;

export const Pagination = React.forwardRef<HTMLElement, PaginationProps>(
  ({ className, ...props }, ref) => (
    <nav
      ref={ref}
      role="navigation"
      aria-label="pagination"
      className={clsx(styles.nav, className)}
      {...props}
    />
  )
);
Pagination.displayName = 'Pagination';

export const PaginationContent = React.forwardRef<
  HTMLUListElement,
  React.ComponentProps<'ul'>
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    className={clsx(styles.list, className)}
    {...props}
  />
));
PaginationContent.displayName = 'PaginationContent';

export const PaginationItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentProps<'li'>
>(({ className, ...props }, ref) => (
  <li ref={ref} className={clsx(styles.item, className)} {...props} />
));
PaginationItem.displayName = 'PaginationItem';

type PaginationLinkProps = React.ComponentProps<'button'> & {
  isActive?: boolean;
};

export const PaginationLink = React.forwardRef<
  HTMLButtonElement,
  PaginationLinkProps
>(({ className, isActive, disabled, children, ...props }, ref) => (
  <button
    ref={ref}
    aria-current={isActive ? 'page' : undefined}
    disabled={disabled}
    className={clsx(
      styles.link,
      isActive && styles.active,
      className
    )}
    {...props}
  >
    {children}
  </button>
));
PaginationLink.displayName = 'PaginationLink';

export const PaginationPrevious = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof PaginationLink>
>(({ className, ...props }, ref) => (
  <PaginationLink
    ref={ref}
    aria-label="Go to previous page"
    className={clsx(styles.previous, className)}
    {...props}
  >
    <ChevronLeft className="h-4 w-4" />
  </PaginationLink>
));
PaginationPrevious.displayName = 'PaginationPrevious';

export const PaginationNext = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof PaginationLink>
>(({ className, ...props }, ref) => (
  <PaginationLink
    ref={ref}
    aria-label="Go to next page"
    className={clsx(styles.next, className)}
    {...props}
  >
    <ChevronRight className="h-4 w-4" />
  </PaginationLink>
));
PaginationNext.displayName = 'PaginationNext';

export const PaginationEllipsis = React.forwardRef<
  HTMLSpanElement,
  React.ComponentProps<'span'>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    aria-hidden="true"
    className={clsx(styles.ellipsis, className)}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
    <span style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', borderWidth: 0 }}>More pages</span>
  </span>
));
PaginationEllipsis.displayName = 'PaginationEllipsis';
