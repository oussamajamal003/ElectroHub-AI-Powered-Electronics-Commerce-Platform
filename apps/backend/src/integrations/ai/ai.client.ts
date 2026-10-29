import { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { parseRetryAfter } from '../brevo/brevo.client.js';
import { recordAiRequest } from './ai.telemetry.js';
import { AiServiceConfig, AiServiceEnabledConfig, resolveAiServiceConfig } from './ai.config.js';
import {
  AI_ERROR_CODE_PATTERN,
  AI_IMAGE_SEARCH_CONTENT_TYPES,
  AI_MAX_TOP_K,
  AiCapabilities,
  AiImageSearchContentType,
  AiImageSearchResult,
  AiReadiness,
  AiRecommendationRequestInput,
  AiRecommendationResult,
  aiCapabilitiesSchema,
  aiErrorEnvelopeSchema,
  aiImageSearchResultSchema,
  aiReadySchema,
  aiRecommendationRequestSchema,
  aiRecommendationResultSchema,
} from './ai.schemas.js';

export type AiServiceErrorCategory =
  | 'not_configured'
  | 'unauthorized'
  | 'environment_mismatch'
  | 'rejected'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'aborted'
  | 'connect'
  | 'network'
  | 'invalid_response'
  | 'response_too_large';

export interface AiRequestOptions {
  requestId?: string;
  signal?: AbortSignal;
}

export interface ImageSearchInput extends AiRequestOptions {
  /** Bytes already validated by the Express upload layer (magic bytes); never logged or stored. */
  image: Buffer;
  contentType: AiImageSearchContentType;
  topK: number;
}

const IMAGE_SEARCH_EXTENSIONS: Record<AiImageSearchContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

type RequestBody = { kind: 'json'; value: unknown } | { kind: 'multipart'; form: FormData };

interface RequestOverrides {
  /** Telemetry operation name; defaults to the HTTP method and path. */
  operation?: string;
  /** Route-specific timeout; defaults to the general AI_SERVICE_TIMEOUT_MS. */
  timeoutMs?: number;
}

const SAFE_MESSAGES: Record<AiServiceErrorCategory, string> = {
  not_configured: 'AI service is not configured',
  unauthorized: 'AI service rejected the service credential',
  environment_mismatch: 'AI service environment does not match',
  rejected: 'AI service rejected the request',
  rate_limited: 'AI service rate limited the request',
  unavailable: 'AI service is unavailable',
  timeout: 'AI service request timed out',
  aborted: 'AI service request was aborted',
  connect: 'AI service connection failed',
  network: 'AI service network request failed',
  invalid_response: 'AI service returned an invalid response',
  response_too_large: 'AI service response exceeded the size limit',
};

/** Never carries the URL, the key or any response body text. */
export class AiServiceError extends Error {
  readonly statusCode?: number;
  readonly code?: string;
  readonly retryAfterMs?: number;

  constructor(
    readonly category: AiServiceErrorCategory,
    details: { statusCode?: number; code?: string; retryAfterMs?: number } = {}
  ) {
    const code = details.code && AI_ERROR_CODE_PATTERN.test(details.code) ? details.code : undefined;
    const status = details.statusCode ? ` (HTTP ${details.statusCode}${code ? `, ${code}` : ''})` : '';
    super(`${SAFE_MESSAGES[category]}${status}`);
    this.name = 'AiServiceError';
    this.statusCode = details.statusCode;
    this.code = code;
    this.retryAfterMs = details.retryAfterMs;
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const CONNECT_FAILURES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);

function connectFailure(err: unknown) {
  const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  const code = cause && typeof cause === 'object' && 'code' in cause ? (cause as { code?: unknown }).code : undefined;
  return typeof code === 'string' && CONNECT_FAILURES.has(code);
}

function isJsonContentType(value: string | null) {
  return (value ?? '').split(';')[0].trim().toLowerCase() === 'application/json';
}

function discard(response: Response) {
  response.body?.cancel().catch(() => undefined);
}

type FetchImpl = typeof fetch;

export class AiServiceClient {
  private readonly fetchImpl: FetchImpl;

  constructor(private readonly config: AiServiceEnabledConfig, fetchImpl?: FetchImpl) {
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  get environment() {
    return this.config.environment;
  }

  /** GET /internal/v1/ready */
  async getReadiness(opts: AiRequestOptions = {}): Promise<AiReadiness> {
    return (await this.request('GET', '/internal/v1/ready', aiReadySchema, opts)).data;
  }

  /** GET /internal/v1/capabilities */
  async getCapabilities(opts: AiRequestOptions = {}): Promise<AiCapabilities> {
    return (await this.request('GET', '/internal/v1/capabilities', aiCapabilitiesSchema, opts)).data;
  }

  /**
   * POST /internal/v1/recommendations (Task 04.4: D3 embedding recommender; 503 while it or its index is not ready).
   * The response must echo the mode and never contain the anchor, an excluded product or a profile product.
   */
  async recommend(input: AiRecommendationRequestInput, opts: AiRequestOptions = {}): Promise<AiRecommendationResult> {
    const parsed = aiRecommendationRequestSchema.safeParse(input);
    if (!parsed.success) throw new AiServiceError('rejected', { code: 'AI_VALIDATION_FAILED' });
    const request = parsed.data;
    const result = (await this.request('POST', '/internal/v1/recommendations', aiRecommendationResultSchema(request.limit), opts,
      { kind: 'json', value: request }, { timeoutMs: this.config.recommendationTimeoutMs })).data;
    if (result.mode !== request.mode) throw new AiServiceError('invalid_response');
    const forbidden = new Set([request.productId, ...request.excludeProductIds,
      ...(request.context?.profileSignals ?? []).map(signal => signal.productId)]
      .filter((id): id is string => id !== null).map(id => id.toLowerCase()));
    if (result.items.some(item => forbidden.has(item.productId.toLowerCase()))) throw new AiServiceError('invalid_response');
    return result;
  }

  /**
   * POST /internal/v1/image-search as one bounded multipart `image` part. Only the sniffed bytes and a generic filename
   * leave Express: no browser cookies, JWT, client filename or client Content-Type are forwarded.
   */
  async imageSearch(input: ImageSearchInput): Promise<AiImageSearchResult> {
    if (!Number.isInteger(input.topK) || input.topK < 1 || input.topK > AI_MAX_TOP_K) {
      throw new AiServiceError('rejected', { code: 'AI_VALIDATION_FAILED' });
    }
    if (!(AI_IMAGE_SEARCH_CONTENT_TYPES as readonly string[]).includes(input.contentType) || input.image.byteLength === 0) {
      throw new AiServiceError('rejected', { code: 'AI_VALIDATION_FAILED' });
    }
    const form = new FormData();
    form.append(
      'image',
      new Blob([new Uint8Array(input.image)], { type: input.contentType }),
      `query.${IMAGE_SEARCH_EXTENSIONS[input.contentType]}`
    );
    const result = await this.request(
      'POST',
      `/internal/v1/image-search?topK=${input.topK}`,
      aiImageSearchResultSchema(input.topK),
      { requestId: input.requestId, signal: input.signal },
      { kind: 'multipart', form },
      { operation: 'imageSearch', timeoutMs: this.config.imageSearchTimeoutMs }
    );
    return result.data;
  }

  private async request<S extends z.ZodTypeAny>(
    method: 'GET' | 'POST',
    path: string,
    schema: S,
    opts: AiRequestOptions,
    body?: RequestBody,
    overrides: RequestOverrides = {}
  ): Promise<z.output<S>> {
    const startedAt = Date.now();
    const base = {
      operation: overrides.operation ?? `ai.${method.toLowerCase()} ${path}`,
      environment: this.config.environment,
      requestId: opts.requestId,
    };
    try {
      const result = await this.send(method, path, schema, opts, body, overrides.timeoutMs ?? this.config.timeoutMs);
      recordAiRequest({ ...base, outcome: 'success', statusCode: 200, durationMs: Date.now() - startedAt });
      return result;
    } catch (err: unknown) {
      const error = err instanceof AiServiceError ? err : new AiServiceError('network');
      recordAiRequest({
        ...base,
        outcome: 'failure',
        category: error.category,
        statusCode: error.statusCode,
        code: error.code,
        durationMs: Date.now() - startedAt,
      });
      throw err;
    }
  }

  private async send<S extends z.ZodTypeAny>(
    method: 'GET' | 'POST',
    path: string,
    schema: S,
    opts: AiRequestOptions,
    body: RequestBody | undefined,
    timeoutMs: number
  ): Promise<z.output<S>> {
    if (opts.signal?.aborted) throw new AiServiceError('aborted');

    const timeout = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; timeout.abort(); }, timeoutMs);
    const signal = opts.signal ? AbortSignal.any([timeout.signal, opts.signal]) : timeout.signal;

    const headers: Record<string, string> = {
      'accept': 'application/json',
      'accept-encoding': 'identity',
      'x-electrohub-ai-key': this.config.apiKey,
      'x-electrohub-ai-environment': this.config.environment,
    };
    if (opts.requestId && REQUEST_ID_PATTERN.test(opts.requestId)) headers['x-request-id'] = opts.requestId;
    // multipart: fetch derives the Content-Type (with boundary) from the FormData itself.
    if (body?.kind === 'json') headers['content-type'] = 'application/json';

    try {
      const response = await this.fetchImpl(new URL(path, this.config.baseUrl), {
        method,
        headers,
        body: body === undefined ? undefined : body.kind === 'json' ? JSON.stringify(body.value) : body.form,
        redirect: 'manual',
        credentials: 'omit',
        signal,
      });

      // A redirect is never followed: the service credential must not travel to another origin.
      if (response.status >= 300 && response.status < 400) {
        discard(response);
        throw new AiServiceError('invalid_response', { statusCode: response.status });
      }

      const responseEnvironment = response.headers.get('x-electrohub-ai-environment');
      if (responseEnvironment !== null && responseEnvironment !== this.config.environment) {
        discard(response);
        throw new AiServiceError('environment_mismatch', { statusCode: response.status });
      }

      if (response.status !== 200) {
        const code = await this.readErrorCode(response);
        throw this.mapStatus(response, code);
      }

      if (responseEnvironment === null) {
        discard(response);
        throw new AiServiceError('environment_mismatch', { statusCode: response.status });
      }
      if (!isJsonContentType(response.headers.get('content-type'))) {
        discard(response);
        throw new AiServiceError('invalid_response', { statusCode: response.status });
      }

      const text = await this.readBoundedText(response);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AiServiceError('invalid_response', { statusCode: response.status });
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) throw new AiServiceError('invalid_response', { statusCode: response.status });
      return parsed.data;
    } catch (err: unknown) {
      if (opts.signal?.aborted) throw new AiServiceError('aborted');
      if (timedOut) throw new AiServiceError('timeout');
      if (err instanceof AiServiceError) throw err;
      // Only a failure to establish the connection proves the request was never submitted; anything later stays ambiguous.
      throw new AiServiceError(connectFailure(err) ? 'connect' : 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  private mapStatus(response: Response, code: string | undefined): AiServiceError {
    const statusCode = response.status;
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
    if (statusCode === 401) return new AiServiceError('unauthorized', { statusCode, code });
    if (statusCode === 403) {
      return new AiServiceError(code === 'AI_ENVIRONMENT_MISMATCH' ? 'environment_mismatch' : 'unauthorized', { statusCode, code });
    }
    if (statusCode === 429) return new AiServiceError('rate_limited', { statusCode, code, retryAfterMs });
    if (statusCode >= 500 && statusCode <= 504) return new AiServiceError('unavailable', { statusCode, code, retryAfterMs });
    if (statusCode >= 400 && statusCode < 500) return new AiServiceError('rejected', { statusCode, code });
    return new AiServiceError('invalid_response', { statusCode });
  }

  /** Extracts only a contract-shaped `AI_*` code; never surfaces message text. Size limits still apply. */
  private async readErrorCode(response: Response): Promise<string | undefined> {
    if (!isJsonContentType(response.headers.get('content-type'))) {
      discard(response);
      return undefined;
    }
    try {
      // An oversized or malformed error body only loses the code; the HTTP status still classifies the failure.
      const text = await this.readBoundedText(response);
      const parsed = aiErrorEnvelopeSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data.error.code : undefined;
    } catch {
      return undefined;
    }
  }

  private async readBoundedText(response: Response): Promise<string> {
    const max = this.config.maxResponseBytes;
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d{1,15}$/.test(declared.trim()) || Number(declared.trim()) > max)) {
      discard(response);
      throw new AiServiceError('response_too_large', { statusCode: response.status });
    }
    if (!response.body) return '';

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        throw new AiServiceError('response_too_large', { statusCode: response.status });
      }
      chunks.push(value);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    } catch {
      throw new AiServiceError('invalid_response', { statusCode: response.status });
    }
  }
}

let runtime: { config: AiServiceConfig; client: AiServiceClient | null } | undefined;

/** Resolved once from process.env (after src/config/env.ts loaded dotenv); never throws. */
export function getAiServiceRuntime() {
  if (!runtime) {
    const config = resolveAiServiceConfig(process.env, env.NODE_ENV);
    if (config.status === 'disabled' && config.reason === 'MISCONFIGURED') {
      logger.warn('AI_SERVICE_MISCONFIGURED', { issues: config.issues });
    }
    runtime = { config, client: config.status === 'enabled' ? new AiServiceClient(config) : null };
  }
  return runtime;
}

export function getAiServiceClient(): AiServiceClient | null {
  return getAiServiceRuntime().client;
}

/** Test seam only. */
export function resetAiServiceRuntimeForTests() {
  runtime = undefined;
}
