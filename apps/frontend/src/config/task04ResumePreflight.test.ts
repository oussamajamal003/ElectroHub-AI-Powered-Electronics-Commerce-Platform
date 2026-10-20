import { describe, expect, it } from 'vitest';
import { resumeDecision, type ProgressState } from '../../tests/task04/global-setup';

const NOW = Date.parse('2026-10-20T15:00:00Z');
const authorization = { id: 'auth-1', runId: 'run', attemptId: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(NOW + 60_000).toISOString() };
const resumable: ProgressState = { stage: 'journeyStarted', runId: 'run', resumeAuthorization: authorization };

describe('Task04 real-DEV purchase preflight', () => {
  it('starts an unused fixture and resumes only a reconciled, fresh, unconsumed pre-submit authorization', () => {
    expect(resumeDecision({ stage: 'prepared', runId: 'run' }, 'run', NOW)).toBe('fresh');
    expect(resumeDecision(resumable, 'run', NOW)).toBe('resume');
    expect(resumeDecision({ ...resumable, resumeAuthorization: { ...authorization, attemptId: null } }, 'run', NOW)).toBe('resume');
  });

  it('never permits a second Place Order after submission or with missing, stale, foreign or reused authority', () => {
    const refused: ProgressState[] = [
      { stage: 'journeyStarted', runId: 'run' },
      { ...resumable, stage: 'confirmSubmitted' },
      { ...resumable, stage: 'purchased' },
      { ...resumable, stage: 'unknown' },
      { ...resumable, runId: 'other' },
      { ...resumable, resumeAuthorization: { ...authorization, runId: 'other' } },
      { ...resumable, resumeAuthorization: { ...authorization, consumedAt: 'earlier' } },
      { ...resumable, resumeAuthorization: { ...authorization, expiresAt: new Date(NOW).toISOString() } },
      { ...resumable, resumeAuthorization: { ...authorization, expiresAt: 'not-a-date' } },
      { ...resumable, resumeAuthorization: { ...authorization, id: undefined } },
      { ...resumable, resumeAuthorization: { ...authorization, attemptId: 7 } },
      { stage: 'prepared', runId: 'run', resumeAuthorization: authorization },
      {},
    ];
    for (const state of refused) expect(() => resumeDecision(state, 'run', NOW), JSON.stringify(state)).toThrow(/do not repeat Place Order/);
  });
});
