/**
 * ElectroHub email branding: the one header every application-generated HTML email shares, so the logo can never drift between
 * templates. The artwork is the same mark and wordmark as the browser favicon and the storefront/admin header (`BrandLogo`); the
 * email-safe PNG lives in the frontend's `public/brand/` and is served from the configured public origin.
 *
 * Email-client rules this follows: table layout, inline styles only, a raster PNG (Gmail and Outlook do not render SVG, CSS backgrounds
 * or data: URIs), absolute HTTPS URL, explicit width/height, meaningful alt text styled so it still reads when images are blocked.
 * No signed or private URLs, no secrets, and no hard-coded production host: the origin always comes from configuration.
 */
import { escapeHtml } from './commerce/escape.js';

export const BRAND_NAME = 'ElectroHub';
export const EMAIL_LOGO_PATH = '/brand/electrohub-email-logo.png';
/** The PNG is 295x80 (2x for retina); it is displayed at 148x40. */
export const EMAIL_LOGO_WIDTH = 148;
export const EMAIL_LOGO_HEIGHT = 40;
export const BRAND_BLUE = '#2563EB';
const BRAND_INK = '#0F172A';
const FONT = `Poppins, 'Segoe UI', Arial, Helvetica, sans-serif`;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Accepts only an http(s) URL without credentials; plain http is allowed for loopback development capture only. */
function safeUrl(value: string | undefined | null): URL | null {
  const text = value?.trim();
  if (!text) return null;
  let parsed: URL;
  try { parsed = new URL(text); } catch { return null; }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (parsed.protocol === 'https:') return parsed;
  if (parsed.protocol === 'http:' && LOOPBACK.has(parsed.hostname)) return parsed;
  return null;
}

/**
 * Absolute URL of the email logo, or `null` when no trustworthy public origin is configured (the header then renders the text
 * wordmark instead of a broken image). Precedence: an explicit `EMAIL_LOGO_URL`, then the caller's trusted origin, then
 * `COMMERCE_EMAIL_ORIGIN`, then `FRONTEND_URL`.
 */
export function resolveEmailLogoUrl(origin?: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = safeUrl(env.EMAIL_LOGO_URL);
  if (explicit) return explicit.href;
  const base = safeUrl(origin) ?? safeUrl(env.COMMERCE_EMAIL_ORIGIN) ?? safeUrl(env.FRONTEND_URL);
  return base ? new URL(EMAIL_LOGO_PATH, base.origin).href : null;
}

export interface EmailHeaderOptions {
  /** Trusted public origin for this email (commerce emails pass their configured origin). */
  origin?: string | null;
  /** Configured store name; shown under the logo only when it differs from ElectroHub, so a renamed store keeps its identity. */
  storeName?: string | null;
  /** Spacing below the header. Defaults to 24px, matching the card layouts. */
  marginBottom?: number;
}

const wordmark = `<span style="font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;color:${BRAND_BLUE};letter-spacing:-1px;">Electro<span style="color:${BRAND_INK};font-weight:600;">Hub</span></span>`;

/** The shared header block: centered logo (or the text wordmark fallback) and, for a renamed store, its name. */
export function renderEmailHeader(options: EmailHeaderOptions = {}): string {
  const logo = resolveEmailLogoUrl(options.origin);
  const siteOrigin = safeUrl(options.origin) ?? safeUrl(process.env.COMMERCE_EMAIL_ORIGIN) ?? safeUrl(process.env.FRONTEND_URL);
  const image = logo
    ? `<img data-brand-logo="electrohub" src="${escapeHtml(logo)}" width="${EMAIL_LOGO_WIDTH}" height="${EMAIL_LOGO_HEIGHT}" alt="${BRAND_NAME}" `
      + `style="display:block;border:0;outline:none;text-decoration:none;width:${EMAIL_LOGO_WIDTH}px;height:${EMAIL_LOGO_HEIGHT}px;margin:0 auto;`
      + `font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;color:${BRAND_BLUE};">`
    : `<span data-brand-logo="electrohub-text" role="img" aria-label="${BRAND_NAME}">${wordmark}</span>`;
  const linked = siteOrigin ? `<a href="${escapeHtml(siteOrigin.origin)}" style="text-decoration:none;" target="_blank">${image}</a>` : image;
  const name = options.storeName?.trim();
  const storeLine = name && name !== BRAND_NAME
    ? `<tr><td align="center" style="padding:8px 0 0 0;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${BRAND_INK};">${escapeHtml(name)}</td></tr>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" data-brand-header="electrohub" style="width:100%;margin:0 0 ${options.marginBottom ?? 24}px 0;">`
    + `<tr><td align="center" style="padding:0;line-height:0;font-size:0;">${linked}</td></tr>${storeLine}</table>`;
}
