import React from 'react';
import clsx from 'clsx';
import styles from './AdminForm.module.scss';

export type AdminFormProps = React.FormHTMLAttributes<HTMLFormElement>;

export const AdminForm = React.forwardRef<HTMLFormElement, AdminFormProps>(
  ({ className, ...props }, ref) => (
    <form
      ref={ref}
      className={clsx(styles.form, className)}
      {...props}
    />
  )
);
AdminForm.displayName = 'AdminForm';

export const AdminFormHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={clsx(styles.header, className)}
      {...props}
    />
  )
);
AdminFormHeader.displayName = 'AdminFormHeader';

export const AdminFormTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={clsx(styles.title, className)}
      {...props}
    />
  )
);
AdminFormTitle.displayName = 'AdminFormTitle';

export const AdminFormContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={clsx(styles.content, className)}
      {...props}
    />
  )
);
AdminFormContent.displayName = 'AdminFormContent';

export const AdminFormActions = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={clsx(styles.actions, className)}
      {...props}
    />
  )
);
AdminFormActions.displayName = 'AdminFormActions';
