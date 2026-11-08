import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { storeSettings } from '../services/store-settings.service.js';
import { storefrontContact } from '../services/storefront-contact.service.js';
import { AppError } from '../middleware/errorHandler.js';

export const storefrontController = {
  async getProfile(_req: Request, res: Response, next: NextFunction) {
    try {
      const profile = await storeSettings.getStore();
      res.set('Cache-Control', 'no-store').json({ data: {
        storeName: profile.storeName, supportEmail: profile.supportEmail, supportPhone: profile.supportPhone,
        addressLine1: profile.addressLine1, addressLine2: profile.addressLine2, city: profile.city,
        region: profile.region, postalCode: profile.postalCode, country: profile.country, currency: profile.currency,
      } });
    } catch (error) { next(error); }
  },
  async contact(req: Request, res: Response, next: NextFunction) {
    try {
      const hasControl = (value: string, allowLineBreaks = false) => [...value].some(character => {
        const code = character.charCodeAt(0);
        return code === 0x7f || (code < 0x20 && !(allowLineBreaks && (code === 0x09 || code === 0x0a || code === 0x0d)));
      });
      const singleLine = (max: number) => z.string().trim().min(1).max(max).refine(value => !hasControl(value), 'Enter a single line of text.');
      const message = z.string().trim().min(1).max(5000).refine(value => !hasControl(value, true), 'Remove unsupported control characters.');
      const schema = z.object({ name: singleLine(120), email: z.string().trim().email().max(255),
        subject: singleLine(160), message }).strict();
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) throw new AppError('Check the message fields and try again.', 400, 'VALIDATION_ERROR');
      const profile = await storeSettings.getStore();
      await storefrontContact.send(parsed.data, profile.supportEmail);
      res.status(202).json({ data: { accepted: true } });
    } catch (error) { next(error); }
  },
};
