import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import express, { type Express } from 'express';
import request from 'supertest';
import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { deliveryFixtures } from './helpers/delivery-fixtures.js';

const enabled = process.env.DELIVERY_PG_RUN === '1' && process.env.NOTIFICATION_BROWSER_RUN === '1';

/** Actual built React UI, Express API, PostgreSQL, Socket.IO and dispatcher; no intercepted APIs. */
describe.skipIf(!enabled)('notification real-browser journey on a disposable backend', () => {
  it('admin transition reaches the customer bell, tracking, persisted read state and controlled email capture', async () => {
    const target = new URL(process.env.DATABASE_URL!);
    expect(['localhost', '127.0.0.1']).toContain(target.hostname);
    expect(target.pathname).toMatch(/^\/electrohub_disposable_/);
    const outer = express();
    const http = createServer(outer);
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    process.env.FRONTEND_URL = origin;
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
    const browser = await chromium.launch({ channel: process.env.NOTIFICATION_QA_CHROME_CHANNEL === 'chrome' ? 'chrome' : undefined });
    try {
      const owner = await fixtures.user('CUSTOMER', 'owner');
      const admin = await fixtures.user('ADMIN', 'admin');
      const password = 'Synthetic-browser-password-123!';
      await prisma.user.update({ where: { id: owner.id }, data: { passwordHash: await hashPassword(password), emailVerifiedAt: new Date() } });
      const order = await fixtures.order(owner.id, 'PREPARING', 'SUCCEEDED');
      const token = generateAccessToken({ userId: admin.id, role: 'ADMIN', sessionId: admin.sessionId });
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const login = await page.request.post(`${origin}/api/auth/login`, { data: { email: owner.email, password } });
      expect(login.status()).toBe(200);
      const identity = (await login.json()).user;
      await page.addInitScript(user => sessionStorage.setItem('electrohub:cached-user', JSON.stringify(user)), identity);
      const frames: string[] = [];
      page.on('websocket', socket => socket.on('framereceived', event => frames.push(String(event.payload))));
      await page.goto(`${origin}/orders/${order.reference}`);
      await page.getByRole('button', { name: 'Notifications, 0 unread' }).waitFor();
      await expect.poll(() => gateway.namespace.sockets.size, { timeout: 10000 }).toBeGreaterThan(0);
      const endpoint = `/api/admin/orders/${order.reference}/delivery`;
      expect((await request(http).post(endpoint).set('Authorization', `Bearer ${token}`).send({})).status).toBe(201);
      expect((await request(http).patch(endpoint).set('Authorization', `Bearer ${token}`).send({ expectedRevision: 1, status: 'OUT_FOR_DELIVERY' })).status).toBe(200);
      await page.getByRole('button', { name: 'Notifications, 1 unread' }).waitFor({ timeout: 10000 });
      expect(frames.some(frame => frame.includes('notification:created'))).toBe(true);
      await page.getByRole('button', { name: 'Notifications, 1 unread' }).click();
      const row = page.getByRole('menuitem', { name: /Your order/ });
      expect(await row.getAttribute('href')).toBe(`/orders/${order.reference}/tracking`);
      await page.getByRole('menuitem', { name: 'Mark as read' }).click();
      await expect.poll(() => prisma.customerNotification.count({ where: { userId: owner.id, readAt: null } })).toBe(0);
      await page.keyboard.press('Escape');
      await page.reload(); await page.getByRole('button', { name: 'Notifications, 0 unread' }).waitFor();
      await page.getByRole('button', { name: 'Notifications, 0 unread' }).click();
      await page.getByRole('menuitem', { name: /Your order/ }).click();
      await page.waitForURL(`**/orders/${order.reference}/tracking`);
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
    } finally {
      await browser.close(); DeliveryPublisher.attach(null); await gateway.close();
      await fixtures.cleanup(); await prisma.$disconnect();
    }
  }, 90000);
});
