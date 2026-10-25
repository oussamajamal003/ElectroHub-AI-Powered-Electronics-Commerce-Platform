import { AppError } from '../middleware/errorHandler.js';
import { AiServiceError, getAiServiceClient, type AiServiceClient } from '../integrations/ai/ai.client.js';
import type { AiImageSearchContentType, AiImageSearchResult } from '../integrations/ai/ai.schemas.js';
import { logger } from '../utils/logger.js';
import { SearchService } from './search.service.js';

/** Task 04.2: visual search result size. Default 12 cards, hard cap 24 (the AI topK cap). */
export const IMAGE_SEARCH_DEFAULT_LIMIT = 12;
export const IMAGE_SEARCH_MAX_LIMIT = 24;

/** Failure with a public envelope; `retryAfterSeconds` is set only for busy responses. */
export class ImageSearchError extends AppError {
  constructor(message: string, statusCode: number, code: string, public readonly retryAfterSeconds?: number, cause?: unknown) {
    super(message, statusCode, code, true, cause);
    // AppError pins the prototype to itself, so restore the subclass for instanceof checks.
    Object.setPrototypeOf(this, ImageSearchError.prototype);
    this.name = 'ImageSearchError';
  }
}

const UNAVAILABLE = () => new ImageSearchError('Photo search is unavailable right now. Try a text search instead.', 503, 'IMAGE_SEARCH_UNAVAILABLE');
const CANCELLED = () => new ImageSearchError('Photo search was cancelled.', 499, 'IMAGE_SEARCH_CANCELLED');
const TIMEOUT = () => new ImageSearchError('Photo search took too long. Please try again.', 504, 'IMAGE_SEARCH_TIMEOUT');

/** Maps AI-service failures onto the public envelope. Only safe codes are logged; upstream text is never surfaced. */
export function mapImageSearchFailure(error: unknown): ImageSearchError | undefined {
  if (!(error instanceof AiServiceError)) return undefined;
  switch (error.category) {
    case 'aborted':
      return CANCELLED();
    case 'timeout':
      return TIMEOUT();
    case 'rate_limited':
      return new ImageSearchError('Photo search is busy. Please try again shortly.', 429, 'IMAGE_SEARCH_BUSY',
        Math.max(1, Math.ceil((error.retryAfterMs ?? 30_000) / 1000)), error);
    case 'rejected':
      if (error.statusCode === 413) return new ImageSearchError('This photo is too large. Upload an image up to 8 MB.', 413, 'IMAGE_TOO_LARGE', undefined, error);
      if (error.statusCode === 415) return new ImageSearchError('Unsupported photo type. Use a JPEG, PNG or WebP image.', 415, 'IMAGE_SEARCH_UNSUPPORTED_TYPE', undefined, error);
      if (error.statusCode === 422) return new ImageSearchError('This photo could not be read. Try a different image.', 422, 'IMAGE_UNREADABLE', undefined, error);
      return UNAVAILABLE();
    case 'unavailable':
      // An upstream gateway timeout is reported as a timeout, every other 5xx as unavailable.
      return error.statusCode === 504 ? TIMEOUT() : UNAVAILABLE();
    default:
      // not_configured, unauthorized, environment_mismatch, connect, network, invalid_response, response_too_large
      return UNAVAILABLE();
  }
}

export interface ImageSearchResponseBody {
  data: { items: Awaited<ReturnType<SearchService['productSummariesByIds']>> };
  meta: { modelVersion: string; embeddingVersion: string; count: number };
}

export interface ImageSearchRequest {
  image: Buffer;
  contentType: AiImageSearchContentType;
  limit: number;
  requestId?: string;
  signal?: AbortSignal;
}

export class ImageSearchService {
  constructor(
    private readonly resolveClient: () => AiServiceClient | null = getAiServiceClient,
    private readonly catalog = new SearchService()
  ) {}

  async search(input: ImageSearchRequest): Promise<ImageSearchResponseBody> {
    const client = this.resolveClient();
    if (!client) throw UNAVAILABLE();

    const started = Date.now();
    let result: AiImageSearchResult;
    try {
      result = await client.imageSearch({
        image: input.image,
        contentType: input.contentType,
        topK: input.limit,
        requestId: input.requestId,
        signal: input.signal,
      });
    } catch (error) {
      const mapped = mapImageSearchFailure(error);
      if (mapped) throw mapped;
      throw error;
    }
    if (input.signal?.aborted) throw CANCELLED();

    // Product ids are the only AI output that reaches the response: prices, stock and visibility come from the database.
    const uniqueIds = [...new Set(result.matches.map(match => match.productId))];
    const items = await this.catalog.productSummariesByIds(uniqueIds);
    if (input.signal?.aborted) throw CANCELLED();

    try { logger.info('IMAGE_SEARCH_RESOLVED', {
      operation: 'image_search.resolve',
      candidateCount: uniqueIds.length,
      resultCount: items.length,
      droppedCount: uniqueIds.length - items.length,
      modelVersion: result.modelVersion,
      embeddingVersion: result.embeddingVersion,
      durationMs: Date.now() - started,
      requestId: input.requestId,
    }); } catch { /* Logging cannot replace a successful search result. */ }

    return {
      data: { items },
      meta: { modelVersion: result.modelVersion, embeddingVersion: result.embeddingVersion, count: items.length },
    };
  }
}

export const imageSearchService = new ImageSearchService();
