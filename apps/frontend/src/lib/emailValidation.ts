import { z } from 'zod';

const emailSchema = z.string().email();

/** Return an accessible field error, or an empty string when the address is valid. */
export function emailValidationError(input: string, optional = false): string {
  const value = input.trim();
  if (!value) return optional ? '' : 'Email address is required.';
  if (value.startsWith('@')) return 'Enter a valid email address before @.';
  if (value.endsWith('@')) return 'Enter a valid email domain.';
  return emailSchema.safeParse(value).success ? '' : 'Enter a valid email address.';
}
