import { logger } from './utils/logger.js';

export const RECOMMENDATION_RETENTION_INTERVAL_MS = 60 * 60_000;
export const RECOMMENDATION_RETENTION_RETRY_MS = 60_000;
const MAX_RETRY_MS = 30 * 60_000;

type PurgeResult = { interactions: number; recentlyViewed: number; events: number };
type RunnerDependencies = {
  purge: () => Promise<PurgeResult>;
  report: (level: 'info' | 'error', event: string, fields: Record<string, unknown>) => void;
  intervalMs?: number;
};

/** Runs one immediate bounded sweep and then hourly; overlapping sweeps are coalesced. */
export function startRecommendationRetentionRunner(deps: RunnerDependencies) {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let failures = 0;
  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => { void run(); }, delay);
    timer.unref();
  };
  const run = () => {
    if (stopped || inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const deleted = await deps.purge();
        failures = 0;
        deps.report('info', 'recommendations.retention.completed', { deleted });
      } catch (error) {
        failures++;
        deps.report('error', 'recommendations.retention.failed', {
          errorName: error instanceof Error ? error.name : 'unknown',
          consecutiveFailures: failures,
        });
      }
    })().finally(() => {
      inFlight = null;
      const delay = failures ? Math.min(MAX_RETRY_MS, RECOMMENDATION_RETENTION_RETRY_MS * 2 ** Math.min(failures - 1, 5)) : (deps.intervalMs ?? RECOMMENDATION_RETENTION_INTERVAL_MS);
      schedule(delay);
    });
    return inFlight;
  };
  void run();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await inFlight;
  };
}

export function startOperationalRecommendationRetentionRunner() {
  logger.info('Recommendation retention runner starting.', { event: 'recommendations.retention.started' });
  return startRecommendationRetentionRunner({
    purge: async () => {
      const { recommendationService } = await import('./services/recommendation.service.js');
      return recommendationService.purgeExpired();
    },
    report: (level, event, fields) => logger[level]('Recommendation retention sweep', { event, ...fields }),
  });
}
