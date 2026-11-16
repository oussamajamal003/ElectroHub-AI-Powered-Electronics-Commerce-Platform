import { describe, expect, it, vi } from 'vitest';
import { runRecoveryLoop } from '../../payment-recovery-loop.js';

function harness() {
  let stopped = false; let time = 0;
  return {
    ready: vi.fn().mockResolvedValue(undefined), batch: vi.fn().mockResolvedValue(0),
    attention: vi.fn().mockResolvedValue([]), report: vi.fn(),
    stopping: () => stopped, stop: () => { stopped = true; },
    wait: vi.fn(async (ms: number) => { time += ms; }), now: () => time, once: false,
  };
}
describe('Payment runner recovery orchestration', () => {
  it('never selects new work if shutdown arrives during database readiness', async () => {
    const deps = harness(); deps.ready.mockImplementation(async () => { deps.stop(); });
    await runRecoveryLoop(deps);
    expect(deps.batch).not.toHaveBeenCalled();
    expect(deps.wait).not.toHaveBeenCalled();
  });
  it('survives initial database unavailability and resumes durable work without a browser', async () => {
    const deps = harness(); deps.ready.mockRejectedValueOnce(new Error('database offline'));
    deps.batch.mockImplementation(async () => { deps.stop(); return 1; });
    await runRecoveryLoop(deps);
    expect(deps.ready).toHaveBeenCalledTimes(2); expect(deps.batch).toHaveBeenCalledTimes(1);
    expect(deps.wait).toHaveBeenCalledWith(2000);
    expect(deps.report).toHaveBeenCalledWith('info', 'payment.runner.ready', {});
  });
  it('bounds infrastructure retry backoff and escalates without discarding pending work', async () => {
    const deps = harness(); deps.ready.mockRejectedValue(new Error('offline'));
    deps.wait.mockImplementation(async () => { if (deps.wait.mock.calls.length === 8) deps.stop(); });
    await runRecoveryLoop(deps);
    expect(deps.batch).not.toHaveBeenCalled();
    expect(deps.wait.mock.calls.every(([ms]) => ms <= 30_000)).toBe(true);
    expect(deps.report).toHaveBeenCalledWith('error', 'payment.recovery.escalation', expect.objectContaining({ reason: 'RUNNER_UNAVAILABLE' }));
  });
  it('continues after a failed batch and exposes overdue/incident work independently', async () => {
    const deps = harness(); deps.batch.mockRejectedValueOnce(new Error('one job unavailable'));
    deps.batch.mockImplementationOnce(async () => { throw new Error('one job unavailable'); });
    deps.batch.mockImplementationOnce(async () => { deps.stop(); return 1; });
    deps.attention.mockResolvedValue([{ attemptId: 'opaque-id', state: 'INCIDENT', retryCount: 12, leaseExpired: false }]);
    await runRecoveryLoop(deps);
    expect(deps.batch).toHaveBeenCalledTimes(3);
    expect(deps.attention).toHaveBeenCalledTimes(1);
    expect(deps.report).toHaveBeenCalledWith('error', 'payment.recovery.escalation', expect.objectContaining({
      reason: 'PAYMENT_REQUIRES_ATTENTION', attempts: [{ attemptId: 'opaque-id', state: 'INCIDENT', retryCount: 12, leaseExpired: false }],
    }));
  });
  it('escalates monitor failures without stopping payment work', async () => {
    const deps = harness(); deps.once = true; deps.attention.mockRejectedValue(new Error('monitor offline'));
    await runRecoveryLoop(deps);
    expect(deps.batch).toHaveBeenCalledTimes(1);
    expect(deps.report).toHaveBeenCalledWith('error', 'payment.recovery.escalation', expect.objectContaining({ reason: 'RECOVERY_MONITOR_UNAVAILABLE' }));
  });
  it('does not report readiness or success for a failed one-shot run', async () => {
    const deps = harness(); deps.once = true; deps.ready.mockRejectedValue(new Error('offline'));
    await expect(runRecoveryLoop(deps)).rejects.toThrow('offline');
    expect(deps.batch).not.toHaveBeenCalled(); expect(deps.wait).not.toHaveBeenCalled();
  });
  it('rechecks operator attention once per minute rather than each batch', async () => {
    const deps = harness(); deps.batch.mockImplementation(async () => {
      if (deps.batch.mock.calls.length === 14) deps.stop(); return 0;
    });
    await runRecoveryLoop(deps);
    expect(deps.attention).toHaveBeenCalledTimes(2);
  });
});

describe('Payment runner backlog draining', () => {
  it('takes the next batch immediately while batches are full and idles only once the backlog is drained', async () => {
    const deps = harness(); const sizes = [10, 10, 4]; let call = 0;
    deps.batch.mockImplementation(async () => { const size = sizes[call++] ?? 0; if (call === sizes.length) deps.stop(); return size; });
    await runRecoveryLoop(deps);
    expect(deps.batch).toHaveBeenCalledTimes(3);
    expect(deps.wait).not.toHaveBeenCalled(); // the loop ended on the stop flag right after the last, partial batch
  });
  it('waits the normal interval after a partial batch and never spins on failures', async () => {
    const deps = harness(); let call = 0;
    deps.batch.mockImplementation(async () => { call++; if (call === 2) deps.stop(); return call === 1 ? 3 : 10; });
    await runRecoveryLoop(deps);
    expect(deps.wait).toHaveBeenCalledTimes(1); expect(deps.wait).toHaveBeenCalledWith(5_000);
    const failing = harness(); failing.batch.mockRejectedValue(new Error('down'));
    failing.wait.mockImplementation(async () => { if (failing.wait.mock.calls.length === 3) failing.stop(); });
    await runRecoveryLoop(failing);
    expect(failing.wait).toHaveBeenCalledTimes(3); expect(failing.wait.mock.calls.every(([ms]) => ms >= 2_000)).toBe(true);
  });
});
