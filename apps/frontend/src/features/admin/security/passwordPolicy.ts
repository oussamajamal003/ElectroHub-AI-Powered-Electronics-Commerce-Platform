/** Must match the server's administrator password policy (admin-security.controller.ts). */
export const MIN_ADMIN_PASSWORD_LENGTH = 8;
export const STRONG_PASSWORD = 'Strong password.';

/** Plain-language strength guidance. The server enforces the real policy; this only helps the administrator choose. */
export function passwordHint(password: string): string {
  if (!password) return `Use ${MIN_ADMIN_PASSWORD_LENGTH} to 128 characters, including uppercase, lowercase and a number.`;
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) return `${MIN_ADMIN_PASSWORD_LENGTH - password.length} more characters needed.`;
  if (password.length > 128) return 'Use no more than 128 characters.';
  const missing = [[/[a-z]/, 'a lowercase letter'], [/[A-Z]/, 'an uppercase letter'], [/\d/, 'a number']] as const;
  const needed = missing.filter(([pattern]) => !pattern.test(password)).map(([, label]) => label);
  return needed.length ? `Add ${needed.join(' and ')}.` : STRONG_PASSWORD;
}
