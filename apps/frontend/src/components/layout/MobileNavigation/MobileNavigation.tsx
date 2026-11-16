import React from 'react';
import clsx from 'clsx';
import { Menu } from 'lucide-react';
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
  DrawerOverlay,
  DrawerPortal
} from '../../ui/Drawer';
import { IconButton } from '../../ui/IconButton';
import styles from './MobileNavigation.module.scss';

export interface MobileNavigationProps {
  className?: string;
  triggerIcon?: React.ReactNode;
  children?: React.ReactNode;
}

export const MobileNavigation: React.FC<MobileNavigationProps> = ({
  className,
  triggerIcon = <Menu />,
  children,
}) => {
  return (
    <div className={clsx(styles.mobileNavigation, className)}>
      <Drawer>
        <DrawerTrigger asChild>
          <IconButton aria-label="Open mobile navigation" icon={triggerIcon} />
        </DrawerTrigger>
        <DrawerPortal>
          <DrawerOverlay />
          <DrawerContent className={styles.content}>
            <DrawerTitle className={styles.srOnly}>Mobile Navigation</DrawerTitle>
            <DrawerDescription className={styles.srOnly}>
              Use the links below to navigate the application on mobile.
            </DrawerDescription>
            <nav className={styles.nav}>
              {children}
            </nav>
          </DrawerContent>
        </DrawerPortal>
      </Drawer>
    </div>
  );
};

export const MobileNavigationList = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  ({ className, children, ...props }, ref) => (
    <ul ref={ref} className={clsx(styles.list, className)} {...props}>
      {children}
    </ul>
  )
);
MobileNavigationList.displayName = 'MobileNavigationList';

export const MobileNavigationItem = React.forwardRef<HTMLLIElement, React.LiHTMLAttributes<HTMLLIElement>>(
  ({ className, children, ...props }, ref) => (
    <li ref={ref} className={clsx(styles.item, className)} {...props}>
      {children}
    </li>
  )
);
MobileNavigationItem.displayName = 'MobileNavigationItem';
