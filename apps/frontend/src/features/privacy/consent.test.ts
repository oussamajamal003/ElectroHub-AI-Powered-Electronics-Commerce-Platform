import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsAllowed, choiceStatus, CONSENT_KEY, saveChoice, ANALYTICS_SESSION_KEY } from './consent';

describe('privacy choice', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  it('defaults off and rejects invalid, expired or future choices', () => {
    expect(analyticsAllowed()).toBe(false);
    for (const value of ['{', JSON.stringify({ version: 2, analytics: true, savedAt: Date.now() }), JSON.stringify({ version: 1, analytics: true, savedAt: 1 }), JSON.stringify({ version: 1, analytics: true, savedAt: Date.now() + 60000 })]) {
      localStorage.setItem(CONSENT_KEY, value);
      expect(choiceStatus()).toBe('unset');
    }
  });
  it('persists explicit choices and clears only the analytics identifier on withdrawal', () => {
    sessionStorage.setItem(ANALYTICS_SESSION_KEY, 'identifier');
    sessionStorage.setItem('essential', 'keep');
    expect(saveChoice(true)).toBe(true);
    expect(analyticsAllowed()).toBe(true);
    localStorage.setItem(CONSENT_KEY, '{broken');
    expect(analyticsAllowed()).toBe(false);
    expect(saveChoice(false)).toBe(true);
    expect(analyticsAllowed()).toBe(false);
    expect(sessionStorage.getItem(ANALYTICS_SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem('essential')).toBe('keep');
  });
  it('applies a choice in memory when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(saveChoice(false)).toBe(false);
    expect(analyticsAllowed()).toBe(false);
    spy.mockRestore();
    saveChoice(false);
  });
});
