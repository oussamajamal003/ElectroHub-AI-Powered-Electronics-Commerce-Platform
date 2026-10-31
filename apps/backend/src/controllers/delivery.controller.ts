import { performance } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { collectDbMetrics } from '../lib/db-request-metrics.js';
import { DeliveryRevisionConflict, DeliveryService } from '../services/delivery.service.js';
import { adminDeliveryListSchema, deliveryStartSchema, deliveryUpdateSchema } from '../validators/delivery.validator.js';
import { logSafely } from '../utils/logger.js';

const service = new DeliveryService();

/** Parse failures never echo the submitted values (coordinates, notes) into the error envelope or the logs. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError('Check the delivery update and try again.', 400, 'VALIDATION_ERROR');
  return result.data;
}

/** Per-request facts a handler may add to its timing event. Only booleans/enums: never identifiers, coordinates, labels or notes. */
type Facts = { changed?: boolean; created?: boolean };
type Action = (req: Request, res: Response, facts: Facts) => Promise<void>;

/**
 * One bounded, PII-free timing event per attempted delivery operation (success or failure), correlated by request id. It reuses the
 * Task 04.0 scoped DB collector (no extra round trips) and can never change the response: logSafely swallows sink failures, and the
 * event is emitted after the response path has already been chosen.
 */
const action = (event: string, handler: Action) => async (req: Request, res: Response, next: NextFunction) => {
  const started = performance.now();
  const facts: Facts = {};
  const scoped = collectDbMetrics(() => handler(req, res, facts));
  let outcome = 'ok';
  let status: number | undefined;
  try { await scoped.result; status = res.statusCode; } catch (error) {
    outcome = error instanceof AppError ? error.code : error instanceof z.ZodError ? 'VALIDATION_ERROR' : 'UNEXPECTED';
    status = error instanceof AppError ? error.statusCode : error instanceof z.ZodError ? 400 : 500;
    if (error instanceof DeliveryRevisionConflict) {
      // The current snapshot lets the admin UI show "already applied" / "load latest" without a second request.
      try { res.status(409).json({ error: { code: error.code, message: error.message }, snapshot: await service.getAdminSnapshot(error.orderReference) }); }
      catch (readError) { next(readError); }
    } else next(error);
  } finally {
    try {
      logSafely('info', 'Delivery timing', { event, requestId: req.id, outcome, status, revisionConflict: outcome === 'DELIVERY_REVISION_CONFLICT',
        ...facts, durationMs: Math.round((performance.now() - started) * 100) / 100, ...scoped.metrics() });
    } catch { /* diagnostics must never change the API result */ }
  }
};

export const getCustomerDelivery = action('delivery.customer_read.timing', async (req, res) => {
  res.json({ data: await service.getCustomerSnapshot(req.user!.userId, String(req.params.orderReference)) });
});

export const listAdminDeliveries = action('delivery.admin_list.timing', async (req, res) => {
  res.json(await service.listForAdmin(parse(adminDeliveryListSchema, req.query)));
});

export const getAdminDelivery = action('delivery.admin_read.timing', async (req, res) => {
  res.json({ data: await service.getAdminSnapshot(String(req.params.orderReference)) });
});

export const startAdminDelivery = action('delivery.start.timing', async (req, res, facts) => {
  parse(deliveryStartSchema, req.body ?? {});
  const { created, snapshot } = await service.start(req.user!.userId, String(req.params.orderReference));
  facts.created = created;
  // Operational metadata only: no coordinates, labels or notes are ever logged.
  if (created) logSafely('info', 'Delivery tracking started', { event: 'delivery.started', requestId: req.id, orderId: snapshot.orderId, revision: snapshot.revision });
  res.status(created ? 201 : 200).json({ data: snapshot });
});

export const updateAdminDelivery = action('delivery.update.timing', async (req, res, facts) => {
  const input = parse(deliveryUpdateSchema(), req.body);
  const { changed, snapshot } = await service.applyUpdate(req.user!.userId, String(req.params.orderReference), input);
  facts.changed = changed;
  if (changed) logSafely('info', 'Delivery tracking updated', { event: 'delivery.updated', requestId: req.id, orderId: snapshot.orderId,
    revision: snapshot.current?.revision, status: snapshot.status });
  res.json({ data: snapshot, meta: { changed } });
});
