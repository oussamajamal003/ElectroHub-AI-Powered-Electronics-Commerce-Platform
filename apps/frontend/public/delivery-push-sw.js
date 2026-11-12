/* ElectroHub delivery push only: no fetch interception, offline cache, or authentication token storage. */
'use strict';
const ids = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function valid(data) { return data && data.v === 1 && ids.test(data.bindingId) && ids.test(data.eventId); }
async function authorize(data, allowLogin = false) {
  if (!valid(data)) return null;
  try {
    const response = await fetch('/api/auth/customer/push/receipt', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bindingId: data.bindingId, eventId: data.eventId }) });
    // A previously displayed notification may outlive a session. Only a logged-out
    // click can retain its already-authorized, same-origin order destination.
    // A different signed-in account receives 404 and must never use this fallback.
    if (response.status === 401 && allowLogin && typeof data.url === 'string') {
      const destination = new URL(data.url, self.location.origin);
      if (destination.origin === self.location.origin && /^\/orders\/ORD-[0-9A-F-]{36}$/.test(destination.pathname) && !destination.search && !destination.hash) return destination.href;
    }
    if (!response.ok) return null;
    const result = await response.json();
    const url = result && result.data && result.data.url;
    return typeof url === 'string' && /^\/orders\/ORD-[0-9A-F-]{36}$/.test(url) ? new URL(url, self.location.origin).href : null;
  } catch { return null; } // No session proof while offline: privacy wins over presentation.
}
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data; try { data = event.data.json(); } catch { return; }
    const url = await authorize(data); if (!url) return;
    await self.registration.showNotification('ElectroHub — Order Out for Delivery', {
      body: 'Your order is out for delivery.', icon: '/brand/electrohub-email-logo.png',
      tag: 'electrohub-delivery-' + data.eventId, renotify: false, data: { ...data, url },
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    // Never trust a stored URL or a different account's now-current session.
    const url = await authorize(event.notification.data, true); if (!url) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin && !new URL(client.url).pathname.startsWith('/admin'));
    if (existing) { await existing.navigate(url); await existing.focus(); } else await self.clients.openWindow(url);
  })());
});
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CLEAR_DELIVERY_NOTIFICATIONS') event.waitUntil((async () => {
    for (const notification of await self.registration.getNotifications()) notification.close();
  })());
});
