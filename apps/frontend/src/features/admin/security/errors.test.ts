import { describe, it, expect } from 'vitest';
import { ApiError } from '@/lib/api';
import { describeAdminAuthError } from './errors';

describe('describeAdminAuthError', () => {
  it('asks for a restart when the sign-in challenge has expired', () => {
    const result = describeAdminAuthError(new ApiError(401, 'expired', undefined, 'MFA_CHALLENGE_INVALID'), 'totp');
    expect(result.restart).toBe(true);
    expect(result.message).toBe('Your sign-in attempt expired. Start again.');
  });

  it('explains a rejected recovery code without echoing the submitted value', () => {
    const result = describeAdminAuthError(new ApiError(401, 'bad', undefined, 'MFA_CODE_INVALID'), 'recovery');
    expect(result.restart).toBe(false);
    expect(result.message).toBe('That recovery code is not valid or has already been used.');
  });

  it('locks the sign-in and asks for a restart on rate limiting', () => {
    const result = describeAdminAuthError(new ApiError(429, 'slow down'), 'totp');
    expect(result.restart).toBe(true);
    expect(result.message).toContain('Too many incorrect attempts');
  });

  it('uses generic copy for unknown errors instead of internal details', () => {
    expect(describeAdminAuthError(new Error('db connection string leaked'), 'team').message).toBe('Something went wrong. Please try again.');
  });

  it('reports connectivity separately from server failures', () => {
    expect(describeAdminAuthError(new ApiError(0, 'network'), 'totp').message).toBe('Unable to connect. Check your connection and try again.');
  });
});
