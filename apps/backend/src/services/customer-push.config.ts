import { z } from 'zod';
import { trustedOrigin } from './commerce-email.config.js';

export const subscriptionSchema = z.object({
  endpoint: z.string().max(2048).url().refine(value => {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash &&
      ((u.hostname === 'fcm.googleapis.com' && /^\/(wp|fcm\/send)\//.test(u.pathname)) ||
       (/^(updates|updates-autopush)\.push\.services\.mozilla\.com$/.test(u.hostname) && u.pathname.startsWith('/wpush/')) ||
       (u.hostname === 'web.push.apple.com' && u.pathname.startsWith('/')));
  }, 'Unsupported push service'),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/).refine(v => Buffer.from(v, 'base64url').length === 65 && Buffer.from(v, 'base64url')[0] === 4),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/).refine(v => Buffer.from(v, 'base64url').length === 16) }).strict(),
  expirationTime: z.number().nullable().optional(),
}).strict();
export function pushConfig(source: NodeJS.ProcessEnv = process.env) {
  const enabled = source.CUSTOMER_PUSH_ENABLED === 'true';
  const publicKey = source.WEB_PUSH_VAPID_PUBLIC_KEY ?? '';
  const privateKey = source.WEB_PUSH_VAPID_PRIVATE_KEY ?? '';
  const subject = source.WEB_PUSH_VAPID_SUBJECT ?? '';
  const origin = trustedOrigin(source.COMMERCE_EMAIL_ORIGIN ?? source.FRONTEND_URL, source.NODE_ENV ?? 'development');
  const valid = Boolean(origin && /^[A-Za-z0-9_-]{87}$/.test(publicKey) && /^[A-Za-z0-9_-]{43}$/.test(privateKey) &&
    (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject) || /^https:\/\//.test(subject)));
  return { enabled: enabled && valid, configured: valid, publicKey, privateKey, subject, origin };
}
