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
});
