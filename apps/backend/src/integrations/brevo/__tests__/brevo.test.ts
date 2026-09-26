import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { BrevoClient } from '../brevo.client.js';
import { BrevoProvider } from '../brevo.provider.js';

describe('Brevo Integration', () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    process.env.VITEST_NO_MOCK_BREVO = 'true';
  });

  afterAll(() => {
    delete process.env.VITEST_NO_MOCK_BREVO;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('BrevoClient', () => {
    it('should throw if Brevo API key is not configured', async () => {
      const client = new BrevoClient({ apiKey: '' });
      await expect(
        client.sendSmtpEmail({
          to: [{ email: 'test@example.com' }],
          subject: 'Test',
        })
      ).rejects.toThrow(/api key is not configured/i);
    });

    it('should send POST request with correct headers and return messageId on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ messageId: 'msg-abc-123' }),
      });
      global.fetch = mockFetch;

      const client = new BrevoClient({
        apiKey: 'secret-key-123',
        baseUrl: 'https://api.brevo.com/v3',
      });

      const res = await client.sendSmtpEmail({
        sender: { email: 'noreply@electrohub.com', name: 'ElectroHub' },
        to: [{ email: 'recipient@example.com' }],
        subject: 'Welcome',
        htmlContent: '<p>Hello</p>',
      });

      expect(res.messageId).toBe('msg-abc-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.brevo.com/v3/smtp/email',
        expect.objectContaining({
          method: 'POST',
          headers: {
            accept: 'application/json',
            'api-key': 'secret-key-123',
            'content-type': 'application/json',
          },
        })
      );
    });

    it('should not expose provider error messages that contain the api key', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection failed with key secret-key-123'));
      global.fetch = mockFetch;

      const client = new BrevoClient({
        apiKey: 'secret-key-123',
      });

      const result = await client.sendSmtpEmail({
          to: [{ email: 'user@example.com' }],
          subject: 'Test',
        }).then(() => null, (caught: unknown) => caught);

      expect(result).toBeInstanceOf(Error);
      if (!(result instanceof Error)) throw new Error('Expected Brevo request to reject');
      expect(result.message).toBe('Brevo network request failed');
      expect(result.message).not.toContain('secret-key-123');
    });

    it('should retain the HTTP status and safe provider code without exposing provider messages', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ code: 'invalid_parameter', message: 'Invalid email address' }),
      });
      global.fetch = mockFetch;

      const client = new BrevoClient({
        apiKey: 'valid-key',
      });

      await expect(
        client.sendSmtpEmail({
          to: [{ email: 'bad' }],
          subject: 'Test',
        })
      ).rejects.toThrow('Brevo request rejected (HTTP 400, invalid_parameter)');
    });
  });

  describe('BrevoProvider', () => {
    it('should format payload and return success: true with messageId', async () => {
      const mockClient = {
        sendSmtpEmail: vi.fn().mockResolvedValue({ messageId: 'msg-456' }),
      } as unknown as BrevoClient;

      const provider = new BrevoProvider(mockClient, {
        email: 'sender@electrohub.com',
        name: 'ElectroHub Test',
      });

      const result = await provider.sendTransactionalEmail({
        to: 'buyer@example.com',
        subject: 'Order Confirm',
        htmlContent: '<h1>Confirmed</h1>',
      });

      expect(result).toEqual({
        success: true,
        messageId: 'msg-456',
      });

      expect(mockClient.sendSmtpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          sender: { email: 'sender@electrohub.com', name: 'ElectroHub Test' },
          to: [{ email: 'buyer@example.com' }],
          subject: 'Order Confirm',
        })
      );
    });

    it('should catch errors and return success: false with safe error message', async () => {
      const mockClient = {
        sendSmtpEmail: vi.fn().mockRejectedValue(new Error('Brevo service unavailable')),
      } as unknown as BrevoClient;

      const provider = new BrevoProvider(mockClient);

      const result = await provider.sendTransactionalEmail({
        to: 'buyer@example.com',
        subject: 'Order Confirm',
      });

      expect(result).toEqual({
        success: false,
        error: 'Brevo delivery failed',
      });
    });
  });
});
