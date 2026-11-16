import React, { createContext, forwardRef, useContext } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { clsx } from 'clsx';
import styles from './Tooltip.module.scss';

/**
 * Tooltip foundation (Radix). One `TooltipProvider` at the app root shares the open delay and the "skip delay" grouping, so sweeping
 * across a toolbar feels instant. A lone `Tooltip` rendered without an ancestor provider (a story, an isolated test) mounts its own.
 *
 * Contract: a tooltip is a *hint*, never the only place essential information lives. It opens on pointer hover and keyboard focus,
 * closes on Escape/blur/pointer-leave, and Radix deliberately does not open it on touch taps, so touch and screen-reader users must
 * already have the same meaning from the control's accessible name (`aria-label`) or adjacent text.
 */
const ProviderPresent = createContext(false);

export const TooltipProvider = ({ children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) => (
  <ProviderPresent.Provider value>
    <TooltipPrimitive.Provider {...props}>{children}</TooltipPrimitive.Provider>
  </ProviderPresent.Provider>
);

export const TooltipRoot = TooltipPrimitive.Root;

export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, collisionPadding = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={clsx(styles.content, className)}
      {...props}
    >
      {props.children}
      <TooltipPrimitive.Arrow className={styles.arrow} />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export interface TooltipProps extends React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root> {
  content: React.ReactNode;
  children: React.ReactNode;
  sideOffset?: number;
  /** Preferred side of the trigger (Radix flips it when there is no room). */
  side?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['side'];
  contentClassName?: string;
  delayDuration?: number;
  /**
   * For a control that is `disabled` (browsers send no hover or focus events to it): wrap it in a keyboard-focusable span that owns the
   * tooltip, so the reason it is unavailable is still reachable. Use it only to explain *why*; never to make the action interactive.
   */
  focusableWrapper?: boolean;
}

export function Tooltip({
  content,
  children,
  sideOffset = 4,
  side,
  contentClassName,
  delayDuration,
  focusableWrapper,
  ...props
}: TooltipProps) {
  const hasProvider = useContext(ProviderPresent);
  const root = (
    <TooltipRoot {...props}>
      <TooltipTrigger asChild>
        {focusableWrapper
          ? <span className={styles.disabledWrapper} tabIndex={0} data-tooltip-disabled-wrapper="">{children}</span>
          : children}
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={sideOffset} className={contentClassName}>
        {content}
      </TooltipContent>
    </TooltipRoot>
  );
  // `delayDuration` on a single tooltip needs a provider of its own; otherwise the shared provider's delay applies.
  return hasProvider && delayDuration === undefined ? root : <TooltipProvider delayDuration={delayDuration}>{root}</TooltipProvider>;
}
