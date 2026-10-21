import { z } from 'zod';
import { AI_SERVICE_ENVIRONMENTS } from './ai.config.js';

/**
 * Task 04.1: strict wire schemas for the frozen FastAPI <-> Express internal contract (camelCase, `{ data }` envelope).
 * Unknown fields are rejected so contract drift fails loudly instead of leaking through.
 */

export const AI_MAX_TOP_K = 24;
export const AI_MAX_CANDIDATES = 200;
export const AI_DEFAULT_LIMIT = 12;
export const AI_ERROR_CODE_PATTERN = /^AI_[A-Z_]{1,48}$/;

const versionString = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);
const environment = z.enum(AI_SERVICE_ENVIRONMENTS);

export const aiFeatureSchema = z.object({
  available: z.boolean(),
  status: z.enum(['READY', 'NOT_READY']),
  reason: z.enum(['MODEL_NOT_LOADED', 'MODEL_NOT_CONFIGURED', 'INDEX_NOT_READY']).nullable(),
  modelVersion: versionString.nullable(),
  embeddingVersion: versionString.nullable(),
}).strict().superRefine((feature, ctx) => {
  if (feature.available !== (feature.status === 'READY')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'available must match status', path: ['status'] });
  }
  if (feature.available !== (feature.reason === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'reason is null only when available', path: ['reason'] });
  }
});

export const aiFeaturesSchema = z.object({
  imageSearch: aiFeatureSchema,
  recommendations: aiFeatureSchema,
}).strict();

export const aiReadySchema = z.object({
  data: z.object({
    status: z.literal('ready'),
    service: z.literal('electrohub-ai-service'),
    environment,
    apiVersion: z.literal('v1'),
    modelReady: z.boolean(),
    features: aiFeaturesSchema,
  }).strict(),
}).strict();

const positiveInt = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const aiCapabilitiesSchema = z.object({
  data: z.object({
    service: z.literal('electrohub-ai-service'),
    environment,
    apiVersion: z.literal('v1'),
    serviceVersion: versionString,
    features: aiFeaturesSchema,
    limits: z.object({
      maxRequestBytes: positiveInt,
      maxTopK: positiveInt,
      maxCandidates: positiveInt,
      inferenceTimeoutMs: positiveInt,
      maxConcurrentInferences: positiveInt,
    }).strict(),
  }).strict(),
}).strict();

export const aiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().regex(AI_ERROR_CODE_PATTERN),
    message: z.string().max(500),
    requestId: z.string().max(100),
    details: z.array(z.object({ loc: z.array(z.string().max(100)).max(20), type: z.string().max(100) }).strict())
      .max(20).optional(),
  }).strict(),
}).strict();

export const AI_RECOMMENDATION_MODES = [
  'SIMILAR_PRODUCTS',
  'YOU_MAY_ALSO_LIKE',
  'RECOMMENDED_FOR_YOU',
  'FREQUENTLY_BOUGHT_TOGETHER',
  'POPULAR_PRODUCTS',
] as const;
export type AiRecommendationMode = (typeof AI_RECOMMENDATION_MODES)[number];
const MODES_REQUIRING_PRODUCT = new Set<AiRecommendationMode>(['SIMILAR_PRODUCTS', 'YOU_MAY_ALSO_LIKE', 'FREQUENTLY_BOUGHT_TOGETHER']);

export const aiRecommendationRequestSchema = z.object({
  mode: z.enum(AI_RECOMMENDATION_MODES),
  productId: z.string().uuid().nullable().default(null),
  candidateProductIds: z.array(z.string().uuid()).max(AI_MAX_CANDIDATES).default([]),
  limit: z.number().int().min(1).max(AI_MAX_TOP_K).default(AI_DEFAULT_LIMIT),
}).strict().superRefine((request, ctx) => {
  if (MODES_REQUIRING_PRODUCT.has(request.mode) && request.productId === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'productId is required for this mode', path: ['productId'] });
  }
  if (new Set(request.candidateProductIds.map(id => id.toLowerCase())).size !== request.candidateProductIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'candidateProductIds must be unique', path: ['candidateProductIds'] });
  }
});
export type AiRecommendationRequestInput = z.input<typeof aiRecommendationRequestSchema>;
export type AiRecommendationRequest = z.output<typeof aiRecommendationRequestSchema>;

const rankedItemSchema = z.object({
  productId: z.string().uuid(),
  score: z.number().finite().min(-1).max(1),
  rank: z.number().int().positive(),
}).strict();

/** Ranked list invariants: <= cap, unique productId, rank contiguous 1..n, scores non-increasing by rank. */
export function rankedItemsSchema(cap: number) {
  return z.array(rankedItemSchema).max(cap).superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      const id = item.productId.toLowerCase();
      if (seen.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate productId', path: [index, 'productId'] });
      seen.add(id);
      if (item.rank !== index + 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'rank must be contiguous', path: [index, 'rank'] });
      if (index > 0 && item.score > items[index - 1].score) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'scores must be non-increasing', path: [index, 'score'] });
      }
    });
  });
}

export function aiRecommendationResultSchema(cap: number = AI_MAX_TOP_K) {
  return z.object({
    data: z.object({
      mode: z.enum(AI_RECOMMENDATION_MODES),
      items: rankedItemsSchema(cap),
      modelVersion: versionString,
      embeddingVersion: versionString,
    }).strict(),
  }).strict();
}

export function aiImageSearchResultSchema(cap: number = AI_MAX_TOP_K) {
  return z.object({
    data: z.object({
      matches: rankedItemsSchema(cap),
      modelVersion: versionString,
      embeddingVersion: versionString,
    }).strict(),
  }).strict();
}

export type AiFeature = z.infer<typeof aiFeatureSchema>;
export type AiReadiness = z.infer<typeof aiReadySchema>['data'];
export type AiCapabilities = z.infer<typeof aiCapabilitiesSchema>['data'];
export type AiRecommendationResult = z.infer<ReturnType<typeof aiRecommendationResultSchema>>['data'];
export type AiImageSearchResult = z.infer<ReturnType<typeof aiImageSearchResultSchema>>['data'];
