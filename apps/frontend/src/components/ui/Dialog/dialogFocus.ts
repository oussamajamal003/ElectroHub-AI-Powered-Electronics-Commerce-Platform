import { createContext, useContext, useEffect, useRef } from 'react';

export const DialogReturnFocus = createContext<HTMLElement | null>(null);

/** Controlled overlays can open without a Radix Trigger; preserve their real opener. */
export function useDialogCloseAutoFocus(onCloseAutoFocus?: (event: Event) => void) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const opener = useContext(DialogReturnFocus);
  useEffect(() => { if (opener) returnFocus.current = opener; }, [opener]);
  return (event: Event) => {
    onCloseAutoFocus?.(event);
    if (!event.defaultPrevented && returnFocus.current?.isConnected && returnFocus.current !== document.body) {
      event.preventDefault();
      returnFocus.current.focus();
    }
  };
}
