/**
 * Interactive-transaction budget for administrator security, team and account flows. Each takes row or advisory locks and then makes
 * several sequential round trips. Against the remote DEV pooler a round trip measured 1–2 s (an MFA sign-in 7.7 s; seven read round
 * trips 13.3 s), past Prisma's 5 s default, so transactions expired midway and the request failed with a 500. Same budget as the
 * longest AuthRepository transaction.
 */
export const ADMIN_AUTH_TX = { maxWait: 10000, timeout: 30000 } as const;
