import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { recommendationAdminService, type RecommendationPeriod } from '../services/recommendation-admin.service.js';
import { FEATURED_MAX_PER_SURFACE, RECOMMENDATION_MAX_LIMIT, RECOMMENDATION_DEFAULT_LIMIT } from '../services/recommendation-config.js';

/**
 * Task 05.2 administrator recommendation API. Thin: validates the request, delegates to the admin service and returns
 * the { data } envelope. Validation errors name only the offending fields.
 */

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const surface = z.enum(['home', 'product_detail', 'cart']);
const mode = z.enum(['POPULAR_PRODUCTS', 'RECOMMENDED_FOR_YOU', 'SIMILAR_PRODUCTS', 'YOU_MAY_ALSO_LIKE', 'FREQUENTLY_BOUGHT_TOGETHER']);
const expectedVersion = z.number().int().min(0).max(1_000_000_000);
const instant = z.string().datetime({ offset: true }).transform(value => new Date(value));

const overviewQuery = z.object({
  period: z.enum(['7d', '30d', '90d']).default('30d'),
  surface: surface.optional(),
}).strict();

const configurationPatch = z.object({
  enabled: z.boolean().optional(),
  itemLimit: z.number().int().min(1).max(RECOMMENDATION_MAX_LIMIT).optional(),
  expectedVersion,
}).strict().refine(value => value.enabled !== undefined || value.itemLimit !== undefined, { message: 'Choose a change to save.' });

const previewQuery = z.object({
  surface,
  productId: uuid.optional(),
  cartProductIds: z.string().max(1000).optional().transform(value => (value ? [...new Set(value.split(',').map(id => id.trim()).filter(Boolean))] : undefined))
    .pipe(z.array(uuid).max(12).optional()),
  limit: z.coerce.number().int().min(1).max(RECOMMENDATION_MAX_LIMIT).default(RECOMMENDATION_DEFAULT_LIMIT),
}).strict();

const featuredListQuery = z.object({ surface: surface.optional() }).strict();

const featuredCreate = z.object({
  productId: uuid,
  surface,
  position: z.number().int().min(0).max(99).default(0),
  startsAt: instant.nullable().optional().transform(value => value ?? null),
  endsAt: instant.nullable().optional().transform(value => value ?? null),
  enabled: z.boolean().default(true),
}).strict();

const featuredPatch = z.object({
  expectedVersion,
  position: z.number().int().min(0).max(99).optional(),
  startsAt: instant.nullable().optional(),
  endsAt: instant.nullable().optional(),
  enabled: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).some(key => key !== 'expectedVersion'), { message: 'Choose a change to save.' });

const featuredDelete = z.object({ expectedVersion: z.coerce.number().int().min(0).optional() }).strict();

const idParam = z.string().uuid().transform(value => value.toLowerCase());

function actorOf(req: Request) {
  return { userId: req.user!.userId, requestId: req.id };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = result.error.issues.slice(0, 20).map(issue => ({ field: issue.path.join('.') || null, message: issue.message }));
    throw Object.assign(new AppError('Check the highlighted fields and try again.', 400, 'VALIDATION_ERROR'), { fields });
  }
  return result.data;
}

type Handler = (req: Request, res: Response) => Promise<void>;
const handle = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};

export const adminRecommendationsController = {
  overview: handle(async (req, res) => {
    const query = parse(overviewQuery, req.query);
    res.json({ data: await recommendationAdminService.overview(query.period as RecommendationPeriod, query.surface) });
  }),

  configurations: handle(async (_req, res) => {
    res.json({ data: await recommendationAdminService.configurations() });
  }),

  updateConfiguration: handle(async (req, res) => {
    const params = parse(z.object({ surface, mode }).strict(), req.params);
    const body = parse(configurationPatch, req.body);
    res.json({ data: await recommendationAdminService.updateSection(params.surface, params.mode, body, actorOf(req)) });
  }),

  preview: handle(async (req, res) => {
    const query = parse(previewQuery, req.query);
    res.json({ data: await recommendationAdminService.preview({ surface: query.surface, productId: query.productId,
      cartProductIds: query.cartProductIds, limit: query.limit }) });
  }),

  listFeatured: handle(async (req, res) => {
    const query = parse(featuredListQuery, req.query);
    res.json({ data: await recommendationAdminService.listPins(query.surface), meta: { maxPerSurface: FEATURED_MAX_PER_SURFACE } });
  }),

  createFeatured: handle(async (req, res) => {
    const body = parse(featuredCreate, req.body);
    res.status(201).json({ data: await recommendationAdminService.createPin(body, actorOf(req)) });
  }),

  updateFeatured: handle(async (req, res) => {
    const id = parse(idParam, req.params.id);
    const body = parse(featuredPatch, req.body);
    res.json({ data: await recommendationAdminService.updatePin(id, body, actorOf(req)) });
  }),

  deleteFeatured: handle(async (req, res) => {
    const id = parse(idParam, req.params.id);
    const query = parse(featuredDelete, req.query);
    await recommendationAdminService.deletePin(id, actorOf(req), query.expectedVersion);
    res.status(204).end();
  }),
};
