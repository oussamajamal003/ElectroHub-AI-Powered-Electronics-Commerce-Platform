import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { StorefrontContactService, contactAdministratorWhere, renderContactNotification } from './storefront-contact.service.js';

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
    await expect(service.sendToAdministrators({ name: 'A', email: 'a@example.test', subject: 'Help', message: 'Hello' })).rejects.toMatchObject({ code: 'CONTACT_UNAVAILABLE' });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
  it('sends only to the configured sender mailbox and escapes the customer content', async () => {
    const sendTransactionalEmail = vi.fn().mockResolvedValue({ success: true });
    const service = new StorefrontContactService({ sendTransactionalEmail });
    await service.send({ name: '<img>', email: 'customer@example.test', subject: 'Help <now>', message: '<script>\nhello' }, 'support@example.test');
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'support@example.test',
      replyTo: { email: 'customer@example.test', name: '<img>' }, htmlContent: expect.stringContaining('&lt;script&gt;<br>') }));
  });

  it('fails safely when delivery is not configured or the provider rejects the message', async () => {
    const empty = new StorefrontContactService({ sendTransactionalEmail: vi.fn() });
    await expect(empty.send({ name: 'A', email: 'a@example.test', subject: 'Hi', message: 'Hello' }, null)).rejects.toMatchObject({ statusCode: 503 });
    const rejected = new StorefrontContactService({ sendTransactionalEmail: vi.fn().mockResolvedValue({ success: false }) });
    await expect(rejected.send({ name: 'A', email: 'a@example.test', subject: 'Hi', message: 'Hello' }, 'support@example.test')).rejects.toMatchObject({ statusCode: 503 });
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
