export const WORKER_HEARTBEAT_STALE_AFTER_SECONDS = 60;

const ACTIVE_WORKER_STATES = new Set(['STARTING', 'READY', 'PROCESSING', 'STOPPING']);

export interface MediaWorkerHeartbeatRow {
  workerId: string;
  environment: string;
  state: string;
  heartbeatAt: Date;
  heartbeatAgeSeconds: number;
  activeModelVersion: string | null;
  currentEventId: string | null;
  processedSuccessCount: string;
  processedFailureCount: string;
  lastErrorCode: string | null;
}

export function classifyMediaWorkers(heartbeatRows: MediaWorkerHeartbeatRow[]) {
  const workers = heartbeatRows.map(row => {
    const heartbeatAgeSeconds = Number(row.heartbeatAgeSeconds);
    const stale = ACTIVE_WORKER_STATES.has(row.state) && heartbeatAgeSeconds > WORKER_HEARTBEAT_STALE_AFTER_SECONDS;
    return {
      workerId: row.workerId,
      environment: row.environment,
      state: stale ? 'STALE' : row.state,
      lastHeartbeat: row.heartbeatAt.toISOString(),
      heartbeatAgeSeconds,
      activeModelVersion: row.activeModelVersion,
      currentEventId: row.currentEventId,
      processedSuccessCount: Number(row.processedSuccessCount),
      processedFailureCount: Number(row.processedFailureCount),
      lastErrorCode: row.lastErrorCode,
    };
  });
  const liveWorkers = workers.filter(worker => ACTIVE_WORKER_STATES.has(worker.state)
    && worker.heartbeatAgeSeconds <= WORKER_HEARTBEAT_STALE_AFTER_SECONDS);
  const workerStatus = liveWorkers.some(worker => worker.state === 'PROCESSING') ? 'PROCESSING'
    : liveWorkers.some(worker => worker.state === 'READY') ? 'READY'
      : liveWorkers.some(worker => worker.state === 'STOPPING') ? 'STOPPING'
        : liveWorkers.some(worker => worker.state === 'STARTING') ? 'STARTING'
          : workers.some(worker => worker.state === 'STALE') ? 'STALE'
            : workers.some(worker => worker.state === 'FAILED') ? 'FAILED'
              : workers.some(worker => worker.state === 'STOPPED') ? 'STOPPED' : 'UNAVAILABLE';
  return { workerStatus, workers };
}

export function summarizeMediaQueue(counts: Array<{ state: string; count: number }>, oldestPendingSeconds: number | null) {
  const countByState = Object.fromEntries(counts.map(row => [row.state, row.count]));
  const pendingCount = Number(countByState.READY ?? 0) + Number(countByState.CLAIMED ?? 0) + Number(countByState.RETRY_WAIT ?? 0);
  const retryWaitCount = Number(countByState.RETRY_WAIT ?? 0);
  const permanentFailureCount = Number(countByState.PERMANENT_FAILURE ?? 0);
  const indexingStatus = retryWaitCount > 0 || permanentFailureCount > 0 ? 'INDEXING_FAILURES'
    : pendingCount > 0 ? 'BACKLOG_PENDING' : 'QUEUE_EMPTY';
  return {
    pendingCount,
    retryWaitCount,
    permanentFailureCount,
    oldestPendingSeconds,
    indexingStatus,
    counts,
  };
}
