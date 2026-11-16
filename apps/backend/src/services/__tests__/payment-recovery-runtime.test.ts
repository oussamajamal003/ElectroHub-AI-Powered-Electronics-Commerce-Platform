import { expect, it } from 'vitest';
import { createRecoveryRuntime } from '../../payment-recovery-runtime.js';

it('does not report a missing, starting, failed or stale local runner as healthy', () => {
  let now = 1_000; const runtime = createRecoveryRuntime(() => now);
  expect(runtime.snapshot()).toMatchObject({ phase: 'stopped', healthy: false, lastProgressAt: null });
  runtime.update('starting'); expect(runtime.snapshot().healthy).toBe(false);
  runtime.update('ready'); expect(runtime.snapshot().healthy).toBe(true);
  runtime.update('processing'); expect(runtime.snapshot().healthy).toBe(true);
  now += 120_001; expect(runtime.snapshot().healthy).toBe(false);
  runtime.update('degraded'); expect(runtime.snapshot().healthy).toBe(false);
  runtime.update('ready'); expect(runtime.snapshot().healthy).toBe(true);
  runtime.update('stopped'); expect(runtime.snapshot().healthy).toBe(false);
});
