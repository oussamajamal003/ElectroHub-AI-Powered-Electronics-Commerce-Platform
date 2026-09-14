import React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { User } from 'lucide-react';
import { clsx } from 'clsx';
import styles from './Avatar.module.scss';

export interface AvatarProps extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> {
  src?: string;
  alt?: string;
  initials?: string;
}

export const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  AvatarProps
>(({ className, src, alt, initials, ...props }, ref) => {
  return (
    <AvatarPrimitive.Root
      ref={ref}
      className={clsx(styles.root, className)}
      {...props}
    >
      <AvatarPrimitive.Image
        src={src}
        alt={alt}
        className={styles.image}
      />
      <AvatarPrimitive.Fallback
        className={styles.fallback}
      >
        {initials ? (
          <span className={styles.initials}>{initials}</span>
        ) : (
          <User className={styles.icon} />
        )}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
});

Avatar.displayName = AvatarPrimitive.Root.displayName;
