import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { StorefrontContactService, contactAdministratorWhere, renderContactNotification } from './storefront-contact.service.js';
import { logger } from '../utils/logger.js';

const message = { name: 'Ann Customer', email: 'ann.customer@example.test', subject: 'Order question', message: 'Where is my private order 1234?' };
afterEach(() => vi.restoreAllMocks());

describe('StorefrontContactService', () => {
  it('selects only active verified administrators with completed MFA and delivers once with private BCC fanout', async () => {
    const sendTransactionalEmail = vi.fn().mockResolvedValue({ success: true });
    const findMany = vi.fn().mockResolvedValue([{ email: 'first@example.test' }, { email: 'second@example.test' }, { email: 'FIRST@example.test' }]);
    const service = new StorefrontContactService({ sendTransactionalEmail }, { user: { findMany } } as unknown as Pick<PrismaClient, 'user'>);
    await service.sendToAdministrators({ name: 'Customer', email: 'customer@example.test', subject: 'Help', message: 'Hello' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: contactAdministratorWhere }));
    expect(contactAdministratorWhere).toMatchObject({ isActive: true, emailVerifiedAt: { not: null }, role: { name: 'ADMIN' },
      adminSecurity: { is: { mfaEnrolledAt: { not: null } } }, adminSessions: { some: {} } });
    expect(contactAdministratorWhere.OR).toEqual([
      { adminMfaFactors: { some: { verifiedAt: { not: null }, disabledAt: null } } },
      { adminWebAuthnCredentials: { some: { revokedAt: null } } },
    ]);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'first@example.test', bcc: [{ email: 'second@example.test' }] }));
  });
  it('never sends to unapproved fallbacks when no administrator qualifies', async () => {
    const sendTransactionalEmail = vi.fn(); const findMany = vi.fn().mockResolvedValue([]);
    const service = new StorefrontContactService({ sendTransactionalEmail }, { user: { findMany } } as unknown as Pick<PrismaClient, 'user'>);
    await expect(service.sendToAdministrators({ name: 'A', email: 'a@example.test', subject: 'Help', message: 'Hello' })).rejects.toMatchObject({ code: 'CONTACT_NOT_CONFIGURED' });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
  it('delivers to the configured support mailbox and never queries administrators when one is set', async () => {
    const sendTransactionalEmail = vi.fn().mockResolvedValue({ success: true }); const findMany = vi.fn();
    const service = new StorefrontContactService({ sendTransactionalEmail }, { user: { findMany } } as unknown as Pick<PrismaClient, 'user'>);
    await service.deliver(message, 'support@example.test');
    expect(findMany).not.toHaveBeenCalled();
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail.mock.calls[0]![0]).toMatchObject({ to: 'support@example.test' });
    expect(sendTransactionalEmail.mock.calls[0]![0]).not.toHaveProperty('bcc');
  });
  it('falls back to verified administrators only when the support mailbox is empty or invalid, and tells operators', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    for (const supportEmail of [null, '', 'not-an-email']) {
      const sendTransactionalEmail = vi.fn().mockResolvedValue({ success: true });
      const findMany = vi.fn().mockResolvedValue([{ email: 'admin@example.test' }]);
      const service = new StorefrontContactService({ sendTransactionalEmail }, { user: { findMany } } as unknown as Pick<PrismaClient, 'user'>);
      await service.deliver(message, supportEmail);
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenLastCalledWith(expect.any(String), { event: 'contact.fallback_administrators', configured: Boolean(supportEmail) });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('admin@example.test');
      expect(sendTransactionalEmail.mock.calls[0]![0]).toMatchObject({ to: 'admin@example.test' });
    }
  });
  it('sends only to the configured sender mailbox and escapes the customer content', async () => {
    const sendTransactionalEmail = vi.fn().mockResolvedValue({ success: true });
    const service = new StorefrontContactService({ sendTransactionalEmail });
    await service.send({ name: '<img>', email: 'customer@example.test', subject: 'Help <now>', message: '<script>\nhello' }, 'support@example.test');
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'support@example.test',
      replyTo: { email: 'customer@example.test', name: '<img>' }, htmlContent: expect.stringContaining('&lt;script&gt;<br>') }));
  });

  it('refuses to send when no valid support mailbox is configured, with a distinct code and a sanitized log', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const sendTransactionalEmail = vi.fn();
    const service = new StorefrontContactService({ sendTransactionalEmail });
    for (const recipient of [null, '', '   ', 'not-an-email', 'a@b']) {
      await expect(service.send(message, recipient)).rejects.toMatchObject({ statusCode: 503, code: 'CONTACT_NOT_CONFIGURED' });
    }
    expect(sendTransactionalEmail).not.toHaveBeenCalled();                 // nothing is sent to a guessed or hard-coded address
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('contact.recipient_missing');
    expect(logged).not.toMatch(/ann\.customer|Where is my private order|not-an-email/);
  });

  it('reports a provider rejection, an unreachable provider and a thrown error as CONTACT_UNAVAILABLE, never as success', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const outcomes = [
      vi.fn().mockResolvedValue({ success: false }),
      vi.fn().mockResolvedValue({ success: false, error: 'Unauthorized', failure: { category: 'authentication', httpStatus: 401, providerCode: 'unauthorized' } }),
      vi.fn().mockRejectedValue(new Error('socket hang up for support@example.test')),
    ];
    for (const sendTransactionalEmail of outcomes) {
      const service = new StorefrontContactService({ sendTransactionalEmail });
      await expect(service.send(message, 'support@example.test')).rejects.toMatchObject({ statusCode: 503, code: 'CONTACT_UNAVAILABLE' });
      expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    }
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain('contact.provider_rejected');
    expect(logged).toContain('"providerStatus":401');
    expect(logged).not.toMatch(/support@example\.test|ann\.customer|Where is my private order|socket hang up/);
  });

  it('keeps the configured trusted sender (never the customer) and uses the customer only as Reply-To', async () => {
    const sendTransactionalEmail = vi.fn().mockResolvedValue({ success: true, messageId: 'm-1' });
    await new StorefrontContactService({ sendTransactionalEmail }).send(message, '  support@example.test ');
    const sent = sendTransactionalEmail.mock.calls[0][0];
    expect(sent.sender).toBeUndefined();                                   // provider default = BREVO_SENDER_EMAIL / BREVO_SENDER_NAME
    expect(sent.to).toBe('support@example.test');
    expect(sent.replyTo).toEqual({ email: 'ann.customer@example.test', name: 'Ann Customer' });
  });

  it('renders a branded, escaped notification with a plain-text twin and a sanitised subject line', async () => {
    const sendTransactionalEmail = vi.fn().mockResolvedValue({ success: true });
    const service = new StorefrontContactService({ sendTransactionalEmail });
    await service.send({ name: 'Ann\r\nBcc: x@evil.test', email: 'ann@example.test', subject: 'Order <b>help</b>', message: 'Line 1\nLine 2 <a href="https://evil.test">link</a>' }, 'support@example.test', 'Northstar');
    const sent = sendTransactionalEmail.mock.calls[0][0];
    expect(sent.to).toBe('support@example.test');
    expect(sent.subject).toBe('Store contact: Order <b>help</b>');
    expect(sent.subject).not.toMatch(/[\r\n]/);
    expect(sent.replyTo.name).not.toMatch(/[\r\n]/);
    expect(sent.htmlContent).toContain('Northstar');
    expect(sent.htmlContent).toContain('Line 1<br>Line 2 &lt;a href=&quot;https://evil.test&quot;&gt;link&lt;/a&gt;');
    expect(sent.htmlContent).not.toContain('<a href="https://evil.test">');
    expect(sent.textContent).toContain('Line 1\nLine 2');
  });

  it('never renders customer markup unescaped', () => {
    const { html } = renderContactNotification({ name: '<script>x</script>', email: 'a@example.test', subject: '"><img src=x>', message: '<iframe></iframe>' }, 'Shop');
    // A configured brand logo may be a real, trusted <img>; customer-supplied markup must remain text.
    expect(html).toMatch(/data-brand-logo="electrohub(?:-text)?"/);
    expect(html).not.toMatch(/<script>|<img\s+src=x|<iframe/);
  });
});
