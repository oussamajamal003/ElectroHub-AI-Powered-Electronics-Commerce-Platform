import { apiClient, ApiError } from '@/lib/api';
const endpoint = '/api/auth/customer/push';
const storageKey = 'electrohub:delivery-push';
type Binding = { userId: string; id: string };
export type PushSetupStage = 'permission' | 'server_check' | 'server_configuration' | 'service_worker' | 'push_provider' | 'subscription_persistence';
export class PushSetupError extends Error {
  constructor(readonly stage: PushSetupStage, message: string) { super(message); this.name = 'PushSetupError'; }
}
type PushStatus = { available: boolean; availability?: 'ready' | 'disabled' | 'misconfigured'; publicKey: string | null;
  enabled: boolean; serviceWorkerRegistered: boolean; browserSubscription: boolean };
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
  let result: Omit<PushStatus, 'serviceWorkerRegistered' | 'browserSubscription'>;
  try {
    result = (await apiClient<{ data: Omit<PushStatus, 'serviceWorkerRegistered' | 'browserSubscription'> }>(endpoint + (id ? '?id=' + encodeURIComponent(id) : ''))).data;
  } catch (error) {
    const message = error instanceof ApiError && error.status === 401 ? 'Sign in again to check delivery notification settings.'
      : 'We could not check the server notification setup. Check your connection and try again.';
    throw new PushSetupError('server_check', message);
  }
  if (!pushSupported()) return { ...result, enabled: false, serviceWorkerRegistered: false, browserSubscription: false };
  let registration: ServiceWorkerRegistration | undefined;
  let subscription: PushSubscription | null = null;
  try {
    registration = await navigator.serviceWorker.getRegistration('/');
    subscription = await registration?.pushManager.getSubscription() ?? null;
  } catch {
    throw new PushSetupError('service_worker', 'This browser could not check its notification worker. Check site permissions and try again.');
  }
  const browserEnabled = Boolean(subscription && Notification.permission === 'granted');
  if (id && result.enabled && !browserEnabled) await apiClient(endpoint + '/' + id, { method: 'DELETE' });
  // A server/configuration mismatch is recoverable. Do not silently unsubscribe a browser
  // installation during a status check; cleanup is explicit on account switch or disable.
  return { ...result, enabled: result.enabled && browserEnabled, serviceWorkerRegistered: Boolean(registration),
    browserSubscription: Boolean(subscription) };
}
export async function enablePush(userId: string) {
  if (!pushSupported()) throw new Error('This browser does not support delivery notifications.');
  const generation = identityGeneration;
  // Called directly from the button, before any network await (Safari requires a user gesture).
  let permission: NotificationPermission;
  try { permission = await Notification.requestPermission(); }
  catch { throw new PushSetupError('permission', 'The browser could not request notification permission. Check this site’s browser settings and try again.'); }
  if (permission !== 'granted') throw new PushSetupError('permission', permission === 'denied'
    ? 'Notifications are blocked. You can allow them in your browser settings.' : 'Permission was not granted. You can try again when ready.');
  const config = await pushStatus(userId);
  await cleanup;
  if (identityGeneration !== generation) throw new Error('Your session or browser subscription changed. Please enable notifications again.');
  if (!config.available || !config.publicKey) throw new PushSetupError('server_configuration', config.availability === 'disabled'
    ? 'Delivery notifications are turned off for this environment. Try again later; order emails remain unaffected.'
    : 'The server notification setup is incomplete. Try again later; order emails remain unaffected.');
  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.register('/delivery-push-sw.js', { scope: '/', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
  } catch {
    throw new PushSetupError('service_worker', 'The notification worker could not be installed. Check browser site settings and retry.');
  }
  const bytes = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    try { subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes }); }
    catch (error) {
      // Never surface opaque DOMException text, which can vary by browser and include provider details.
      const providerUnavailable = error instanceof Error && /registration failed.*push service error/i.test(error.message);
      throw new PushSetupError('push_provider', providerUnavailable
        ? 'Your browser could not reach its push service. Check browser network or site settings, then retry.'
        : 'The browser could not create a push subscription. Check that notifications are allowed, then retry.');
    }
  }
  try {
    if (identityGeneration !== generation) throw new Error('Your session changed. Sign in again to enable notifications.');
    const response = await apiClient<{ data: { id: string } }>(endpoint, { method: 'POST', data: subscription.toJSON() });
    if (identityGeneration !== generation) throw new Error('Your session changed. Sign in again to enable notifications.');
    localStorage.setItem(storageKey, JSON.stringify({ userId, id: response.data.id }));
  } catch (error) {
    try { await subscription.unsubscribe(); } catch { /* Keep the primary persistence error and never report setup success. */ }
    const message = error instanceof ApiError && error.status === 401 ? 'Sign in again before saving this browser subscription.'
      : error instanceof ApiError && error.status === 409 ? 'This browser subscription needs to be reset in site settings before it can be linked to this account.'
        : 'The browser subscription could not be saved to your account. Check your connection and retry.';
    throw new PushSetupError('subscription_persistence', message);
  }
}
export async function disablePush(userId: string) {
  const local = binding();
  if (local?.userId === userId) await apiClient(endpoint + '/' + local.id, { method: 'DELETE' });
  await clearBrowserPush();
}
