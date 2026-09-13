import React from 'react';
import { clsx } from 'clsx';
import styles from './Sidebar.module.scss';

export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  collapsed?: boolean;
}

export const Sidebar = React.forwardRef<HTMLElement, SidebarProps>(
  ({ className, collapsed = false, children, ...props }, ref) => {
    return (
      <nav
        ref={ref}
        className={clsx(styles.sidebar, collapsed && styles.collapsed, className)}
        {...props}
      >
        {children}
      </nav>
    );
  }
);
Sidebar.displayName = 'Sidebar';

export interface SidebarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
  collapsed?: boolean;
}

export const SidebarGroup = React.forwardRef<HTMLDivElement, SidebarGroupProps>(
  ({ className, label, collapsed = false, children, ...props }, ref) => {
    return (
      <div ref={ref} className={clsx(styles.group, className)} {...props}>
        {label && (
          <div className={clsx(styles.groupLabel, collapsed && styles.collapsed)}>
            {collapsed ? label.charAt(0) : label}
          </div>
        )}
        {children}
      </div>
    );
  }
);
SidebarGroup.displayName = 'SidebarGroup';

export interface SidebarItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  active?: boolean;
  collapsed?: boolean;
}

export const SidebarItem = React.forwardRef<HTMLButtonElement, SidebarItemProps>(
  ({ className, icon, active = false, collapsed = false, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={clsx(
          styles.item,
          active && styles.active,
          collapsed && styles.collapsed,
          className
        )}
        disabled={disabled}
        aria-current={active ? 'page' : undefined}
        {...props}
      >
        {icon && <div className={styles.icon}>{icon}</div>}
        {!collapsed && <div className={styles.label}>{children}</div>}
      </button>
    );
  }
);
SidebarItem.displayName = 'SidebarItem';
