import { describe, expect, it } from 'vitest';
import { emailValidationError } from './emailValidation';

describe('emailValidationError', () => {
  it.each([
    ['', 'Email address is required.'],
    ['@gmail.com', 'Enter a valid email address before @.'],
    ['user@', 'Enter a valid email domain.'],
    ['usergmail.com', 'Enter a valid email address.'],
    ['a..b@example.com', 'Enter a valid email address.'],
    [' user+tag@example.com ', ''],
  ])('validates %j', (value, expected) => expect(emailValidationError(value)).toBe(expected));
  it('allows an empty optional address', () => expect(emailValidationError('  ', true)).toBe(''));
});
