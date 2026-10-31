import { beforeEach, describe, expect, it, vi } from 'vitest';

// No database client: the service is replaced, the real conflict error class and controller wrapper are exercised.
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../utils/logger.js', () => ({ logSafely: vi.fn() }));
const service = vi.hoisted(() => ({ getCustomerSnapshot: vi.fn(), getAdminSnapshot: vi.fn(), listForAdmin: vi.fn(), start: vi.fn(), applyUpdate: vi.fn() }));
vi.mock('../services/delivery.service.js', async importOriginal => ({
  ...await importOriginal<typeof import('../services/delivery.service.js')>(),
  DeliveryService: class { getCustomerSnapshot = service.getCustomerSnapshot; getAdminSnapshot = service.getAdminSnapshot;
    listForAdmin = service.listForAdmin; start = service.start; applyUpdate = service.applyUpdate; },
}));

import type { NextFunction, Request, Response } from 'express';
import { logSafely } from '../utils/logger.js';
import { DeliveryRevisionConflict } from '../services/delivery.service.js';
import { getCustomerDelivery, startAdminDelivery, updateAdminDelivery } from './delivery.controller.js';

const REFERENCE = 'ORD-11111111-1111-4111-8111-111111111111';
function call(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>, init: { body?: unknown; params?: Record<string, string> } = {}) {
  const res = { statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(value: unknown) { this.body = value; return this; } };
  const next = vi.fn();
  const req = { id: 'req-1', user: { userId: 'user-secret-id' }, params: { orderReference: REFERENCE, ...init.params }, body: init.body, query: {} };
  return handler(req as unknown as Request, res as unknown as Response, next).then(() => ({ res, next }));
}
const timing = (event: string) => vi.mocked(logSafely).mock.calls.filter(entry => (entry[2] as { event?: string })?.event === event).map(entry => entry[2] as Record<string, unknown>);

describe('Task 04.5 delivery timing events', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('a customer read emits one safe timing event', async () => {
    service.getCustomerSnapshot.mockResolvedValue({ status: 'PREPARING' });
    const { res } = await call(getCustomerDelivery);
    expect(res.body).toEqual({ data: { status: 'PREPARING' } });
    const events = timing('delivery.customer_read.timing');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ requestId: 'req-1', outcome: 'ok', status: 200, durationMs: expect.any(Number), attribution: expect.any(String) });
    expect(JSON.stringify(vi.mocked(logSafely).mock.calls)).not.toContain('user-secret-id');
    expect(JSON.stringify(vi.mocked(logSafely).mock.calls)).not.toContain(REFERENCE);
  });

  it('an accepted update emits one event flagged changed, and no coordinates, label or note ever reach the log', async () => {
    service.applyUpdate.mockResolvedValue({ changed: true, snapshot: { orderId: 'o1', status: 'OUT_FOR_DELIVERY', current: { revision: 3 } } });
    const body = { expectedRevision: 2, location: { latitude: 33.123456, longitude: 35.654321, label: 'Secret Street 5' }, note: 'Gate code 4321' };
    await call(updateAdminDelivery, { body });
    const events = timing('delivery.update.timing');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'ok', changed: true });
    const logged = JSON.stringify(vi.mocked(logSafely).mock.calls);
    for (const secret of ['33.123456', '35.654321', 'Secret Street', 'Gate code', REFERENCE]) expect(logged).not.toContain(secret);
  });

  it('a no-op update is classified changed:false; a started delivery is classified created', async () => {
    service.applyUpdate.mockResolvedValue({ changed: false, snapshot: { orderId: 'o1', status: 'PREPARING', current: { revision: 2 } } });
    await call(updateAdminDelivery, { body: { expectedRevision: 2, note: 'x', estimatedAt: null } });
    expect(timing('delivery.update.timing')[0]).toMatchObject({ outcome: 'ok', changed: false });
    service.start.mockResolvedValue({ created: true, snapshot: { orderId: 'o1', revision: 1 } });
    await call(startAdminDelivery, { body: {} });
    expect(timing('delivery.start.timing')[0]).toMatchObject({ outcome: 'ok', created: true, status: 201 });
  });

  it('a revision conflict keeps the 409 body with the snapshot and is classified', async () => {
    service.applyUpdate.mockRejectedValue(new DeliveryRevisionConflict(REFERENCE));
    service.getAdminSnapshot.mockResolvedValue({ revision: 5 });
    const { res, next } = await call(updateAdminDelivery, { body: { expectedRevision: 1, status: 'PREPARING' } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'DELIVERY_REVISION_CONFLICT' }, snapshot: { revision: 5 } });
    expect(next).not.toHaveBeenCalled();
    expect(timing('delivery.update.timing')).toEqual([expect.objectContaining({ outcome: 'DELIVERY_REVISION_CONFLICT', revisionConflict: true, status: 409 })]);
  });

  it('a validation failure is a safe 400 that does not echo the input, and is classified', async () => {
    const { next } = await call(updateAdminDelivery, { body: { expectedRevision: 1, location: { latitude: 999, longitude: 1, label: 'Private place' } } });
    const error = next.mock.calls[0]![0] as { statusCode: number; code: string; message: string };
    expect(error).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(error.message).not.toContain('999');
    expect(service.applyUpdate).not.toHaveBeenCalled();
    expect(timing('delivery.update.timing')[0]).toMatchObject({ outcome: 'VALIDATION_ERROR', status: 400 });
    expect(JSON.stringify(vi.mocked(logSafely).mock.calls)).not.toContain('Private place');
  });

  it('an unexpected failure still reaches the error handler unchanged and is classified UNEXPECTED', async () => {
    const failure = new Error('database exploded at 33.1,35.5');
    service.getCustomerSnapshot.mockRejectedValue(failure);
    const { next } = await call(getCustomerDelivery);
    expect(next).toHaveBeenCalledWith(failure);
    const [event] = timing('delivery.customer_read.timing');
    expect(event).toMatchObject({ outcome: 'UNEXPECTED', status: 500 });
    expect(JSON.stringify(event)).not.toContain('database exploded');
  });

  it('a logging failure cannot alter the API result', async () => {
    service.getCustomerSnapshot.mockResolvedValue({ status: 'CONFIRMED' });
    vi.mocked(logSafely).mockImplementation(() => { throw new Error('log sink down'); });
    const { res, next } = await call(getCustomerDelivery);
    expect(res.body).toEqual({ data: { status: 'CONFIRMED' } });
    expect(next).not.toHaveBeenCalled();
    vi.mocked(logSafely).mockReset();
  });
});
