import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { teamFailure } from './teamFailure';

const fail = (code: string) => new ApiError(409, 'x', undefined, code);

describe('administrator invitation conflicts', () => {
  it('describes an existing account without claiming it is an administrator', () => {
    const message = teamFailure(fail('ACCOUNT_EXISTS')) ?? '';
    expect(message).toMatch(/An ElectroHub account already uses this email address/);
    expect(message).toMatch(/use a different email address/);
    expect(message).toMatch(/Existing customer accounts cannot be converted/);
    expect(message).not.toMatch(/administrator account already/i);
  });

  it('keeps a pending invitation distinct and points to resend', () => {
    const message = teamFailure(fail('INVITATION_EXISTS')) ?? '';
    expect(message).toMatch(/pending invitation/);
    expect(message).toMatch(/Resend/);
    expect(message).not.toBe(teamFailure(fail('ACCOUNT_EXISTS')));
  });
});
