import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { AdminNotificationService } from '../services/admin-notification.service.js';
import { StoreSettingsService, parseOrThrow, shippingPreviewSchema } from '../services/store-settings.service.js';
import { logContext } from '../utils/logContext.js';

/**
 * Task 05.2 administrator settings endpoints. Envelopes: item → { data }; error → { error: { code, message, fields? } } with the
 * current server state under `data` for 409 conflicts, so the client can reload without a second request.
 */
const store = new StoreSettingsService();
const notifications = new AdminNotificationService();

type Handler = (req: Request, res: Response) => Promise<unknown>;
const action = (handler: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await handler(req, res);
    if (!res.headersSent) res.json(result);
  } catch (error) {
    if (error instanceof AppError && ('fields' in error || 'current' in error)) {
      const extra = error as AppError & { fields?: unknown; current?: unknown };
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message, ...(extra.fields ? { fields: extra.fields } : {}) },
        ...(extra.current ? { data: extra.current } : {}) });
      return;
    }
    next(error);
  }
};

const actor = (req: Request) => req.user!.userId;
const requestId = () => logContext.getStore()?.requestId ?? null;

export const adminSettingsController = {
  getStore: action(async () => ({ data: await store.getStore() })),
  updateStore: action(async req => ({ data: await store.updateStore(actor(req), req.body, requestId()) })),
  getShipping: action(async () => ({ data: await store.getShipping() })),
  updateShipping: action(async req => ({ data: await store.updateShipping(actor(req), req.body, requestId()) })),
  previewShipping: action(async req => ({ data: await store.previewShipping(parseOrThrow(shippingPreviewSchema, req.query).subtotal) })),
  getPreferences: action(async req => ({ data: await notifications.getPreferences(actor(req)) })),
  updatePreferences: action(async req => ({ data: await notifications.updatePreferences(actor(req), req.body, requestId()) })),
};
