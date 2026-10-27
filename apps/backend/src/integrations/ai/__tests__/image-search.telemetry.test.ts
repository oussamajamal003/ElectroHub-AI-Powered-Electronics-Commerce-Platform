import { beforeEach, describe, expect, it, vi } from 'vitest';
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('../../../utils/logger.js', () => ({ logger: log }));
import { getImageSearchLifecycleMetrics, IMAGE_SEARCH_OUTCOMES, recordImageSearchLifecycle, resetImageSearchLifecycleMetricsForTests } from '../image-search.telemetry.js';

beforeEach(() => { vi.resetAllMocks(); resetImageSearchLifecycleMetricsForTests(); });
describe('sanitized image search lifecycle telemetry', () => {
  it('records all fixed outcomes with bounded aggregate counters', () => {
    for (const outcome of IMAGE_SEARCH_OUTCOMES) recordImageSearchLifecycle({ outcome, requestId: 'safe-123', durationMs: 10 });
    expect(Object.keys(getImageSearchLifecycleMetrics())).toHaveLength(IMAGE_SEARCH_OUTCOMES.length);
    expect(Object.values(getImageSearchLifecycleMetrics()).every(value => value === 1)).toBe(true);
    expect(log.info.mock.calls[0]).toEqual(['IMAGE_SEARCH_LIFECYCLE', expect.objectContaining({ operation: 'image_search.lifecycle', requestId: 'safe-123' })]);
  });
  it('drops unknown fields, unsafe correlation/version strings and non-finite measurements', () => {
    const sensitive = 'postgresql://private:password@database/customer-photo.jpg';
    const event = { outcome: 'completed' as const, requestId: sensitive, modelVersion: sensitive, embeddingVersion: sensitive,
      durationMs: Infinity, activeRequests: 10000, filename: 'private.jpg', image: sensitive, token: sensitive, resultCount: 999 };
    recordImageSearchLifecycle(event);
    const output = JSON.stringify(log.info.mock.calls);
    expect(output).not.toContain(sensitive); expect(output).not.toContain('private.jpg'); expect(output).not.toMatch(/filename|token|image"/);
    expect(log.info.mock.calls[0][1]).toMatchObject({ activeRequests: 64, resultCount: 24, requestId: undefined, durationMs: undefined });
  });
  it('supports missing optional metadata and throwing sinks', () => {
    expect(() => recordImageSearchLifecycle({ outcome: 'disconnected' })).not.toThrow();
    log.info.mockImplementation(() => { throw new Error('broken sink'); });
    expect(() => recordImageSearchLifecycle({ outcome: 'completed' })).not.toThrow();
    expect(getImageSearchLifecycleMetrics()).toEqual({ disconnected: 1, completed: 1 });
  });
});
