import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { DeliveryPublisher, toPublishChanges } from '../../sockets/delivery.publisher.js';
import { realtimeMetrics } from '../../sockets/realtime-metrics.js';
import { logSafely } from '../../utils/logger.js';
import { DeliveryRevisionConflict, DeliveryService } from '../delivery.service.js';
import { parseOrderReference } from '../order.service.js';
import { deliveryOrigin } from '../../config/delivery-map.config.js';
import { SIMULATION_MAX_TICKS, SIMULATION_ROUTES, SIMULATION_TICK_MS, simulationAvailability, type SimulationAvailability } from './simulation.config.js';

/**
 * Task 04.7 in-process demo runner (architecture §8.5). Every tick goes through DeliveryService.applyUpdate with source SIMULATION (same
 * validation, row lock, revision and single-event transaction as an admin), then publishes after commit. It only ever writes a location:
 * never status, payment, Stripe or order data. One runner per delivery; ticks are at least 5 s apart; at most 240 ticks.
 */
const STOP_CODES = new Set(['DELIVERY_TERMINAL', 'DELIVERY_ORDER_CANCELLED', 'DELIVERY_LOCATION_NOT_ALLOWED', 'DELIVERY_PAYMENT_INELIGIBLE', 'ORDER_NOT_FOUND']);
type Runner = { orderId: string; reference: string; actorUserId: string; routeId: string; index: number; ticks: number; timer: NodeJS.Timeout | null; busy: boolean };
export type SimulationStatus = { enabled: boolean; running: boolean; routeId: string | null; ticks: number; maxTicks: number; tickSeconds: number;
  routes: { id: string; label: string; points: number }[] };

export class DeliverySimulationRunner {
  private readonly runners = new Map<string, Runner>();

  constructor(private readonly service = new DeliveryService(), private readonly availability: () => SimulationAvailability = simulationAvailability,
    private readonly tickMs = SIMULATION_TICK_MS, private readonly autoTick = true) {
    // The 5 s floor is not configurable downward; tests drive ticks explicitly instead.
    if (tickMs < SIMULATION_TICK_MS) throw new Error('Simulation ticks must be at least 5 seconds apart.');
  }

  private assertEnabled() {
    if (!this.availability().enabled) throw new AppError('The delivery demo simulation is not available in this environment.', 409, 'DELIVERY_SIMULATION_DISABLED');
  }

  status(reference: string): SimulationStatus {
    const runner = this.runners.get(parseOrderReference(reference));
    return { enabled: this.availability().enabled, running: Boolean(runner), routeId: runner?.routeId ?? null, ticks: runner?.ticks ?? 0,
      maxTicks: SIMULATION_MAX_TICKS, tickSeconds: this.tickMs / 1000,
      routes: [...SIMULATION_ROUTES.values()].map(route => ({ id: route.id, label: route.label, points: route.offsets.length })) };
  }

  async start(actorUserId: string, reference: string, routeId: string): Promise<SimulationStatus> {
    this.assertEnabled();
    const route = SIMULATION_ROUTES.get(routeId);
    if (!route) throw new AppError('Choose an approved demo route.', 400, 'VALIDATION_ERROR');
    // Routes are offsets from the hub; without a configured hub there is nowhere truthful to play them.
    if (!deliveryOrigin()) throw new AppError('Configure the delivery hub before running the demo simulation.', 409, 'DELIVERY_SIMULATION_DISABLED');
    const orderId = parseOrderReference(reference);
    if (this.runners.has(orderId)) throw new AppError('A demo simulation is already running for this delivery.', 409, 'DELIVERY_SIMULATION_RUNNING');
    // Reserve before the first await so two concurrent starts cannot both win.
    const runner: Runner = { orderId, reference, actorUserId, routeId, index: 0, ticks: 0, timer: null, busy: false };
    this.runners.set(orderId, runner);
    try { await this.service.recordSimulation(actorUserId, reference, 'STARTED'); }
    catch (error) { this.runners.delete(orderId); throw error; }
    realtimeMetrics.set('simulation_runners', this.runners.size);
    logSafely('info', 'Delivery simulation started', { event: 'delivery.simulation.started', routeId });
    void DeliveryPublisher.afterCommit(orderId, ['simulation']);
    this.schedule(runner);
    return this.status(reference);
  }

  async stop(reference: string, reason: 'ADMIN' | 'ROUTE_END' | 'MAX_TICKS' | 'TERMINAL' = 'ADMIN'): Promise<SimulationStatus> {
    const orderId = parseOrderReference(reference);
    const runner = this.runners.get(orderId);
    // Idempotent: stopping a delivery with no runner (already stopped, finished or never started) is a successful no-op.
    if (runner) await this.finish(runner, reason);
    return this.status(reference);
  }

