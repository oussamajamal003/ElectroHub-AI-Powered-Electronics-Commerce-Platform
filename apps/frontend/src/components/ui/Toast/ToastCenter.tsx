import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useInRouterContext, useLocation } from 'react-router-dom';
import { Toast, ToastAction, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from './Toast';
import { getActiveToastHost, getToasts, registerToastHost, subscribeToasts, toast, type ToastItem } from './toastStore';

/**
 * The single toast renderer. Mount once near the app root; extra instances (a page-level `AdminToastProvider`, a story, a test) stay
 * inert, so a toast is never rendered or announced twice.
 *
 * Accessibility: Radix announces each toast once through its own live region. Errors and warnings are `foreground` (assertive) because
 * they need attention; success/info/loading are `background` (polite). Toasts never take focus. F8 jumps to the viewport (Radix hotkey)
 * and every toast has a labelled dismiss button, so keyboard and screen-reader users can reach and clear them.
 */
export function ToastCenter() {
  const hostRef = useRef<symbol>(Symbol('toast-host'));
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  const inRouter = useInRouterContext();
  const activeHost = useSyncExternalStore(subscribeToasts, getActiveToastHost, getActiveToastHost);
  useEffect(() => registerToastHost(hostRef.current), []);

  if (activeHost !== hostRef.current) return null;
  return <ToastProvider swipeDirection="right" label="Notifications">
    {inRouter && <DismissPendingOnNavigation />}
    {items.map(item => <ToastEntry key={item.id} item={item} />)}
    <ToastViewport data-testid="toast-viewport" />
  </ToastProvider>;
}

/** Pending (`loading`) toasts describe work tied to the page that started it; they do not follow the user to another route. */
function DismissPendingOnNavigation() {
  const { pathname } = useLocation();
  const first = useRef(pathname);
  useEffect(() => {
    if (first.current === pathname) return;
    first.current = pathname;
    for (const item of getToasts()) if (item.variant === 'loading') toast.dismiss(item.id);
  }, [pathname]);
  return null;
}

function ToastEntry({ item }: { item: ToastItem }) {
  const urgent = item.variant === 'error' || item.variant === 'warning';
  return <Toast open variant={item.variant} type={urgent ? 'foreground' : 'background'} duration={item.duration || Infinity}
    onOpenChange={open => { if (!open) toast.dismiss(item.id); }} data-toast-variant={item.variant}>
    {item.announce
      ? <><ToastTitle>{item.title}</ToastTitle>{item.description && <ToastDescription>{item.description}</ToastDescription>}</>
      : <div data-radix-toast-announce-exclude=""><ToastTitle>{item.title}</ToastTitle>{item.description && <ToastDescription>{item.description}</ToastDescription>}</div>}
    {item.action && <ToastAction altText={item.action.altText ?? item.action.label}
      onClick={() => { item.action?.onClick(); toast.dismiss(item.id); }}>{item.action.label}</ToastAction>}
    <ToastClose aria-label="Dismiss notification" />
  </Toast>;
}
