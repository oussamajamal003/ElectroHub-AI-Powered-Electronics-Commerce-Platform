import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';

/**
 * Contact form → real Express route → real validation → real StorefrontContactService → real BrevoProvider, which (in test mode,
 * with a capture directory and a synthetic `.invalid` recipient) writes the message to disk instead of calling Brevo. Only the store
 * settings read is stubbed. Nothing can leave this machine: the provider refuses non-.invalid recipients when capture is on.
 */
const store = vi.hoisted(() => ({ getStore: vi.fn() }));
const administrators = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../services/store-settings.service.js', () => ({ storeSettings: store }));
vi.mock('../lib/prisma.js', () => ({ prisma: { user: administrators } }));

import storefrontRoutes from './storefront.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

const recipient = 'support@northstar.invalid';
let outbox = '';
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use('/api', storefrontRoutes);
app.use(errorHandler);
const read = async (subject: string) => JSON.parse(await readFile(join(outbox, `${createHash('sha256').update(`${recipient}:${subject}`).digest('hex')}.json`), 'utf8')) as
  { to: string; subject: string; textContent: string };
let ip = 10;
const post = (body: object) => request(app).post('/api/store/contact').set('X-Forwarded-For', `203.0.113.${ip++}`).send(body);

beforeAll(async () => {
  outbox = await mkdtemp(join(tmpdir(), 'contact-capture-'));
  (env as { E2E_OTP_OUTBOX_DIR?: string }).E2E_OTP_OUTBOX_DIR = outbox;
});
afterAll(async () => {
  (env as { E2E_OTP_OUTBOX_DIR?: string }).E2E_OTP_OUTBOX_DIR = undefined;
  await rm(outbox, { recursive: true, force: true });
});
beforeEach(() => {
  administrators.findMany.mockResolvedValue([{ email: recipient }]);
  store.getStore.mockResolvedValue({ storeName: 'Northstar', supportEmail: recipient, supportPhone: null, addressLine1: null, addressLine2: null,
    city: null, region: null, postalCode: null, country: null, businessHours: null, timezone: 'UTC', currency: 'USD', version: 1, updatedAt: null });
});

describe('contact form end to end through the real provider (captured, never sent)', () => {
  it('fans one approved submission out to every eligible administrator even with no Support Email', async () => {
    administrators.findMany.mockResolvedValue([{ email: recipient }, { email: 'second-admin@northstar.invalid' }]);
    store.getStore.mockResolvedValueOnce({ storeName: 'Northstar', supportEmail: null });
    const response = await post({ name: 'Ada', email: 'ada@example.test', subject: 'All eligible administrators', message: 'One captured test' });
    expect(response.status).toBe(202);
    const second = createHash('sha256').update('second-admin@northstar.invalid:Store contact: All eligible administrators').digest('hex');
    expect(JSON.parse(await readFile(join(outbox, `${second}.json`), 'utf8')).to).toBe('second-admin@northstar.invalid');
    expect((await read('Store contact: All eligible administrators')).to).toBe(recipient);
  });
  it('delivers a valid message to the configured mailbox only, with the customer text intact', async () => {
    const response = await post({ name: 'Ada Customer', email: 'ada@example.test', subject: 'Order question', message: 'Where is my order?\nThanks!', website: '' });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ data: { accepted: true } });
    const captured = await read('Store contact: Order question');
    expect(captured.to).toBe(recipient);
    expect(captured.textContent).toContain('Where is my order?\nThanks!');
    expect(captured.textContent).toContain('Ada Customer <ada@example.test>');
  });

  it('cannot be turned into a relay: a client-chosen recipient is rejected and nothing is captured for it', async () => {
    const before = (await readdir(outbox)).length;
    expect((await post({ name: 'X', email: 'x@example.test', subject: 'Hi', message: 'Hello there', to: 'victim@example.invalid' })).status).toBe(400);
    expect((await post({ name: 'X', email: 'x@example.test', subject: 'Hi\r\nBcc: victim@example.invalid', message: 'Hello there' })).status).toBe(400);
    expect((await readdir(outbox)).length).toBe(before);
  });

  it('a filled honeypot is accepted for the bot but nothing is delivered', async () => {
    const before = (await readdir(outbox)).length;
    expect((await post({ name: 'Bot', email: 'bot@example.test', subject: 'Spam', message: 'Buy now please', website: 'https://spam.example' })).status).toBe(202);
    expect((await readdir(outbox)).length).toBe(before);
  });

  it('no eligible administrator is an honest 503, never a fake success', async () => {
    store.getStore.mockResolvedValue({ storeName: 'Northstar', supportEmail: null });
    administrators.findMany.mockResolvedValueOnce([]);
    const response = await post({ name: 'Ada', email: 'ada@example.test', subject: 'Nobody home', message: 'Hello there' });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('CONTACT_NOT_CONFIGURED');
    expect(response.body.data).toBeUndefined();
  });

  it('rejects an oversized message before any delivery', async () => {
    const response = await post({ name: 'Ada', email: 'ada@example.test', subject: 'Long', message: 'x'.repeat(5001) });
    expect(response.status).toBe(400);
  });
});
