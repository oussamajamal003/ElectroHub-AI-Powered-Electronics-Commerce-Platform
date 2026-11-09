import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { teamFailure } from './teamFailure';

const fail = (code: string) => new ApiError(409, 'x', undefined, code);

describe('administrator invitation conflicts', () => {
  it('describes an existing account without claiming it is an administrator', () => {
    const message = teamFailure(fail('ACCOUNT_EXISTS')) ?? '';
    expect(message).toMatch(/already associated with an ElectroHub account/);
    expect(message).not.toMatch(/customer/i);
    expect(message).not.toMatch(/administrator account already/i);
  });

  it('keeps a pending invitation distinct and points to resend', () => {
    const message = teamFailure(fail('INVITATION_EXISTS')) ?? '';
    expect(message).toMatch(/invitation is already pending/);
    expect(message).toMatch(/Resend/);
    expect(message).not.toBe(teamFailure(fail('ACCOUNT_EXISTS')));
  });

  it('directs an existing administrator to management controls', () => {
    const message = teamFailure(fail('ADMIN_ALREADY_EXISTS')) ?? '';
    expect(message).toMatch(/administrator already exists/i);
    expect(message).toMatch(/Manage Administrators/);
  });
});
