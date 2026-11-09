import { describe, expect, it, vi } from 'vitest';
import { StorefrontContactService } from './storefront-contact.service.js';

describe('StorefrontContactService', () => {
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
});
