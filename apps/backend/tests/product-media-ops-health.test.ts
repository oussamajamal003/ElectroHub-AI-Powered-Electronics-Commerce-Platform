import { describe, expect, it } from 'vitest';
import { classifyMediaWorkers, summarizeMediaQueue, type MediaWorkerHeartbeatRow } from '../scripts/product-media-ops-health.js';

function heartbeat(overrides: Partial<MediaWorkerHeartbeatRow> = {}): MediaWorkerHeartbeatRow {
  return {
    workerId: 'worker-1', environment: 'qa', state: 'READY', heartbeatAt: new Date('2026-10-28T12:00:00Z'),
    heartbeatAgeSeconds: 10, activeModelVersion: 'd3-v1', currentEventId: null,
    processedSuccessCount: '3', processedFailureCount: '1', lastErrorCode: 'SOURCE_UNAVAILABLE', ...overrides,
  };
}

describe('product media worker status', () => {
  it('reports an idle live worker and preserves its operational metrics', () => {
    expect(classifyMediaWorkers([heartbeat()])).toMatchObject({
      workerStatus: 'READY',
      workers: [{ state: 'READY', heartbeatAgeSeconds: 10, activeModelVersion: 'd3-v1',
        processedSuccessCount: 3, processedFailureCount: 1, lastErrorCode: 'SOURCE_UNAVAILABLE' }],
    });
  });

  it('reports processing and marks heartbeats stale after the bounded threshold', () => {
    expect(classifyMediaWorkers([heartbeat({ state: 'PROCESSING', currentEventId: 'event-1' })]).workerStatus).toBe('PROCESSING');
    expect(classifyMediaWorkers([heartbeat({ heartbeatAgeSeconds: 61 })])).toMatchObject({
      workerStatus: 'STALE', workers: [{ state: 'STALE', heartbeatAgeSeconds: 61 }],
    });
  });

  it('distinguishes restart from crash and stopped or unavailable workers', () => {
    const restarted = classifyMediaWorkers([
      heartbeat({ workerId: 'old-worker', heartbeatAgeSeconds: 120 }),
      heartbeat({ workerId: 'new-worker', state: 'READY', heartbeatAgeSeconds: 1 }),
    ]);
    expect(restarted.workerStatus).toBe('READY');
    expect(restarted.workers.map(row => row.state)).toEqual(['STALE', 'READY']);
    expect(classifyMediaWorkers([heartbeat({ state: 'STOPPED' })]).workerStatus).toBe('STOPPED');
    expect(classifyMediaWorkers([]).workerStatus).toBe('UNAVAILABLE');
    expect(classifyMediaWorkers([heartbeat({ state: 'FAILED' })]).workerStatus).toBe('FAILED');
  });
});

describe('product media queue status', () => {
  it('reports an empty queue separately from a live worker', () => {
    expect(summarizeMediaQueue([], null)).toMatchObject({ pendingCount: 0, retryWaitCount: 0,
      permanentFailureCount: 0, oldestPendingSeconds: null, indexingStatus: 'QUEUE_EMPTY' });
  });

  it('reports pending backlog and accumulating indexing failures', () => {
    expect(summarizeMediaQueue([{ state: 'READY', count: 2 }, { state: 'RETRY_WAIT', count: 1 }], 40)).toMatchObject({
      pendingCount: 3, retryWaitCount: 1, oldestPendingSeconds: 40, indexingStatus: 'INDEXING_FAILURES',
    });
    expect(summarizeMediaQueue([{ state: 'READY', count: 2 }], 40).indexingStatus).toBe('BACKLOG_PENDING');
    expect(summarizeMediaQueue([{ state: 'PERMANENT_FAILURE', count: 1 }], null).indexingStatus).toBe('INDEXING_FAILURES');
  });
});
