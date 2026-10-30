import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRecommendationRetentionRunner } from './recommendation-retention-runner.js';

describe('recommendation retention runner', () => {
  afterEach(() => vi.useRealTimers());

  it('runs an immediate sweep, reports only aggregate deletion counts, and drains on stop', async () => {
    const purge = vi.fn().mockResolvedValue({ interactions: 4, recentlyViewed: 2, events: 1 });
    const report = vi.fn();
    const stop = startRecommendationRetentionRunner({ purge, report, intervalMs: 60_000 });
    await stop();
    expect(purge).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('info', 'recommendations.retention.completed', {
      deleted: { interactions: 4, recentlyViewed: 2, events: 1 },
    });
  });

  it('reports sanitized failure metadata and does not reject the runner lifecycle', async () => {
    const purge = vi.fn().mockRejectedValue(new Error('database credentials must not be logged'));
    const report = vi.fn();
    const stop = startRecommendationRetentionRunner({ purge, report, intervalMs: 60_000 });
    await expect(stop()).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith('error', 'recommendations.retention.failed', { errorName: 'Error', consecutiveFailures: 1 });
    expect(JSON.stringify(report.mock.calls)).not.toContain('credentials');
  });

  it('retries after a startup failure with bounded backoff and resets after recovery', async () => {
    vi.useFakeTimers();
    const purge = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({ interactions: 0, recentlyViewed: 0, events: 0 });
    const report = vi.fn();
    const stop = startRecommendationRetentionRunner({ purge, report, intervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(report).toHaveBeenCalledWith('error', 'recommendations.retention.failed', { errorName: 'Error', consecutiveFailures: 1 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(purge).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith('info', 'recommendations.retention.completed', {
      deleted: { interactions: 0, recentlyViewed: 0, events: 0 },
    });
    await stop();
  });
});
