import { apiClient } from '@/lib/api';
const endpoint = '/api/auth/customer/push';
const storageKey = 'electrohub:delivery-push';
type Binding = { userId: string; id: string };
let cleanup = Promise.resolve();
let identityGeneration = 0;
export function pushSupported() { return typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
export function binding(): Binding | null { try { const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null'); return value && typeof value.userId === 'string' && typeof value.id === 'string' ? value : null; } catch { return null; } }
export function clearBrowserPush() {
  identityGeneration++;
  try { localStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
  cleanup = cleanup.then(async () => {
  if (!('serviceWorker' in navigator)) return;
  try { const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration?.active?.scriptURL.endsWith('/delivery-push-sw.js')) return;
    registration.active.postMessage({ type: 'CLEAR_DELIVERY_NOTIFICATIONS' });
    const subscription = await registration.pushManager.getSubscription(); if (subscription) await subscription.unsubscribe();
  } catch { /* Server-side session invalidation and receipt authorization remain authoritative. */ }
  });
  return cleanup;
}
export async function pushStatus(userId: string) {
  const local = binding();
  if (local && local.userId !== userId) await clearBrowserPush();
  const id = local?.userId === userId ? local.id : null;
  const result = (await apiClient<{ data: { available: boolean; publicKey: string | null; enabled: boolean } }>(endpoint + (id ? '?id=' + encodeURIComponent(id) : ''))).data;
  if (!pushSupported()) return { ...result, enabled: false };
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  const browserEnabled = Boolean(subscription && Notification.permission === 'granted');
  if (id && result.enabled && !browserEnabled) await apiClient(endpoint + '/' + id, { method: 'DELETE' });
  if (!result.enabled && subscription) await clearBrowserPush();
  return { ...result, enabled: result.enabled && browserEnabled };
}
export async function enablePush(userId: string) {
  if (!pushSupported()) throw new Error('This browser does not support delivery notifications.');
  const generation = identityGeneration;
  // Called directly from the button, before any network await (Safari requires a user gesture).
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notifications are blocked. You can allow them in your browser settings.' : 'Permission was not granted. You can try again when ready.');
  const config = await pushStatus(userId);
  await cleanup;
  if (identityGeneration !== generation) throw new Error('Your session or browser subscription changed. Please enable notifications again.');
  if (!config.available || !config.publicKey) throw new Error('Delivery notifications are not available yet. Please try again later.');
  const registration = await navigator.serviceWorker.register('/delivery-push-sw.js', { scope: '/', updateViaCache: 'none' });
  await navigator.serviceWorker.ready;
  const bytes = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    try { subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes }); }
    catch (error) {
      // Chromium reports an unreachable/disabled browser push provider as this opaque DOMException.
      // Keep the browser's permission grant intact and give the customer a useful recovery step.
      if (error instanceof Error && /registration failed.*push service error/i.test(error.message)) {
        throw new Error('Your browser could not reach its push service. Check that browser notifications are allowed, then try again.');
      }
      throw error;
    }
  }
  try {
    if (identityGeneration !== generation) throw new Error('Your session changed. Sign in again to enable notifications.');
    const response = await apiClient<{ data: { id: string } }>(endpoint, { method: 'POST', data: subscription.toJSON() });
    if (identityGeneration !== generation) throw new Error('Your session changed. Sign in again to enable notifications.');
    localStorage.setItem(storageKey, JSON.stringify({ userId, id: response.data.id }));
  } catch (error) { await subscription.unsubscribe(); throw error; }
}
export async function disablePush(userId: string) {
  const local = binding();
  if (local?.userId === userId) await apiClient(endpoint + '/' + local.id, { method: 'DELETE' });
  await clearBrowserPush();
}
