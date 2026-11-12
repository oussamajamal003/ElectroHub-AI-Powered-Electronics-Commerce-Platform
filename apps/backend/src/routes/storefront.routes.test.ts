import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ getStore: vi.fn() }));
const contact = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../services/store-settings.service.js', () => ({ storeSettings: store }));
vi.mock('../services/storefront-contact.service.js', () => ({ storefrontContact: contact }));

import storefrontRoutes from './storefront.routes.js';

const profile = { storeName: 'Northstar', supportEmail: 'support@example.test', supportPhone: '+1 555 010 0100',
  addressLine1: '1 Main', addressLine2: null, city: 'Boston', region: 'MA', postalCode: '02110', country: 'US', businessHours: 'Mon–Fri, 9–6', timezone: 'UTC', currency: 'USD',
  version: 7, updatedAt: 'private timestamp', updatedById: 'private-user', internalNotes: 'must not leak' };
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api', storefrontRoutes);
app.use((error: { statusCode?: number; code?: string; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error.statusCode ?? 500).json({ error: { code: error.code ?? 'INTERNAL', message: error.message ?? 'Internal error' } });
});
const valid = { name: 'Test Customer', email: 'customer@example.test', subject: 'Product question', message: 'Hello\nCan you help?' };

beforeEach(() => {
  vi.clearAllMocks();
  store.getStore.mockResolvedValue(profile);
  contact.send.mockResolvedValue(undefined);
});

describe('public storefront routes', () => {
  it('returns only the explicit public profile DTO and disables intermediary caching', async () => {
    const response = await request(app).get('/api/store/profile');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ data: { storeName: 'Northstar', supportEmail: 'support@example.test', supportPhone: '+1 555 010 0100',
      addressLine1: '1 Main', addressLine2: null, city: 'Boston', region: 'MA', postalCode: '02110', country: 'US', businessHours: 'Mon–Fri, 9–6', currency: 'USD' } });
    expect(JSON.stringify(response.body)).not.toMatch(/timezone|version|updatedAt|updatedById|internalNotes/);
  });

  it('accepts a validated contact message and always targets the saved support email', async () => {
    const response = await request(app).post('/api/store/contact').send(valid);
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ data: { accepted: true } });
    expect(contact.send).toHaveBeenCalledWith(valid, 'support@example.test', 'Northstar');
  });

  it('rejects malformed, extra, and newline-injected fields before reading store settings or sending mail', async () => {
    for (const body of [
      { ...valid, email: 'bad-email' }, { ...valid, recipient: 'attacker@example.test' },
      { ...valid, name: 'Customer\r\nBcc: attacker@example.test' }, { ...valid, subject: 'Question\nInjected' },
    ]) {
      const response = await request(app).post('/api/store/contact').set('X-Forwarded-For', `198.51.100.${Math.floor(Math.random() * 200) + 1}`).send(body);
      expect(response.status).toBe(400);
    }
    expect(store.getStore).not.toHaveBeenCalled();
    expect(contact.send).not.toHaveBeenCalled();
  });

  it('answers a filled honeypot as accepted but never reads settings or sends mail', async () => {
    const response = await request(app).post('/api/store/contact').set('X-Forwarded-For', '198.51.100.77').send({ ...valid, website: 'https://spam.example' });
    expect(response.status).toBe(202);
    expect(contact.send).not.toHaveBeenCalled();
    expect(store.getStore).not.toHaveBeenCalled();
  });

  it('accepts the empty honeypot a real browser submits and does not forward it', async () => {
    const response = await request(app).post('/api/store/contact').set('X-Forwarded-For', '198.51.100.78').send({ ...valid, website: '' });
    expect(response.status).toBe(202);
    expect(contact.send).toHaveBeenCalledWith(valid, 'support@example.test', 'Northstar');
  });

  it('surfaces an unconfigured or failing mailbox as a safe 503 without leaking detail', async () => {
    contact.send.mockRejectedValue(Object.assign(new Error('Contact delivery is temporarily unavailable.'), { statusCode: 503, code: 'CONTACT_UNAVAILABLE' }));
    const response = await request(app).post('/api/store/contact').set('X-Forwarded-For', '198.51.100.79').send(valid);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('CONTACT_UNAVAILABLE');
  });

  it('limits public contact submissions to five per minute per client', async () => {
    const ip = '198.51.100.222';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await request(app).post('/api/store/contact').set('X-Forwarded-For', ip).send(valid)).status);
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
  });
});
