/* ElectroHub delivery push only: no fetch interception, offline cache, or authentication token storage. */
'use strict';
const ids = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const orderReferences = /^ORD-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function valid(data) { return data && data.v === 1 && ids.test(data.bindingId) && ids.test(data.eventId); }
async function authorize(data, allowLogin = false) {
  if (!valid(data)) return null;
  try {
    const response = await fetch('/api/auth/customer/push/receipt', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bindingId: data.bindingId, eventId: data.eventId }) });
    // A previously displayed notification may outlive a session. Only a logged-out
    // click can retain its already-authorized, same-origin order destination.
    // A different signed-in account receives 404 and must never use this fallback.
    if (response.status === 401 && allowLogin && typeof data.url === 'string' && orderReferences.test(data.orderReference)) {
      const destination = new URL(data.url, self.location.origin);
      if (destination.origin === self.location.origin && destination.pathname === `/orders/${data.orderReference}` && !destination.search && !destination.hash) {
        return { href: destination.href, orderReference: data.orderReference };
      }
    }
    if (!response.ok) return null;
    const result = await response.json();
    const url = result && result.data && result.data.url;
    const orderReference = result && result.data && result.data.orderReference;
    return typeof url === 'string' && orderReferences.test(orderReference) && url === `/orders/${orderReference}` &&
      result.data.type === 'ORDER_OUT_FOR_DELIVERY'
      ? { href: new URL(url, self.location.origin).href, orderReference } : null;
  } catch { return null; } // No session proof while offline: privacy wins over presentation.
}
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data; try { data = event.data.json(); } catch { return; }
    const authorized = await authorize(data); if (!authorized) return;
    await self.registration.showNotification('Your order is out for delivery!', {
      body: `Your ElectroHub order ${authorized.orderReference} has left the dispatch hub and is on its way.`, icon: '/brand/electrohub-email-logo.png',
      tag: 'electrohub-delivery-' + data.eventId, renotify: false, data: { ...data, url: authorized.href, orderReference: authorized.orderReference },
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    // Never trust a stored URL or a different account's now-current session.
    const authorized = await authorize(event.notification.data, true); if (!authorized) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin && !new URL(client.url).pathname.startsWith('/admin'));
    if (existing) { await existing.navigate(authorized.href); await existing.focus(); } else await self.clients.openWindow(authorized.href);
  })());
});
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CLEAR_DELIVERY_NOTIFICATIONS') event.waitUntil((async () => {
    for (const notification of await self.registration.getNotifications()) notification.close();
  })());
});