  /** One tick; the timer calls it, and tests call it directly instead of waiting 5 s. Returns false once the runner has stopped. */
  async tick(reference: string): Promise<boolean> {
    const runner = this.runners.get(parseOrderReference(reference));
    if (!runner || runner.busy) return Boolean(runner);
    runner.busy = true;
    try {
      const route = SIMULATION_ROUTES.get(runner.routeId)!;
      const origin = deliveryOrigin();
      if (!origin || runner.index >= route.offsets.length) { await this.finish(runner, 'ROUTE_END'); return false; }
      if (runner.ticks >= SIMULATION_MAX_TICKS) { await this.finish(runner, 'MAX_TICKS'); return false; }
      // Every attempt counts, including failed ones, so a database outage cannot keep a runner ticking past the 240-tick bound.
      runner.ticks++;
      const [dLat, dLng] = route.offsets[runner.index];
      const latitude = Math.round((origin.latitude + dLat) * 1e6) / 1e6, longitude = Math.round((origin.longitude + dLng) * 1e6) / 1e6;
      const current = await prisma.delivery.findUnique({ where: { orderId: runner.orderId }, select: { revision: true } });
      if (!current) { await this.finish(runner, 'TERMINAL'); return false; }
      try {
        const { changed, changes } = await this.service.applyUpdate(runner.actorUserId, runner.reference,
          { expectedRevision: current.revision, location: { latitude, longitude, label: null } }, 'SIMULATION');
        runner.index++;
        realtimeMetrics.increment('simulation_ticks');
        if (changed) void DeliveryPublisher.afterCommit(runner.orderId, toPublishChanges(changes));
      } catch (error) {
        // An admin edit between the read and the write: skip this tick, the next one re-reads the revision.
        if (error instanceof DeliveryRevisionConflict) return true;
        if (error instanceof AppError && STOP_CODES.has(error.code)) { await this.finish(runner, 'TERMINAL'); return false; }
        throw error;
      }
      return true;
    } catch (error) {
      realtimeMetrics.increment('simulation_failed');
      logSafely('warn', 'Delivery simulation tick failed', { event: 'delivery.simulation.tick_failed', errorName: error instanceof Error ? error.name : 'Unknown' });
      return true;
    } finally {
      runner.busy = false;
    }
  }

  /** Process shutdown: timers stop; boot recovery records the stop marker next time. */
  stopAll() {
    for (const runner of this.runners.values()) if (runner.timer) clearTimeout(runner.timer);
    this.runners.clear();
    realtimeMetrics.set('simulation_runners', 0);
  }

  /** Boot: an out-for-delivery simulated delivery whose last marker is STARTED has no runner any more, so it gets a SYSTEM stop marker. */
  async recoverOrphans(): Promise<number> {
    if (!this.availability().enabled) return 0;
    const candidates = await prisma.delivery.findMany({ where: { isSimulated: true, status: 'OUT_FOR_DELIVERY' }, select: { orderId: true,
      events: { where: { type: { in: ['SIMULATION_STARTED', 'SIMULATION_STOPPED'] } }, orderBy: { revision: 'desc' }, take: 1, select: { type: true } } } });
    let recovered = 0;
    for (const delivery of candidates) {
      if (delivery.events[0]?.type !== 'SIMULATION_STARTED' || this.runners.has(delivery.orderId)) continue;
      try { if (await this.service.recordSimulation(null, `ORD-${delivery.orderId.toUpperCase()}`, 'STOPPED') !== null) recovered++; }
      catch { realtimeMetrics.increment('simulation_failed'); }
    }
    return recovered;
  }

  private schedule(runner: Runner) {
    if (!this.autoTick) return;
    runner.timer = setTimeout(async () => {
      runner.timer = null;
      if (await this.tick(runner.reference) && this.runners.get(runner.orderId) === runner) this.schedule(runner);
    }, this.tickMs);
    runner.timer.unref();
  }

  private async finish(runner: Runner, reason: string) {
    if (this.runners.get(runner.orderId) !== runner) return;
    if (runner.timer) clearTimeout(runner.timer);
    this.runners.delete(runner.orderId);
    realtimeMetrics.set('simulation_runners', this.runners.size);
    logSafely('info', 'Delivery simulation stopped', { event: 'delivery.simulation.stopped', reason, ticks: runner.ticks });
    try {
      if (await this.service.recordSimulation(runner.actorUserId, runner.reference, 'STOPPED') !== null) void DeliveryPublisher.afterCommit(runner.orderId, ['simulation']);
    } catch { realtimeMetrics.increment('simulation_failed'); }
  }
}

export const deliverySimulation = new DeliverySimulationRunner();
