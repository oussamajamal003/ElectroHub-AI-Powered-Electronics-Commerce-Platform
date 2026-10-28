import { z } from 'zod';

/**
 * Task 03.8 commerce email settings. Parsed from the process environment on demand (no import-time side effects), validated,
 * and safe by default: nothing is enqueued, dispatched or sent until each switch is deliberately enabled.
 */
const flag = z.enum(['true', 'false']).default('false').transform(value => value === 'true');
const bounded = (fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(fallback);
const schema = z.object({
  COMMERCE_EMAIL_ENQUEUE_ENABLED: flag,
  COMMERCE_EMAIL_DISPATCH_ENABLED: flag,
  COMMERCE_EMAIL_SEND_MODE: z.enum(['disabled', 'capture', 'allowlist', 'live']).default('disabled'),
  COMMERCE_EMAIL_ALLOWED_RECIPIENTS: z.string().default('').transform(value => value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(z.string().email().max(255)).max(20)),
  COMMERCE_EMAIL_ORIGIN: z.string().optional(),
  FRONTEND_URL: z.string().optional(),
  COMMERCE_EMAIL_CAPTURE_DIR: z.string().optional(),
  COMMERCE_EMAIL_IMAGE_HOSTS: z.string().default('').transform(value => value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(z.string().regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'hostname')).max(10)),
  CLOUDINARY_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_PROJECT_REF: z.string().optional(),
  COMMERCE_EMAIL_BATCH_SIZE: bounded(10, 1, 50),
  COMMERCE_EMAIL_CONCURRENCY: bounded(2, 1, 5),
  COMMERCE_EMAIL_POLL_MS: bounded(5_000, 1_000, 60_000),
  COMMERCE_EMAIL_PROVIDER_TIMEOUT_MS: bounded(10_000, 1_000, 30_000),
  COMMERCE_EMAIL_LEASE_MS: bounded(60_000, 15_000, 600_000),
  NODE_ENV: z.string().default('development'),
});

/** Where product images in customer emails may come from. Derived only from real configuration; never guessed from fixtures. */
export interface ImageSources { hosts: string[]; cloudinaryCloud: string | null; allowLoopbackHttp: boolean }

/** Cloudinary's shared delivery host is trusted only for the explicitly configured cloud. */
export const CLOUDINARY_DELIVERY_HOST = 'res.cloudinary.com';

export interface CommerceEmailConfig {
  enqueueEnabled: boolean; dispatchEnabled: boolean; sendMode: 'disabled' | 'capture' | 'allowlist' | 'live';
  allowedRecipients: string[]; origin: string | null; captureDir: string | null; imageSources: ImageSources;
  batchSize: number; concurrency: number; pollMs: number; providerTimeoutMs: number; leaseMs: number;
}

/** Loopback hosts allowed over plain http outside production. IPv6 loopback is deliberately unsupported (same policy as emails/commerce/escape.ts). */
export const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1'];

/** HTTPS everywhere; plain http only for an explicit loopback origin outside production. Path, query and credentials are refused. */
export function trustedOrigin(value: string | undefined, nodeEnv: string): string | null {
  if (!value) return null;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return null; }
  const loopback = LOOPBACK_HOSTS.includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) return null;
  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback && nodeEnv !== 'production')) return parsed.origin;
  return null;
}

function imageSources(explicit: string[], cloudinaryUrl: string | undefined, origin: string | null, nodeEnv: string,
  storageUrl?: string, storageProject?: string): ImageSources {
  // Keep only the cloud identifier. Never put the API key or secret into the returned policy or logs.
  const cloudinaryCloud = /^cloudinary:\/\/[^:@/\s]+:[^@/\s]+@([a-z0-9][a-z0-9_-]{0,62})$/i.exec(cloudinaryUrl?.trim() ?? '')?.[1]?.toLowerCase() ?? null;
  const hosts = new Set(explicit);
  if (cloudinaryCloud) hosts.add(CLOUDINARY_DELIVERY_HOST);
  if (origin) hosts.add(new URL(origin).hostname);
  const storageOrigin = trustedOrigin(storageUrl, nodeEnv);
  const expectedProject = nodeEnv === 'production' ? 'yepfgjehdstlxbpespun' : 'pzxekjybdiulzmssalfo';
  if (storageOrigin && storageProject === expectedProject && storageOrigin === `https://${expectedProject}.supabase.co`) {
    hosts.add(`${expectedProject}.supabase.co`);
  }
  return { hosts: [...hosts], cloudinaryCloud, allowLoopbackHttp: nodeEnv !== 'production' };
}

/** Accept only Cloudinary image delivery paths for the configured cloud, never video/raw or another cloud. */
function isConfiguredCloudinaryImagePath(pathname: string, cloud: string): boolean {
  const segments = pathname.split('/');
  if (segments[0] !== '' || segments[1] !== cloud || segments[2] !== 'image' || segments[3] !== 'upload' || segments.length < 5) return false;
  try {
    return segments.slice(4).every(segment => {
      if (!segment) return false;
      const decoded = decodeURIComponent(segment);
      return decoded !== '.' && decoded !== '..' && !decoded.includes('/') && !decoded.includes('\\');
    });
  } catch {
    return false;
  }
}

