/**
 * Task 04.1: AI service (FastAPI) connection settings.
 *
 * Deliberately separate from src/config/env.ts: an AI misconfiguration disables AI features only and can never
 * block Express (commerce) startup. This resolver is pure, never throws, and its `issues` carry variable names only,
 * never values.
 */

export const AI_SERVICE_ENVIRONMENTS = ['development', 'qa', 'production', 'test'] as const;
export type AiServiceEnvironment = (typeof AI_SERVICE_ENVIRONMENTS)[number];

export const AI_DEFAULT_TIMEOUT_MS = 2500;
export const AI_MIN_TIMEOUT_MS = 100;
export const AI_MAX_TIMEOUT_MS = 10_000;
/** Task 04.2: route-specific budget for public image search (upload + CPU inference); other operations keep the default. */
export const AI_DEFAULT_IMAGE_SEARCH_TIMEOUT_MS = 8000;
export const AI_MAX_IMAGE_SEARCH_TIMEOUT_MS = 15_000;
/** Express-side response cap (contract: 256 KiB). */
export const AI_MAX_RESPONSE_BYTES = 256 * 1024;
export const AI_MIN_API_KEY_LENGTH = 32;

export type AiServiceIssue =
  | 'AI_SERVICE_URL'
  | 'AI_SERVICE_API_KEY'
  | 'AI_SERVICE_ENVIRONMENT'
  | 'AI_SERVICE_TIMEOUT_MS'
  | 'AI_IMAGE_SEARCH_TIMEOUT_MS';

export interface AiServiceEnabledConfig {
  status: 'enabled';
  baseUrl: URL;
  apiKey: string;
  environment: AiServiceEnvironment;
  timeoutMs: number;
  imageSearchTimeoutMs: number;
  maxResponseBytes: number;
}

export interface AiServiceDisabledConfig {
  status: 'disabled';
  reason: 'NOT_CONFIGURED' | 'MISCONFIGURED';
  issues: AiServiceIssue[];
}

export type AiServiceConfig = AiServiceEnabledConfig | AiServiceDisabledConfig;

const ALLOWED_ENVIRONMENTS_BY_NODE_ENV: Record<string, readonly AiServiceEnvironment[]> = {
  production: ['production'],
  development: ['development', 'qa'],
  test: AI_SERVICE_ENVIRONMENTS,
};

const REJECTED_KEYS = new Set(['changeme', 'change-me', 'placeholder', 'test-secret', 'your-ai-service-api-key-here']);
const PLACEHOLDER_PATTERN = /(your-|change[-_ ]?me|placeholder|replace[-_ ]?(me|with)|example|password|dummy|xxxxxxxx)/i;
const SINGLE_LABEL_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** Single-label internal names (Docker/compose service names) never leave the private network. */
function isInternalHost(hostname: string): boolean {
  return isLoopbackHost(hostname) || (SINGLE_LABEL_HOST.test(hostname) && !/^\d+$/.test(hostname));
}

function parseBaseUrl(raw: string, nodeEnv: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username || url.password) return undefined;
  if (url.search || url.hash || raw.includes('?') || raw.includes('#')) return undefined;
  if (url.pathname !== '/' && url.pathname !== '') return undefined;
  if (nodeEnv === 'production' && url.protocol !== 'https:' && !isInternalHost(url.hostname)) return undefined;
  return url;
}

/** Same spirit as the JWT_SECRET refinement in src/config/env.ts. */
export function isAcceptableAiApiKey(key: string): boolean {
  return (
    key.length >= AI_MIN_API_KEY_LENGTH &&
    key === key.trim() &&
    /^[\x21-\x7e]+$/.test(key) &&
    !REJECTED_KEYS.has(key.toLowerCase()) &&
    !PLACEHOLDER_PATTERN.test(key) &&
    new Set(key).size >= 8
  );
}

function parseTimeout(raw: string | undefined): number | undefined {
  if (!present(raw)) return AI_DEFAULT_TIMEOUT_MS;
  const value = raw.trim();
  if (!/^\d{1,6}$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed >= AI_MIN_TIMEOUT_MS && parsed <= AI_MAX_TIMEOUT_MS ? parsed : undefined;
}

function parseImageSearchTimeout(raw: string | undefined): number | undefined {
  if (!present(raw)) return AI_DEFAULT_IMAGE_SEARCH_TIMEOUT_MS;
  const value = raw.trim();
  if (!/^\d{1,6}$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed >= AI_MIN_TIMEOUT_MS && parsed <= AI_MAX_IMAGE_SEARCH_TIMEOUT_MS ? parsed : undefined;
}

function resolveEnvironment(raw: string | undefined, nodeEnv: string): AiServiceEnvironment | undefined {
  const allowed = ALLOWED_ENVIRONMENTS_BY_NODE_ENV[nodeEnv] ?? ALLOWED_ENVIRONMENTS_BY_NODE_ENV.development;
  if (!present(raw)) {
    // Production must state its binding explicitly; development/test default to their own name.
    if (nodeEnv === 'production') return undefined;
    return nodeEnv === 'test' ? 'test' : 'development';
  }
  const value = raw.trim() as AiServiceEnvironment;
  return allowed.includes(value) ? value : undefined;
}

export function resolveAiServiceConfig(source: NodeJS.ProcessEnv, nodeEnv: string | undefined): AiServiceConfig {
  try {
    const effectiveNodeEnv = nodeEnv && nodeEnv in ALLOWED_ENVIRONMENTS_BY_NODE_ENV ? nodeEnv : 'development';
    const rawUrl = source.AI_SERVICE_URL;
    if (!present(rawUrl)) return { status: 'disabled', reason: 'NOT_CONFIGURED', issues: [] };

    const issues: AiServiceIssue[] = [];
    const baseUrl = parseBaseUrl(rawUrl, effectiveNodeEnv);
    if (!baseUrl) issues.push('AI_SERVICE_URL');

    const apiKey = source.AI_SERVICE_API_KEY;
    if (typeof apiKey !== 'string' || !isAcceptableAiApiKey(apiKey)) issues.push('AI_SERVICE_API_KEY');

    const environment = resolveEnvironment(source.AI_SERVICE_ENVIRONMENT, effectiveNodeEnv);
    if (!environment) issues.push('AI_SERVICE_ENVIRONMENT');

    const timeoutMs = parseTimeout(source.AI_SERVICE_TIMEOUT_MS);
    if (timeoutMs === undefined) issues.push('AI_SERVICE_TIMEOUT_MS');

    const imageSearchTimeoutMs = parseImageSearchTimeout(source.AI_IMAGE_SEARCH_TIMEOUT_MS);
    if (imageSearchTimeoutMs === undefined) issues.push('AI_IMAGE_SEARCH_TIMEOUT_MS');

    if (issues.length > 0 || !baseUrl || !environment || timeoutMs === undefined || imageSearchTimeoutMs === undefined || typeof apiKey !== 'string') {
      return { status: 'disabled', reason: 'MISCONFIGURED', issues };
    }
    return {
      status: 'enabled', baseUrl, apiKey, environment, timeoutMs, imageSearchTimeoutMs, maxResponseBytes: AI_MAX_RESPONSE_BYTES,
    };
  } catch {
    // Defensive: a resolver bug must never block startup.
    return { status: 'disabled', reason: 'MISCONFIGURED', issues: [] };
  }
}
