import { AppError } from '../middleware/errorHandler.js';
import { AiServiceError, getAiServiceClient, type AiServiceClient } from '../integrations/ai/ai.client.js';
import type { AiImageSearchContentType, AiImageSearchResult } from '../integrations/ai/ai.schemas.js';
import { logger } from '../utils/logger.js';
import { SearchService } from './search.service.js';

/** Task 04.2: visual search result size. Default 12 cards, hard cap 24 (the AI topK cap). */
export const IMAGE_SEARCH_DEFAULT_LIMIT = 12;
export const IMAGE_SEARCH_MAX_LIMIT = 24;
/**
 * Task 04.2-Q: weight of the AI's query-category probability when ordering resolved products
 * (rank by similarity + weight x P(product's category)). Chosen on the calibration split; see
 * TASK_04.2_IMPLEMENTATION_EVIDENCE.md. Only reorders the products the AI service already accepted. Used when the
 * AI service does not send the weight selected for its own relevance gate.
 */
export const IMAGE_SEARCH_CATEGORY_WEIGHT = 0.5;

type ResolvedProduct = Awaited<ReturnType<SearchService['productSummariesByIds']>>[number];

/**
 * Drops products whose (database) category hint is below `ratio` x the strongest hint; order is preserved.
 * Without hints or with a non-positive ratio every product is kept.
 */
export function filterByCategory(
  items: ResolvedProduct[],
  hints: AiImageSearchResult['categoryHints'],
  ratio: number | null | undefined,
): ResolvedProduct[] {
  if (!ratio || ratio <= 0 || hints.length === 0) return items;
  const probability = new Map(hints.map(hint => [hint.category, hint.probability]));
  const floor = ratio * Math.max(...hints.map(hint => hint.probability));
  return items.filter(item => (probability.get(item.category.slug) ?? 0) >= floor);
}

/**
 * Category fallback: products of the strongest hinted (database) category among the AI's deeper candidates, within
 * `gap` of the best of them, in AI order. Used only when the regular list is empty after the category filter.
 */
export function fallbackByCategory(
  items: ResolvedProduct[],
  candidates: AiImageSearchResult['matches'],
  hints: AiImageSearchResult['categoryHints'],
  gap: number,
  limit: number,
): ResolvedProduct[] {
  if (hints.length === 0) return [];
  const top = hints.reduce((best, hint) => (hint.probability > best.probability ? hint : best));
  const score = new Map(candidates.map(match => [match.productId.toLowerCase(), match.score]));
  const inCategory = items
    .filter(item => item.category.slug === top.category && score.has(item.id.toLowerCase()))
    .sort((a, b) => (score.get(b.id.toLowerCase()) ?? 0) - (score.get(a.id.toLowerCase()) ?? 0));
  if (inCategory.length === 0) return [];
  const floor = (score.get(inCategory[0].id.toLowerCase()) ?? 0) - gap;
  return inCategory.filter(item => (score.get(item.id.toLowerCase()) ?? 0) >= floor).slice(0, limit);
}

/** Stable reorder by similarity + weight x hint for the product's (authoritative, database) category. */
export function rerankByCategory(
  items: ResolvedProduct[],
  matches: AiImageSearchResult['matches'],
  hints: AiImageSearchResult['categoryHints'],
  weight = IMAGE_SEARCH_CATEGORY_WEIGHT,
): ResolvedProduct[] {
  if (hints.length === 0 || items.length < 2) return items;
  const probability = new Map(hints.map(hint => [hint.category, hint.probability]));
  const score = new Map(matches.map(match => [match.productId.toLowerCase(), match.score]));
  return items
    .map((item, index) => ({ item, index, value: (score.get(item.id.toLowerCase()) ?? -1) + weight * (probability.get(item.category.slug) ?? 0) }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .map(entry => entry.item);
}

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
    let items = rerankByCategory(
      filterByCategory(await this.catalog.productSummariesByIds(uniqueIds), result.categoryHints, result.categoryMinRatio),
      result.matches,
      result.categoryHints,
      result.categoryWeight ?? IMAGE_SEARCH_CATEGORY_WEIGHT,
    );
    let usedFallback = false;
    if (items.length === 0 && result.fallbackMatches?.length && result.fallbackScoreGap != null) {
      const fallbackIds = [...new Set(result.fallbackMatches.map(match => match.productId))];
      items = rerankByCategory(
        fallbackByCategory(
          await this.catalog.productSummariesByIds(fallbackIds),
          result.fallbackMatches,
          result.categoryHints,
          result.fallbackScoreGap,
          input.limit,
        ),
        result.fallbackMatches,
        result.categoryHints,
        result.categoryWeight ?? IMAGE_SEARCH_CATEGORY_WEIGHT,
      );
      usedFallback = items.length > 0;
    }
    if (input.signal?.aborted) throw CANCELLED();

    try { logger.info('IMAGE_SEARCH_RESOLVED', {
      operation: 'image_search.resolve',
      candidateCount: uniqueIds.length,
      resultCount: items.length,
      droppedCount: uniqueIds.length - items.length,
      categoryHintCount: result.categoryHints.length,
      categoryFallback: usedFallback,
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
