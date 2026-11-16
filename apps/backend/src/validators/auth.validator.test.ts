import { describe, expect, it } from 'vitest';
import { forgotPasswordSchema, updateProfileSchema, changeVerificationEmailSchema } from './auth.validator.js';

describe('customer email validation', () => {
  it.each(['', '@gmail.com', 'user@', 'usergmail.com', 'a..b@example.com', 'user@-example.com'])('rejects %j', email => {
    expect(forgotPasswordSchema.safeParse({ email }).success).toBe(false);
  });

  it.each(['user@example.com', 'user+tag@example.com'])('accepts and trims %s', email => {
    expect(forgotPasswordSchema.parse({ email: `  ${email}  ` }).email).toBe(email);
  });

  it('keeps profile email optional while validating both verification addresses', () => {
    expect(updateProfileSchema.safeParse({ firstName: 'Test' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ email: '@example.com' }).success).toBe(false);
    expect(changeVerificationEmailSchema.safeParse({ currentEmail: 'user@example.com', newEmail: '@example.com', password: 'secret' }).success).toBe(false);
  });
});
