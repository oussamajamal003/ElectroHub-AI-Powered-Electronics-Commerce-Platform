import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
import { clearRefreshCookie, setRefreshCookie } from '../auth.controller.js';

/**
 * Task 06.2 cookie inventory: the exact Set-Cookie headers of the customer and administrator refresh cookies, in production mode
 * (the hermetic release stack runs NODE_ENV=test over plain HTTP, where Secure is intentionally absent; see the privacy evidence).
 */
const app = express();
app.post('/set/:scope', (req, res) => { setRefreshCookie(res, 'opaque-token', req.params.scope as 'customer' | 'admin'); res.sendStatus(204); });
app.post('/clear/:scope', (req, res) => { clearRefreshCookie(res, req.params.scope as 'customer' | 'admin'); res.sendStatus(204); });
const original = process.env.NODE_ENV;
afterEach(() => { process.env.NODE_ENV = original; });

const cookies = async (path: string) => (await request(app).post(path)).headers['set-cookie'] as unknown as string[];
const attributes = (header: string) => header.split(';').slice(1).map(part => part.trim().toLowerCase());

describe('refresh cookie attributes', () => {
  for (const scope of ['customer', 'admin'] as const) {
    it(`${scope}: HttpOnly, Secure, SameSite=Lax, scoped path, 7-day lifetime, no Domain (host-only) in production`, async () => {
      process.env.NODE_ENV = 'production';
      const headers = await cookies(`/set/${scope}`);
      const issued = headers.find(header => header.startsWith(`electrohub_${scope}_refresh=`))!;
      expect(issued).toBeDefined();
      const flags = attributes(issued);
      expect(flags).toEqual(expect.arrayContaining(['httponly', 'secure', 'samesite=lax', `path=/api/auth/${scope}`, 'max-age=604800']));
      expect(flags.some(flag => flag.startsWith('domain='))).toBe(false);
      // The other portal's path never receives this cookie, so customer and admin sessions cannot authenticate each other.
      expect(flags).not.toContain(`path=/api/auth/${scope === 'customer' ? 'admin' : 'customer'}`);
      // The pre-isolation shared cookie is only ever expired.
      expect(headers.filter(header => header.startsWith('electrohub_refresh=;'))).toHaveLength(2);
    });

    it(`${scope}: logout expires the cookie with the same path and flags`, async () => {
      process.env.NODE_ENV = 'production';
      const cleared = (await cookies(`/clear/${scope}`)).find(header => header.startsWith(`electrohub_${scope}_refresh=;`))!;
      expect(cleared).toBeDefined();
      expect(attributes(cleared)).toEqual(expect.arrayContaining(['httponly', 'secure', 'samesite=lax', `path=/api/auth/${scope}`,
        'expires=thu, 01 jan 1970 00:00:00 gmt']));
    });
  }

  it('omits Secure only outside production (local HTTP development and the hermetic test stack)', async () => {
    process.env.NODE_ENV = 'test';
    const issued = (await cookies('/set/customer')).find(header => header.startsWith('electrohub_customer_refresh='))!;
    expect(attributes(issued)).not.toContain('secure');
    expect(attributes(issued)).toContain('httponly');
  });
});
