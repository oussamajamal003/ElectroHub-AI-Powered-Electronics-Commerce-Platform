import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
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

type Action = (req: Request, res: Response) => Promise<void>;
const action = (handler: Action) => async (req: Request, res: Response, next: NextFunction) => {
  try { await handler(req, res); } catch (error) {
    if (error instanceof DeliveryRevisionConflict) {
      // The current snapshot lets the admin UI show "already applied" / "load latest" without a second request.
      try { res.status(409).json({ error: { code: error.code, message: error.message }, snapshot: await service.getAdminSnapshot(error.orderReference) }); }
      catch (readError) { next(readError); }
      return;
    }
    next(error);
  }
};

export const getCustomerDelivery = action(async (req, res) => {
  res.json({ data: await service.getCustomerSnapshot(req.user!.userId, String(req.params.orderReference)) });
});

export const listAdminDeliveries = action(async (req, res) => {
  res.json(await service.listForAdmin(parse(adminDeliveryListSchema, req.query)));
});

export const getAdminDelivery = action(async (req, res) => {
  res.json({ data: await service.getAdminSnapshot(String(req.params.orderReference)) });
});

export const startAdminDelivery = action(async (req, res) => {
  parse(deliveryStartSchema, req.body ?? {});
  const { created, snapshot } = await service.start(req.user!.userId, String(req.params.orderReference));
  // Operational metadata only: no coordinates, labels or notes are ever logged.
  if (created) logSafely('info', 'Delivery tracking started', { event: 'delivery.started', requestId: req.id, orderId: snapshot.orderId, revision: snapshot.revision });
  res.status(created ? 201 : 200).json({ data: snapshot });
});

export const updateAdminDelivery = action(async (req, res) => {
  const input = parse(deliveryUpdateSchema(), req.body);
  const { changed, snapshot } = await service.applyUpdate(req.user!.userId, String(req.params.orderReference), input);
  if (changed) logSafely('info', 'Delivery tracking updated', { event: 'delivery.updated', requestId: req.id, orderId: snapshot.orderId,
    revision: snapshot.current?.revision, status: snapshot.status });
  res.json({ data: snapshot, meta: { changed } });
});
