/**
 * Task 06.2 — customer OTP eligibility (Work Package E).
 *
 * An OTP may reach only an existing, active account that is eligible for the specific flow, and every public response is
 * the same for registered and unregistered addresses. The repository, OTP store and email provider are replaced with
 * in-memory doubles so every "was a challenge created / was a mail sent" assertion is exact; no real email is ever sent.
 */
process.env.OTP_HASH_SECRET = 'unit-test-secret';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  findUserByPendingEmail: vi.fn(),
  findUserById: vi.fn(),
  createCustomerUser: vi.fn(),
  createSessionRefreshToken: vi.fn(),
  getAccountAuthMethods: vi.fn(),
}));
const otp = vi.hoisted(() => ({
  createChallenge: vi.fn(),
  getChallengeIdByUserAndDestination: vi.fn(),
  getChallengeIdByEmail: vi.fn(),
  getLatestChallengeIdByUserAndDestination: vi.fn(),
  verifyEmailOtpWithOutcome: vi.fn(),
  resendChallenge: vi.fn(),
}));
const mail = vi.hoisted(() => ({
  sendAccountVerificationOtp: vi.fn(),
  sendPasswordResetOtp: vi.fn(),
}));
const mfa = vi.hoisted(() => ({ startLogin: vi.fn() }));

vi.mock('../../repositories/auth.repository.js', () => ({
  AuthRepository: class { constructor() { return repo; } },
  StalePasswordHashError: class StalePasswordHashError extends Error {},
}));
vi.mock('../otp.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../otp.service.js')>();
  return { ...actual, otpService: otp };
});
vi.mock('../email.service.js', () => ({ emailService: mail }));
vi.mock('../admin-mfa.service.js', () => ({ adminMfaService: mfa }));
vi.mock('../../sockets/delivery.publisher.js', () => ({ DeliveryPublisher: { disconnectUser: vi.fn() } }));
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

import { AuthService, GENERIC_OTP_ACKNOWLEDGEMENT } from '../auth.service.js';
import { OtpDeliveryError, OtpVerificationError } from '../otp.service.js';
import { hashPassword } from '../../utils/hash.js';

const PASSWORD = 'Correct-Horse-9';
let passwordHash = '';

type Fixture = { id: string; email: string; pendingEmail: string | null; isActive: boolean; emailVerifiedAt: Date | null; passwordHash: string; role: { name: 'CUSTOMER' | 'ADMIN' } };
const account = (overrides: Partial<Fixture> = {}): Fixture => ({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'customer@example.test',
  pendingEmail: null,
  isActive: true,
  emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
  passwordHash,
  role: { name: 'CUSTOMER' },
  ...overrides,
});

const noOtpSideEffects = () => {
  expect(otp.createChallenge).not.toHaveBeenCalled();
  expect(otp.resendChallenge).not.toHaveBeenCalled();
  expect(mail.sendAccountVerificationOtp).not.toHaveBeenCalled();
  expect(mail.sendPasswordResetOtp).not.toHaveBeenCalled();
};

