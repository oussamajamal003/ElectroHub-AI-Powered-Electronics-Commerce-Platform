// Opt-in protocol proof: disposable Chrome profile, synthetic receipt server, own subscription only.
// This is not account/API integration evidence and does not prove OS toast visibility.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, firefox } from 'playwright';
import { generateVAPIDKeys, sendNotification } from 'web-push';

if (process.env.PUSH_BROWSER_PROOF !== '1') throw new Error('Set PUSH_BROWSER_PROOF=1 to authorize one synthetic push to a disposable local browser.');
const script = await readFile(new URL('../../frontend/public/delivery-push-sw.js', import.meta.url));
const payload = { v: 1, bindingId: randomUUID(), eventId: randomUUID() };
const report = { level: 'PROTOCOL_ONLY_SYNTHETIC_RECEIPT', subscriptionCreated: false, providerAccepted: false,
  tabClosedDuringSend: false, browserNotificationRecord: false, osToastVisible: 'NOT_VERIFIED' };
const server = createServer((req, res) => {
  if (req.url === '/delivery-push-sw.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(script); }
  else if (req.url === '/api/auth/customer/push/receipt' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: { url: '/orders/ORD-33333333-3333-4333-8333-333333333333' } }));
  } else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>ElectroHub disposable push proof</title><p>Synthetic notification protocol test.</p>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = process.env.PUSH_BROWSER_ENGINE === 'firefox'
    ? await firefox.launch({ headless: false })
    : await chromium.launch({ channel: 'chrome', headless: false });
  const context = await browser.newContext(); await context.grantPermissions(['notifications'], { origin });
  const page = await context.newPage(); await page.goto(origin);
  const vapid = generateVAPIDKeys();
  const subscription = await Promise.race([
    page.evaluate(async key => {
      await navigator.serviceWorker.register('/delivery-push-sw.js'); const registration = await navigator.serviceWorker.ready;
      const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      return (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes })).toJSON();
    }, vapid.publicKey),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SUBSCRIPTION_TIMEOUT')), 45000).unref()),
  ]);
  report.subscriptionCreated = true;
  await context.newPage(); await page.close(); report.tabClosedDuringSend = true;
  const response = await sendNotification(subscription, JSON.stringify(payload), { TTL: 60, timeout: 10000,
    vapidDetails: { ...vapid, subject: 'mailto:qa@example.invalid' } });
  report.providerAccepted = response.statusCode >= 200 && response.statusCode < 300;
  await new Promise(resolve => setTimeout(resolve, 8000));
  const inspect = await context.newPage(); await inspect.goto(origin);
  report.browserNotificationRecord = await inspect.evaluate(async eventId => {
    const registration = await navigator.serviceWorker.ready;
    const records = await registration.getNotifications({ tag: 'electrohub-delivery-' + eventId });
    for (const record of records) record.close();
    await (await registration.pushManager.getSubscription())?.unsubscribe();
    return records.length > 0;
  }, payload.eventId);
} catch (error) {
  report.failure = error?.message === 'SUBSCRIPTION_TIMEOUT' ? 'SUBSCRIPTION_TIMEOUT' : 'BROWSER_OR_PROVIDER_UNAVAILABLE';
  if (!report.subscriptionCreated) report.prerequisiteDiagnostic = String(error?.message ?? 'unknown').replace(/https?:\/\/\S+/g, '[URL]').slice(0, 500);
  process.exitCode = 1;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  console.log(JSON.stringify(report, null, 2));
}
