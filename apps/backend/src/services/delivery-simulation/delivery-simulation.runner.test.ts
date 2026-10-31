/**
 * Task 04.7 runner bounds (U): the tick cap holds even while every revision read fails, and Stop is idempotent. The service, database and
 * publisher are stubbed; the disposable-PostgreSQL suite covers the real transaction path.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { delivery: { findUnique: db.findUnique } } }));
vi.mock('../../config/delivery-map.config.js', () => ({ deliveryOrigin: () => ({ latitude: 34, longitude: -118, label: 'Demo hub' }) }));
vi.mock('../../sockets/delivery.publisher.js', () => ({ DeliveryPublisher: { afterCommit: vi.fn() }, toPublishChanges: () => [] }));

import { DeliverySimulationRunner } from './delivery-simulation.runner.js';
import { SIMULATION_MAX_TICKS, SIMULATION_ROUTES } from './simulation.config.js';
import type { DeliveryService } from '../delivery.service.js';

const reference = `ORD-${randomUUID().toUpperCase()}`;
const routeId = [...SIMULATION_ROUTES.keys()][0];

function runner() {
  const service = { recordSimulation: vi.fn().mockResolvedValue(2), applyUpdate: vi.fn() };
  const simulation = new DeliverySimulationRunner(service as unknown as DeliveryService, () => ({ enabled: true }), 5_000, false);
  return { service, simulation };
}

describe('DeliverySimulationRunner bounds', () => {
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