/**
 * The only image URLs a customer email may reference: absolute, credential-free, on an approved host, HTTPS (plain http only for a
 * loopback host outside production). Anything else is dropped to null:
 * the image is optional and the email still renders in full without it.
 */
export function safeEmailImageUrl(value: string | null | undefined, sources: ImageSources): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || /[\s"'<>`\\]/.test(value)) return null;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  const loopback = LOOPBACK_HOSTS.includes(host);
  if (parsed.protocol === 'http:' ? !(loopback && sources.allowLoopbackHttp) : parsed.protocol !== 'https:') return null;
  if (!sources.hosts.includes(host)) return null;
  if (parsed.port && !loopback) return null;
  if (host === CLOUDINARY_DELIVERY_HOST && (!sources.cloudinaryCloud || !isConfiguredCloudinaryImagePath(parsed.pathname, sources.cloudinaryCloud))) return null;
  return parsed.href;
}

export function commerceEmailConfig(source: NodeJS.ProcessEnv = process.env): CommerceEmailConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) throw new Error(`Invalid commerce email configuration (${Object.keys(parsed.error.flatten().fieldErrors).join(', ')})`);
  const value = parsed.data;
  const config: CommerceEmailConfig = {
    enqueueEnabled: value.COMMERCE_EMAIL_ENQUEUE_ENABLED, dispatchEnabled: value.COMMERCE_EMAIL_DISPATCH_ENABLED,
    sendMode: value.COMMERCE_EMAIL_SEND_MODE, allowedRecipients: value.COMMERCE_EMAIL_ALLOWED_RECIPIENTS,
    origin: trustedOrigin(value.COMMERCE_EMAIL_ORIGIN ?? value.FRONTEND_URL, value.NODE_ENV),
    captureDir: value.COMMERCE_EMAIL_CAPTURE_DIR ?? null,
    imageSources: imageSources(value.COMMERCE_EMAIL_IMAGE_HOSTS, value.CLOUDINARY_URL,
      trustedOrigin(value.COMMERCE_EMAIL_ORIGIN ?? value.FRONTEND_URL, value.NODE_ENV), value.NODE_ENV,
      value.SUPABASE_URL, value.SUPABASE_PROJECT_REF),
    batchSize: value.COMMERCE_EMAIL_BATCH_SIZE, concurrency: value.COMMERCE_EMAIL_CONCURRENCY, pollMs: value.COMMERCE_EMAIL_POLL_MS,
    providerTimeoutMs: value.COMMERCE_EMAIL_PROVIDER_TIMEOUT_MS, leaseMs: value.COMMERCE_EMAIL_LEASE_MS,
  };
  // The lease must outlive one provider call plus its acknowledgement, or a slow send could be reclaimed mid-flight.
  if (config.leaseMs < config.providerTimeoutMs * 2 + 10_000) throw new Error('Invalid commerce email configuration (COMMERCE_EMAIL_LEASE_MS)');
  return config;
}

export interface DispatchPermission { allowed: boolean; reason: string; identity: string }
/**
 * Whether this process may run the commerce email worker against its database (decided from configuration only, before any query).
 * capture: disposable/test databases only. allowlist: only listed recipients are ever claimed. live: a non-disposable target needs
 * COMMERCE_EMAIL_LIVE_APPROVED_TARGET equal to the resolved credential-free identity, so a copied env file cannot mail real customers.
 */
export function dispatchPermission(config: CommerceEmailConfig, target: { kind: string; identity: string }, environment: NodeJS.ProcessEnv = process.env): DispatchPermission {
  const deny = (reason: string) => ({ allowed: false, reason, identity: target.identity });
  if (!config.dispatchEnabled) return deny('dispatch-disabled');
  if (config.sendMode === 'disabled') return deny('send-mode-disabled');
  if (!config.origin) return deny('trusted-origin-missing');
  if (environment.npm_lifecycle_event === 'dev') return deny('watched-dev-server');
  if (config.sendMode === 'capture') {
    return target.kind === 'disposable' || environment.NODE_ENV === 'test'
      ? config.captureDir ? { allowed: true, reason: 'capture-disposable', identity: target.identity } : deny('capture-dir-missing')
      : deny('capture-requires-disposable-target');
  }
  if (config.sendMode === 'allowlist') {
    return config.allowedRecipients.length ? { allowed: true, reason: 'allowlist', identity: target.identity } : deny('allowlist-empty');
  }
  if (target.kind === 'disposable') return { allowed: true, reason: 'live-disposable', identity: target.identity };
  const approved = environment.COMMERCE_EMAIL_LIVE_APPROVED_TARGET?.trim();
  return approved && approved === target.identity ? { allowed: true, reason: 'live-approved-target', identity: target.identity } : deny('live-target-not-approved');
}
