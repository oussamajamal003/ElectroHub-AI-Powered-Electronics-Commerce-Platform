import { createECDH, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateRequestDetails, generateVAPIDKeys } from 'web-push';
import { pushConfig, subscriptionSchema } from '../customer-push.config.js';
import { pushDispatchAllowed } from '../customer-push.dispatcher.js';

describe('push configuration and real transport encoding (no network sends)', () => {
  it('requires explicit enablement and target approval outside disposable databases', () => {
    const keys = generateVAPIDKeys();
    const source = { NODE_ENV: 'test', CUSTOMER_PUSH_ENABLED: 'true', COMMERCE_EMAIL_ORIGIN: 'http://localhost:5173',
      WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
      WEB_PUSH_VAPID_SUBJECT: 'mailto:qa@example.invalid' };
    expect(pushConfig(source).enabled).toBe(true);
    expect(pushConfig({ ...source, CUSTOMER_PUSH_ENABLED: 'false' }).enabled).toBe(false);
    expect(pushConfig({ ...source, WEB_PUSH_VAPID_PRIVATE_KEY: '' }).enabled).toBe(false);
    expect(pushDispatchAllowed({ kind: 'disposable', identity: 'test' }, source)).toBe(true);
    expect(pushDispatchAllowed({ kind: 'dev', identity: 'shared' }, source)).toBe(false);
    expect(pushDispatchAllowed({ kind: 'dev', identity: 'shared' }, { ...source, CUSTOMER_PUSH_APPROVED_TARGET: 'shared' })).toBe(true);
    expect(pushDispatchAllowed({ kind: 'dev', identity: 'shared' }, { ...source, CUSTOMER_PUSH_APPROVED_TARGET: 'shared', npm_lifecycle_event: 'dev' })).toBe(false);
  });

  it('restricts provider destinations and uses actual VAPID signing and payload encryption', () => {
    const client = createECDH('prime256v1'); client.generateKeys();
    const subscription = { endpoint: 'https://fcm.googleapis.com/wp/synthetic-endpoint',
      keys: { p256dh: client.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
    expect(subscriptionSchema.safeParse(subscription).success).toBe(true);
    for (const endpoint of ['http://fcm.googleapis.com/wp/x', 'https://localhost/wp/x', 'https://fcm.googleapis.com.evil.invalid/wp/x', 'https://user:pass@fcm.googleapis.com/wp/x', 'https://fcm.googleapis.com:8443/wp/x']) {
      expect(subscriptionSchema.safeParse({ ...subscription, endpoint }).success).toBe(false);
    }
    const plaintext = JSON.stringify({ v: 1, bindingId: 'synthetic-binding', eventId: 'synthetic-event' });
    const request = generateRequestDetails(subscription, plaintext, { vapidDetails: { ...generateVAPIDKeys(), subject: 'mailto:qa@example.invalid' }, TTL: 300 });
    expect(request.method).toBe('POST');
    expect(request.headers.Authorization).toMatch(/^vapid /);
    expect(request.headers['Content-Encoding']).toBe('aes128gcm');
    expect(Buffer.isBuffer(request.body)).toBe(true);
    expect(request.body?.toString()).not.toContain('synthetic-event');
  });
});
