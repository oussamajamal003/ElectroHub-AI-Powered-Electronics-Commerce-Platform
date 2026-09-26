import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getToken: vi.fn(), verifyIdToken: vi.fn() }));
vi.mock('google-auth-library', () => ({ OAuth2Client: class { getToken = mocks.getToken; verifyIdToken = mocks.verifyIdToken; } }));
import { googleProvider } from '../src/providers/google.provider.js';
import { env } from '../src/config/env.js';

describe('Google provider validation', () => {
  it('verifies the signed identity using the configured audience and checks nonce', async () => {
    env.GOOGLE_CLIENT_ID = 'google-test-audience';
    mocks.getToken.mockResolvedValue({ tokens: { id_token: 'test-id-token' } });
    mocks.verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: 'subject', email: 'Google@Example.com', email_verified: true, nonce: 'nonce' }) });
    expect(await googleProvider.verifyCode('code', 'verifier', 'nonce')).toMatchObject({ sub: 'subject', email: 'google@example.com' });
    expect(mocks.verifyIdToken).toHaveBeenCalledWith({ idToken: 'test-id-token', audience: 'google-test-audience' });
    await expect(googleProvider.verifyCode('code', 'verifier', 'wrong')).rejects.toMatchObject({ code: 'GOOGLE_AUTH_FAILED' });
  });
  it('rejects malformed or unverified identities and invalid signatures without raw errors', async () => {
    mocks.verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'a@example.com', email_verified: false }) });
    await expect(googleProvider.verifyCode('code', 'verifier', 'nonce')).rejects.toMatchObject({ statusCode: 400 });
    mocks.verifyIdToken.mockRejectedValue(new Error('signature details'));
    await expect(googleProvider.verifyCode('code', 'verifier', 'nonce')).rejects.toThrow('Google sign-in could not be completed. Please try again.');
  });
});