describe('customer OTP eligibility', () => {
  let service: AuthService;

  beforeEach(async () => {
    vi.clearAllMocks();
    if (!passwordHash) passwordHash = await hashPassword(PASSWORD);
    repo.findUserByEmail.mockResolvedValue(null);
    repo.findUserByPendingEmail.mockResolvedValue(null);
    repo.createSessionRefreshToken.mockResolvedValue({ familyId: 'family-1' });
    repo.getAccountAuthMethods.mockResolvedValue({ password: true, google: false });
    otp.createChallenge.mockResolvedValue('123456');
    otp.resendChallenge.mockResolvedValue({ success: true, expiresAt: new Date(), resendAvailableAt: new Date() });
    mail.sendAccountVerificationOtp.mockResolvedValue(true);
    mail.sendPasswordResetOtp.mockResolvedValue(true);
    service = new AuthService();
  });

  describe('login (password-first; a code is only ever a verification step for the account that proved its password)', () => {
    it('1/7. an existing, verified, eligible customer signs in with no OTP at all', async () => {
      repo.findUserByEmail.mockResolvedValue(account());
      const result = await service.login('Customer@Example.test ', PASSWORD);
      expect(result).toHaveProperty('accessToken');
      expect(repo.findUserByEmail).toHaveBeenCalledWith('customer@example.test');
      noOtpSideEffects();
    });

    it('2/8. an unknown email gets the generic credential error, no challenge and no mail', async () => {
      await expect(service.login('nobody@example.test', PASSWORD)).rejects.toThrow('Invalid credentials');
      noOtpSideEffects();
      expect(repo.createSessionRefreshToken).not.toHaveBeenCalled();
    });

    it('5. a disabled/suspended customer gets the same generic error, no challenge and no mail', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ isActive: false, emailVerifiedAt: null }));
      await expect(service.login('customer@example.test', PASSWORD)).rejects.toThrow('Invalid credentials');
      noOtpSideEffects();
    });

    it('6. a wrong password for an unverified customer never creates or sends a verification code', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ emailVerifiedAt: null }));
      await expect(service.login('customer@example.test', 'wrong-password')).rejects.toThrow('Invalid credentials');
      noOtpSideEffects();
    });

    it('4/7. an unverified customer with the correct password receives a verification code for its own address only', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ emailVerifiedAt: null }));
      otp.getChallengeIdByUserAndDestination.mockResolvedValue(null);
      const result = await service.login('customer@example.test', PASSWORD);
      expect(result).toMatchObject({ requiresVerification: true, email: 'customer@example.test' });
      expect(otp.createChallenge).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'customer@example.test', 'EMAIL_VERIFICATION');
      expect(mail.sendAccountVerificationOtp).toHaveBeenCalledWith('customer@example.test', '123456', '11111111-1111-4111-8111-111111111111');
      expect(repo.createSessionRefreshToken).not.toHaveBeenCalled();
    });

    it('16. concurrent logins of an unverified customer reuse the live challenge instead of minting a second code', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ emailVerifiedAt: null }));
      otp.getChallengeIdByUserAndDestination.mockResolvedValue('live-challenge');
      const results = await Promise.all([service.login('customer@example.test', PASSWORD), service.login('customer@example.test', PASSWORD)]);
      for (const result of results) expect(result).toMatchObject({ requiresVerification: true, deliveryFailed: false });
      noOtpSideEffects();
    });

    it('18. an ADMIN password still opens only the restricted MFA transaction (admin MFA unaffected)', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ role: { name: 'ADMIN' } }));
      mfa.startLogin.mockResolvedValue({ requiresMfa: true });
      await expect(service.login('customer@example.test', PASSWORD)).resolves.toEqual({ requiresMfa: true });
      expect(repo.createSessionRefreshToken).not.toHaveBeenCalled();
      noOtpSideEffects();
    });

    it('10. timing: an unknown address spends a full bcrypt comparison like a wrong password for a real account', async () => {
      repo.findUserByEmail.mockResolvedValue(account());
      const known = performance.now();
      await expect(service.login('customer@example.test', 'wrong-password')).rejects.toThrow('Invalid credentials');
      const knownMs = performance.now() - known;
      repo.findUserByEmail.mockResolvedValue(null);
      const unknown = performance.now();
      await expect(service.login('nobody@example.test', 'wrong-password')).rejects.toThrow('Invalid credentials');
      const unknownMs = performance.now() - unknown;
      // Before the fix the unknown branch returned in well under a millisecond while bcrypt(12) takes ~100-300 ms.
      expect(unknownMs).toBeGreaterThan(knownMs * 0.5);
    });
  });

  describe('resend registration verification (public, non-enumerating)', () => {
    const generic = expect.objectContaining({ message: GENERIC_OTP_ACKNOWLEDGEMENT, success: true });

    it('2/9. unknown address: generic body, no lookup of challenges, nothing sent', async () => {
      await expect(service.resendVerification('nobody@example.test')).resolves.toEqual(generic);
      expect(otp.getChallengeIdByUserAndDestination).not.toHaveBeenCalled();
      noOtpSideEffects();
    });

    it('verified customer: generic body and nothing sent', async () => {
      repo.findUserByEmail.mockResolvedValue(account());
      await expect(service.resendVerification('customer@example.test')).resolves.toEqual(generic);
      noOtpSideEffects();
    });

    it('5. suspended (inactive) unverified customer: generic body and nothing sent (regression: was re-sent)', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ isActive: false, emailVerifiedAt: null }));
      otp.getChallengeIdByUserAndDestination.mockResolvedValue('live-challenge');
      await expect(service.resendVerification('customer@example.test')).resolves.toEqual(generic);
      noOtpSideEffects();
    });

    it('administrator address: generic body and nothing sent', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ role: { name: 'ADMIN' }, emailVerifiedAt: null }));
      otp.getChallengeIdByUserAndDestination.mockResolvedValue('live-challenge');
      await expect(service.resendVerification('customer@example.test')).resolves.toEqual(generic);
      noOtpSideEffects();
    });

    it('a superseded primary address after a verification-email correction is not a delivery target', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ emailVerifiedAt: null, pendingEmail: 'corrected@example.test' }));
      otp.getChallengeIdByUserAndDestination.mockResolvedValue('stale-challenge');
      await expect(service.resendVerification('customer@example.test')).resolves.toEqual(generic);
      noOtpSideEffects();
    });

    it('eligible unverified customer with no live challenge: generic body, no challenge is created', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ emailVerifiedAt: null }));
      otp.getChallengeIdByUserAndDestination.mockResolvedValue(null);
      await expect(service.resendVerification('customer@example.test')).resolves.toEqual(generic);
      noOtpSideEffects();
    });

    it('15/17. eligible unverified customer with a live challenge: the existing challenge is re-sent (registration flow intact)', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ emailVerifiedAt: null }));
      otp.getChallengeIdByUserAndDestination.mockResolvedValue('live-challenge');
      const result = await service.resendVerification('customer@example.test');
      expect(otp.resendChallenge).toHaveBeenCalledWith('live-challenge');
      expect(result).toMatchObject({ success: true, message: GENERIC_OTP_ACKNOWLEDGEMENT });
      expect(otp.createChallenge).not.toHaveBeenCalled();
    });

    it('pending (corrected) address of an unverified customer is the eligible destination', async () => {
      repo.findUserByPendingEmail.mockResolvedValue(account({ emailVerifiedAt: null, pendingEmail: 'corrected@example.test' }));
      otp.getChallengeIdByUserAndDestination.mockResolvedValue('live-challenge');
      await service.resendVerification('corrected@example.test');
      expect(otp.getChallengeIdByUserAndDestination).toHaveBeenCalledWith(expect.any(String), 'corrected@example.test', 'EMAIL_VERIFICATION');
      expect(otp.resendChallenge).toHaveBeenCalledWith('live-challenge');
    });

    it('9. cooldown and consumed/locked challenges are indistinguishable from "nothing to resend"', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ emailVerifiedAt: null }));
      otp.getChallengeIdByUserAndDestination.mockResolvedValue('live-challenge');
      for (const message of ['Please wait 42s before requesting a new code.', 'Challenge has already been consumed', 'Challenge is locked due to too many failed attempts']) {
        otp.resendChallenge.mockRejectedValueOnce(new Error(message));
        await expect(service.resendVerification('customer@example.test')).resolves.toEqual(generic);
      }
    });

    it('a provider failure for an eligible account keeps the existing 503 delivery contract', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ emailVerifiedAt: null }));
      otp.getChallengeIdByUserAndDestination.mockResolvedValue('live-challenge');
      otp.resendChallenge.mockRejectedValueOnce(new OtpDeliveryError());
      await expect(service.resendVerification('customer@example.test')).rejects.toBeInstanceOf(OtpDeliveryError);
    });

    it('9. the public body is byte-identical in shape for a registered and an unregistered address', async () => {
      const unknown = await service.resendVerification('nobody@example.test');
      repo.findUserByEmail.mockResolvedValue(account());
      const verified = await service.resendVerification('customer@example.test');
      expect(Object.keys(unknown).sort()).toEqual(Object.keys(verified).sort());
      expect(unknown.message).toBe(verified.message);
    });
  });

  describe('password-reset codes', () => {
    it('8. forgot-password for an unknown address creates no challenge and sends nothing', async () => {
      await expect(service.forgotPassword('nobody@example.test')).resolves.toBeUndefined();
      noOtpSideEffects();
    });

    it('5. forgot-password for a suspended customer creates no challenge and sends nothing', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ isActive: false }));
      await service.forgotPassword('customer@example.test');
      noOtpSideEffects();
    });

    it('7. forgot-password for an eligible customer creates exactly one challenge bound to the stored address', async () => {
      repo.findUserByEmail.mockResolvedValue(account());
      await service.forgotPassword('CUSTOMER@example.test');
      expect(otp.createChallenge).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'customer@example.test', 'PASSWORD_RESET');
      expect(mail.sendPasswordResetOtp).toHaveBeenCalledTimes(1);
    });

    it('the customer resend endpoint never re-delivers an administrator recovery code', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ role: { name: 'ADMIN' } }));
      otp.getChallengeIdByEmail.mockResolvedValue('admin-recovery');
      const result = await service.resendPasswordReset('customer@example.test');
      expect(result.message).toMatch(/If an account exists/);
      noOtpSideEffects();
    });

    it('18. the administrator recovery resend still re-delivers its own live challenge', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ role: { name: 'ADMIN' } }));
      otp.getChallengeIdByEmail.mockResolvedValue('admin-recovery');
      await service.resendPasswordReset('customer@example.test', 'ADMIN');
      expect(otp.resendChallenge).toHaveBeenCalledWith('admin-recovery');
    });

    it('the administrator recovery resend never re-delivers a customer code', async () => {
      repo.findUserByEmail.mockResolvedValue(account());
      otp.getChallengeIdByEmail.mockResolvedValue('customer-reset');
      await service.resendPasswordReset('customer@example.test', 'ADMIN');
      noOtpSideEffects();
    });

    it('resend for an unknown address returns the generic body and sends nothing', async () => {
      const result = await service.resendPasswordReset('nobody@example.test');
      expect(result.message).toMatch(/If an account exists/);
      expect(otp.getChallengeIdByEmail).not.toHaveBeenCalled();
      noOtpSideEffects();
    });
  });

  describe('verification never issues a session without a consumed code', () => {
    it('12/13/14. wrong, reused or exhausted codes surface their failure and issue no session', async () => {
      repo.findUserByEmail.mockResolvedValue(account({ emailVerifiedAt: null }));
      otp.getLatestChallengeIdByUserAndDestination.mockResolvedValue('challenge');
      for (const outcome of ['OTP_INCORRECT', 'OTP_CONSUMED', 'OTP_ATTEMPTS_EXHAUSTED', 'OTP_EXPIRED'] as const) {
        otp.verifyEmailOtpWithOutcome.mockResolvedValueOnce(outcome);
        await expect(service.verifyRegistrationOtp('customer@example.test', '000000')).rejects.toMatchObject({ code: outcome });
      }
      expect(repo.createSessionRefreshToken).not.toHaveBeenCalled();
    });

    it('an unknown address cannot verify anything (no challenge lookup, no session)', async () => {
      await expect(service.verifyRegistrationOtp('nobody@example.test', '123456')).rejects.toBeInstanceOf(OtpVerificationError);
      expect(otp.getLatestChallengeIdByUserAndDestination).not.toHaveBeenCalled();
      expect(repo.createSessionRefreshToken).not.toHaveBeenCalled();
    });
  });
});
