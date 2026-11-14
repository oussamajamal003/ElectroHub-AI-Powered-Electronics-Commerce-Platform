import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generateVAPIDKeys } from 'web-push';
import express, { type Express } from 'express';
import request from 'supertest';
import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { deliveryFixtures } from './helpers/delivery-fixtures.js';

const enabled = process.env.DELIVERY_PG_RUN === '1' && process.env.NOTIFICATION_BROWSER_RUN === '1';
const realPush = process.env.NOTIFICATION_REAL_PUSH_RUN === '1';
// This backend project has Node libraries only. The evaluated callback runs in a
// real browser; describe the small standard browser API surface used by the test.
type PushNavigator = { serviceWorker: { ready: Promise<{
  getNotifications(options?: { tag: string }): Promise<{ close(): void }[]>;
  pushManager: { getSubscription(): Promise<{ unsubscribe(): Promise<boolean> } | null> };
}> } };

/** Actual built React UI, Express API, PostgreSQL, Socket.IO and dispatcher; no intercepted APIs. */
describe.skipIf(!enabled)('notification real-browser journey on a disposable backend', () => {
  it('admin transition preserves tracking and durable history after bell removal, with controlled email capture', async () => {
    const target = new URL(process.env.DATABASE_URL!);
    expect(['localhost', '127.0.0.1']).toContain(target.hostname);
    expect(target.pathname).toMatch(/^\/electrohub_disposable_/);
    const outer = express();
    const http = createServer(outer);
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    process.env.FRONTEND_URL = origin;
    if (realPush) {
      const vapid = generateVAPIDKeys();
      Object.assign(process.env, { CUSTOMER_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_PUBLIC_KEY: vapid.publicKey,
        WEB_PUSH_VAPID_PRIVATE_KEY: vapid.privateKey, WEB_PUSH_VAPID_SUBJECT: 'mailto:qa@example.invalid', COMMERCE_EMAIL_ORIGIN: origin });
    }
    // Match the existing NodeNext/CommonJS dynamic-import boundary used by the socket integration suite.
    const app = (await import('../../app.js') as unknown as { default: Express }).default;
    const { prisma } = await import('../../lib/prisma.js');
    const { hashPassword } = await import('../../utils/hash.js');
    const { generateAccessToken } = await import('../../utils/jwt.js');
    const { attachDeliveryGateway } = await import('../../sockets/delivery.gateway.js');
    const { DeliveryPublisher } = await import('../../sockets/delivery.publisher.js');
    const { CommerceEmailDispatcher } = await import('../commerce-email.dispatcher.js');
    const { renderCommerceEmail } = await import('../../emails/commerce/templates.js');
    outer.use((req, res, next) => req.path.startsWith('/api/') ? app(req, res, next) : next());
    const dist = path.resolve('../frontend/dist');
    outer.use(express.static(dist)); outer.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    const gateway = attachDeliveryGateway(http, { corsOrigin: origin });
    DeliveryPublisher.attach(gateway);
    const fixtures = deliveryFixtures('notification-browser');
    const profileRoot = path.resolve(tmpdir());
    const profile = realPush ? mkdtempSync(path.join(profileRoot, 'electrohub-push-journey-')) : null;
    const browser = realPush ? null : await chromium.launch({ channel: process.env.NOTIFICATION_QA_CHROME_CHANNEL === 'chrome' ? 'chrome' : undefined });
    const context = profile ? await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false,
      viewport: { width: 1440, height: 900 }, ignoreDefaultArgs: ['--disable-background-networking'] })
      : await browser!.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const owner = await fixtures.user('CUSTOMER', 'owner');
      const admin = await fixtures.user('ADMIN', 'admin');
      const password = 'Synthetic-browser-password-123!';
      await prisma.user.update({ where: { id: owner.id }, data: { passwordHash: await hashPassword(password), emailVerifiedAt: new Date() } });
      const order = await fixtures.order(owner.id, 'PREPARING', 'SUCCEEDED');
      const token = generateAccessToken({ userId: admin.id, role: 'ADMIN', sessionId: admin.sessionId });
      const page = await context.newPage();
      const login = await page.request.post(`${origin}/api/auth/login`, { data: { email: owner.email, password } });
      expect(login.status()).toBe(200);
      const identity = (await login.json()).user;
      await page.addInitScript(user => sessionStorage.setItem('electrohub:cached-user', JSON.stringify(user)), identity);
      if (realPush) {
        await context.grantPermissions(['notifications'], { origin });
        await page.goto(`${origin}/account`);
        await page.getByRole('button', { name: 'Enable delivery notifications' }).click();
        try { await page.getByText('Notifications are on for this browser.', { exact: true }).waitFor({ timeout: 60000 }); }
        catch (error) {
          const diagnostic = await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Delivery Notifications' }) }).innerText();
          throw new Error(`Real push subscription prerequisite failed: ${diagnostic}`, { cause: error });
        }
        expect(await prisma.customerPushSubscription.count({ where: { userId: owner.id, revokedAt: null } })).toBe(1);
      }
      const frames: string[] = [];
      page.on('websocket', socket => socket.on('framereceived', event => frames.push(String(event.payload))));
      await page.goto(`${origin}/orders/${order.reference}`);
      expect(await page.getByRole('button', { name: /^Notifications/ }).count()).toBe(0);
      await expect.poll(() => gateway.namespace.sockets.size, { timeout: 10000 }).toBeGreaterThan(0);
      const endpoint = `/api/admin/orders/${order.reference}/delivery`;
      expect((await request(http).post(endpoint).set('Authorization', `Bearer ${token}`).send({})).status).toBe(201);
      expect((await request(http).patch(endpoint).set('Authorization', `Bearer ${token}`).send({ expectedRevision: 1, status: 'OUT_FOR_DELIVERY' })).status).toBe(200);
      await expect.poll(() => frames.some(frame => frame.includes('notification:created'))).toBe(true);
      expect(await prisma.customerNotification.count({ where: { userId: owner.id } })).toBe(1);
      await page.goto(`${origin}/orders/${order.reference}/tracking`);
      await page.getByText('Out for delivery', { exact: true }).first().waitFor();
      const output = path.resolve('../../.cache/notification-browser-evidence'); mkdirSync(output, { recursive: true });
      await page.screenshot({ path: path.join(output, 'real-tracking.png'), fullPage: true });
      const sent: { subject: string; to: string }[] = [];
      const worker = new CommerceEmailDispatcher(prisma, { name: 'CAPTURE', send: async message => {
        sent.push(message); return { success: true, messageId: `capture-${randomUUID()}` };
      } }, renderCommerceEmail, { sendMode: 'allowlist', allowedRecipients: [owner.email], origin, batchSize: 10, concurrency: 1, leaseMs: 60000 });
      for (const claim of await worker.claim()) { await worker.process(claim); await worker.process(claim); }
      expect(sent.filter(message => message.subject === 'Your ElectroHub Order Is Out for Delivery!')).toEqual([
        expect.objectContaining({ to: owner.email }),
      ]);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('OUT_FOR_DELIVERY');
      const emailEvidence = await prisma.commerceEmailOutbox.findMany({ where: { orderId: order.id, type: 'ORDER_OUT_FOR_DELIVERY' },
        select: { id: true, type: true, dispatchState: true, attemptCount: true, providerMessageId: true } });
      writeFileSync(path.join(output, 'out-for-delivery-email-capture.json'), JSON.stringify({ recipientClassification: 'DISPOSABLE_SYNTHETIC_CUSTOMER',
        transport: 'CAPTURE', inboxReceipt: 'NOT_VERIFIED', orderRoute: `/orders/${order.reference}`, events: emailEvidence }, null, 2));
      if (realPush) {
        await context.newPage(); await page.close();
        const { CustomerPushDispatcher, realPushTransport } = await import('../customer-push.dispatcher.js');
        await new CustomerPushDispatcher(prisma, realPushTransport()).runBatch();
        const delivery = await prisma.customerPushDelivery.findFirstOrThrow({ where: { notification: { userId: owner.id } } });
        expect(delivery.state).toBe('ACCEPTED');
        // Keep all storefront tabs closed while the browser receives the push.
        await new Promise(resolve => setTimeout(resolve, 8000));
        const inspect = await context.newPage(); await inspect.goto(origin);
        await expect.poll(() => inspect.evaluate(async id => {
          const registration = await (navigator as unknown as PushNavigator).serviceWorker.ready;
          return (await registration.getNotifications({ tag: 'electrohub-delivery-' + id })).length;
        }, delivery.notificationId), { timeout: 15000 }).toBe(1);
        writeFileSync(path.join(output, 'real-push-result.json'), JSON.stringify({ browser: 'headed persistent Chrome on Windows',
          subscriptionRegisteredThroughCustomerUI: true, ownerAssociationVerified: true, authoritativeTransition: 'OUT_FOR_DELIVERY',
          eventId: delivery.notificationId, deliveryId: delivery.id, dispatchState: delivery.state, providerCode: delivery.lastCode,
          tabClosedDuringSend: true, actualReceiptApiAuthorized: true, browserNotificationRecord: true, osToastVisible: 'NOT_VERIFIED' }, null, 2));
        await inspect.evaluate(async () => {
          const registration = await (navigator as unknown as PushNavigator).serviceWorker.ready;
          for (const item of await registration.getNotifications()) item.close();
          await (await registration.pushManager.getSubscription())?.unsubscribe();
        });
        console.log('REAL_PUSH_CUSTOMER_JOURNEY: owned subscription persisted; authoritative transition; provider accepted; storefront tab closed; actual receipt API authorized; browser notification record present. OS toast visibility NOT VERIFIED.');
      }
    } finally {
      await context.close(); await browser?.close(); DeliveryPublisher.attach(null); await gateway.close();
      await fixtures.cleanup(); await prisma.$disconnect();
      if (profile && path.dirname(path.resolve(profile)) === profileRoot && path.basename(profile).startsWith('electrohub-push-journey-')) rmSync(profile, { recursive: true, force: true });
    }
  }, realPush ? 180000 : 90000);
});
