/**
 * Task 04.7 runner bounds (U): the tick cap holds even while every revision read fails, and Stop is idempotent. The service, database and
 * publisher are stubbed; the disposable-PostgreSQL suite covers the real transaction path.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn(), order: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { delivery: { findUnique: db.findUnique, findMany: db.findMany }, order: { findUnique: db.order } } }));
vi.mock('../../config/delivery-map.config.js', () => ({ deliveryOrigin: () => ({ latitude: 34, longitude: -118, label: 'Demo hub' }) }));
vi.mock('../../sockets/delivery.publisher.js', () => ({ DeliveryPublisher: { afterCommit: vi.fn() }, toPublishChanges: () => [] }));

import { DeliverySimulationRunner } from './delivery-simulation.runner.js';
import { SIMULATION_MAX_TICKS, SIMULATION_ROUTES } from './simulation.config.js';
import type { DeliveryService } from '../delivery.service.js';
import { activateDeliveryQaRuntime, deactivateDeliveryQaRuntime } from '../../delivery-qa-runtime.config.js';

const reference = `ORD-${randomUUID().toUpperCase()}`;
const routeId = [...SIMULATION_ROUTES.keys()][0];

function runner() {
  const service = { recordSimulation: vi.fn().mockResolvedValue(2), applyUpdate: vi.fn() };
  const simulation = new DeliverySimulationRunner(service as unknown as DeliveryService, () => ({ enabled: true }), 5_000, false);
  return { service, simulation };
}

describe('DeliverySimulationRunner bounds', () => {
  afterEach(() => { deactivateDeliveryQaRuntime(); vi.unstubAllEnvs(); });
  it('shared DEV checks the allowlist and persisted unpaid fixture and never scans unrelated orphans', async () => {
    const id = reference.slice(4).toLowerCase();
    const url = 'postgresql://postgres.pzxekjybdiulzmssalfo:x@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';
    const runId = 'QA-DELIVERY-20261101-abcd';
    for (const [name, value] of Object.entries({ NODE_ENV: 'development', DATABASE_URL: url, DIRECT_URL: url,
      DELIVERY_SIMULATION_ENABLED: 'true', DELIVERY_SHARED_DEV_QA: 'true', DELIVERY_SHARED_DEV_SIMULATION: 'true',
      STRIPE_SECRET_KEY: '', BREVO_API_KEY: '', COMMERCE_EMAIL_ENQUEUE_ENABLED: 'false', COMMERCE_EMAIL_DISPATCH_ENABLED: 'false', COMMERCE_EMAIL_SEND_MODE: 'disabled',
      DELIVERY_QA_RUN_ID: runId, DELIVERY_QA_ORDER_IDS: id, DELIVERY_QA_CUSTOMER_USER_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', DELIVERY_QA_PRODUCT_ID: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })) vi.stubEnv(name, value);
    activateDeliveryQaRuntime();
    const { simulation, service } = runner();
    db.order.mockResolvedValue({ shippingRecipient: runId, shippingLine1: runId, userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', total: { isZero: () => true }, payment: null,
      paymentAttempt: null, items: [{ product: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', isTestFixture: true } }] });
    await expect(simulation.start(randomUUID(), `ORD-${randomUUID().toUpperCase()}`, routeId)).rejects.toMatchObject({ code: 'DELIVERY_SIMULATION_DISABLED' });
    db.order.mockResolvedValueOnce({ shippingRecipient: runId, shippingLine1: runId, userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', total: { isZero: () => true }, payment: { id: randomUUID() },
      paymentAttempt: null, items: [{ product: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', isTestFixture: true } }] });
    await expect(simulation.start(randomUUID(), reference, routeId)).rejects.toMatchObject({ code: 'DELIVERY_SIMULATION_DISABLED' });
    await expect(simulation.start(randomUUID(), reference, routeId)).resolves.toMatchObject({ running: true });
    db.findMany.mockClear();
    await expect(simulation.recoverOrphans()).resolves.toBe(0);
    expect(db.findMany).not.toHaveBeenCalled();
    await simulation.stop(reference);
    expect(service.recordSimulation).toHaveBeenCalledTimes(2);
  });
  it('after a restart mid-run, DEV-wide recovery records STOPPED only for simulated deliveries whose latest marker is STARTED', async () => {
    const allowed = randomUUID(), settled = randomUUID();
    const url = 'postgresql://postgres.pzxekjybdiulzmssalfo:x@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';
    for (const [name, value] of Object.entries({ NODE_ENV: 'development', DATABASE_URL: url, DIRECT_URL: url, DELIVERY_SIMULATION_ENABLED: 'true', DELIVERY_DEV_DEMO: 'true',
      DELIVERY_DEV_DEMO_RUN_ID: 'QA-DELIVERY-20261101-abcd', DELIVERY_DEV_DEMO_ORDER_IDS: `${allowed},${settled}`,
      DELIVERY_DEV_DEMO_CUSTOMER_USER_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', DELIVERY_DEV_DEMO_PRODUCT_ID: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })) vi.stubEnv(name, value);
    db.findMany.mockResolvedValue([{ orderId: allowed, events: [{ type: 'SIMULATION_STARTED' }] }, { orderId: settled, events: [{ type: 'SIMULATION_STOPPED' }] }]);
    const { service, simulation } = runner();
    await expect(simulation.recoverOrphans()).resolves.toBe(1);
    expect(db.findMany.mock.calls.at(-1)?.[0].where).toEqual({ isSimulated: true, status: 'OUT_FOR_DELIVERY' });
    expect(service.recordSimulation).toHaveBeenCalledTimes(1);
    expect(service.recordSimulation).toHaveBeenCalledWith(null, `ORD-${allowed.toUpperCase()}`, 'STOPPED');
    // A fresh runner after the "restart" holds no timers, so the order can be started again.
    expect(simulation.status(`ORD-${allowed.toUpperCase()}`).running).toBe(false);
  });
  it('DEV-wide: any order id starts with no allowlist or fixture lookup, and the specific ineligibility reason is reported per order', async () => {
    const url = 'postgresql://postgres.pzxekjybdiulzmssalfo:x@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';
    for (const [name, value] of Object.entries({ NODE_ENV: 'development', DATABASE_URL: url, DIRECT_URL: url, DELIVERY_SIMULATION_ENABLED: 'true', DELIVERY_DEV_DEMO: 'true' })) vi.stubEnv(name, value);
    db.order.mockClear();
    const { service, simulation } = runner();
    const eligibility = vi.fn().mockResolvedValue(null);
    Object.assign(service, { simulationEligibility: eligibility });
    const first = `ORD-${randomUUID().toUpperCase()}`, second = `ORD-${randomUUID().toUpperCase()}`;
    await expect(simulation.statusFor(first)).resolves.toMatchObject({ enabled: true, reason: null });
    await expect(simulation.start(randomUUID(), first, routeId)).resolves.toMatchObject({ running: true });
    await expect(simulation.start(randomUUID(), second, routeId)).resolves.toMatchObject({ running: true });
    expect(db.order).not.toHaveBeenCalled();
    // Running deliveries stay stoppable even when eligibility would now fail.
    eligibility.mockResolvedValue('NOT_OUT_FOR_DELIVERY');
    await expect(simulation.statusFor(first)).resolves.toMatchObject({ enabled: true, running: true });
    await simulation.stop(first); await simulation.stop(second);
    for (const reason of ['PAYMENT_INELIGIBLE', 'NOT_OUT_FOR_DELIVERY', 'ORDER_CANCELLED', 'DELIVERY_NOT_STARTED', 'ORDER_NOT_FOUND']) {
      eligibility.mockResolvedValue(reason);
      await expect(simulation.statusFor(first)).resolves.toMatchObject({ enabled: false, reason });
    }
  });
  it('without the opt-in nothing is enabled, whatever the order', async () => {
    const url = 'postgresql://postgres.pzxekjybdiulzmssalfo:x@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';
    for (const [name, value] of Object.entries({ NODE_ENV: 'development', DATABASE_URL: url, DIRECT_URL: url, DELIVERY_SIMULATION_ENABLED: 'true', DELIVERY_DEV_DEMO: '' })) vi.stubEnv(name, value);
    const simulation = new DeliverySimulationRunner({ simulationEligibility: vi.fn() } as unknown as DeliveryService, undefined, 5_000, false);
    await expect(simulation.statusFor(reference)).resolves.toMatchObject({ enabled: false, reason: 'FEATURE_DISABLED' });
    await expect(simulation.start(randomUUID(), reference, routeId)).rejects.toMatchObject({ code: 'DELIVERY_SIMULATION_DISABLED' });
  });
  it('stops at the tick cap even when every revision read fails', async () => {
    db.findUnique.mockRejectedValue(new Error('database unavailable'));
    const { service, simulation } = runner();
    await simulation.start(randomUUID(), reference, routeId);
    let attempts = 0;
    while (await simulation.tick(reference)) { attempts++; if (attempts > SIMULATION_MAX_TICKS + 5) break; }
    expect(attempts).toBe(SIMULATION_MAX_TICKS);
    expect(simulation.status(reference).running).toBe(false);
    expect(service.applyUpdate).not.toHaveBeenCalled();
  });

  it('Stop is idempotent: a second stop, or a stop with no runner, succeeds without writing', async () => {
    const { service, simulation } = runner();
    await simulation.start(randomUUID(), reference, routeId);
    await expect(simulation.stop(reference)).resolves.toMatchObject({ running: false });
    await expect(simulation.stop(reference)).resolves.toMatchObject({ running: false });
    expect(service.recordSimulation.mock.calls.map(call => call[2])).toEqual(['STARTED', 'STOPPED']);
  });

  /** A tick whose applyUpdate is held open until the test releases it. */
  function heldTick() {
    db.findUnique.mockResolvedValue({ revision: 3 });
    const made = runner();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const order: string[] = [];
    made.service.applyUpdate.mockImplementation(async () => { order.push('update-start'); await held; order.push('update-commit'); return { changed: true, changes: [] }; });
    made.service.recordSimulation.mockImplementation(async (_actor: unknown, _ref: unknown, marker: string) => { order.push(marker); return 2; });
    return { ...made, release, order };
  }

  it('A1: Stop waits for an in-flight tick, so no location commits after STOPPED and no tick follows', async () => {
    const { service, simulation, release, order } = heldTick();
    await simulation.start(randomUUID(), reference, routeId);
    const tick = simulation.tick(reference);
    await vi.waitFor(() => expect(service.applyUpdate).toHaveBeenCalledTimes(1));
    let stopped = false;
    const stop = simulation.stop(reference).then(result => { stopped = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    release();
    await tick;
    await expect(stop).resolves.toMatchObject({ running: false });
    expect(order).toEqual(['STARTED', 'update-start', 'update-commit', 'STOPPED']);
    await expect(simulation.tick(reference)).resolves.toBe(false);
    expect(service.applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('A1b: a tick that has not reached the write when Stop begins is cancelled before writing', async () => {
    db.findUnique.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ revision: 3 }), 10)));
    const { service, simulation } = runner();
    await simulation.start(randomUUID(), reference, routeId);
    const tick = simulation.tick(reference);
    await simulation.stop(reference);
    await expect(tick).resolves.toBe(false);
    expect(service.applyUpdate).not.toHaveBeenCalled();
  });

  it('A2: concurrent Stop calls record a single STOPPED marker', async () => {
    const { service, simulation, release } = heldTick();
    await simulation.start(randomUUID(), reference, routeId);
    const tick = simulation.tick(reference);
    await vi.waitFor(() => expect(service.applyUpdate).toHaveBeenCalledTimes(1));
    const stops = Promise.all([simulation.stop(reference), simulation.stop(reference), simulation.stop(reference)]);
    release();
    await tick;
    await stops;
    expect(service.recordSimulation.mock.calls.map(call => call[2])).toEqual(['STARTED', 'STOPPED']);
  });

  it('A3: a tick that fails during Stop does not block Stop or leave a timer', async () => {
    db.findUnique.mockResolvedValue({ revision: 3 });
    const { service, simulation } = runner();
    let fail!: (error: Error) => void;
    service.applyUpdate.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    await simulation.start(randomUUID(), reference, routeId);
    const tick = simulation.tick(reference);
    await vi.waitFor(() => expect(service.applyUpdate).toHaveBeenCalledTimes(1));
    const stop = simulation.stop(reference);
    fail(new Error('database unavailable'));
    await expect(tick).resolves.toBe(true);
    await expect(stop).resolves.toMatchObject({ running: false });
    expect(service.recordSimulation.mock.calls.map(call => call[2])).toEqual(['STARTED', 'STOPPED']);
  });

  it('stopAll prevents an accepted tick from writing', async () => {
    db.findUnique.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ revision: 3 }), 10)));
    const { service, simulation } = runner();
    await simulation.start(randomUUID(), reference, routeId);
    const tick = simulation.tick(reference);
    simulation.stopAll();
    await tick;
    expect(service.applyUpdate).not.toHaveBeenCalled();
  });
});
