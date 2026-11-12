import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api';
import { ANALYTICS_SESSION_KEY, analyticsAllowed, CONSENT_KEY, consentGeneration, onAnalyticsWithdrawn, saveChoice } from './consent';
import { ANALYTICS_WITHDRAWAL_ENDPOINT, pendingAnalyticsRefsForTests, reportImageResultSelected, searchByImage } from '@/features/search/discovery/imageSearch';

vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiClient: vi.fn() }));

const PRODUCT = { id: 'p1', slug: 'phone' };
const photo = () => new File(['x'], 'photo.png', { type: 'image/png' });
type Pending = { resolve: (value: unknown) => void; reject: (error: unknown) => void; headers: Record<string, string> };
const fetchMock = vi.fn();
const withdrawalCalls = () => fetchMock.mock.calls.filter(([url]) => url === ANALYTICS_WITHDRAWAL_ENDPOINT) as [string, RequestInit & { body: string }][];
const withdrawalBody = (index: number) => JSON.parse(withdrawalCalls()[index]![1].body) as { refs: string[] };
const selectionCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/analytics/events');
/** Simulates the browser delivering another tab's change of the stored choice. */
const otherTabWrites = (value: string | null) => {
  if (value === null) localStorage.removeItem(CONSENT_KEY); else localStorage.setItem(CONSENT_KEY, value);
  window.dispatchEvent(new StorageEvent('storage', { key: CONSENT_KEY, newValue: value }));
};
const stored = (analytics: boolean, savedAt = Date.now()) => JSON.stringify({ version: 1, analytics, savedAt });

function pendingSearch() {
  let pending!: Pending;
  vi.mocked(apiClient).mockImplementationOnce((_endpoint, options) => new Promise((resolve, reject) => {
    pending = { resolve, reject, headers: (options?.headers ?? {}) as Record<string, string> };
  }));
  const outcome = searchByImage(photo(), new AbortController().signal);
  return { outcome, get pending() { return pending; } };
}

beforeEach(() => {
  vi.stubEnv('VITE_IMAGE_SEARCH_ENABLED', 'true');
  saveChoice(false);
  localStorage.clear();
  sessionStorage.clear();
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.mocked(apiClient).mockReset(); });

describe('consent state', () => {
  it('another tab accepting or withdrawing applies here immediately, without a reload', () => {
    otherTabWrites(stored(true));
    expect(analyticsAllowed()).toBe(true);
    sessionStorage.setItem(ANALYTICS_SESSION_KEY, 'id');
    const before = consentGeneration();
    otherTabWrites(stored(false));
    expect(analyticsAllowed()).toBe(false);
    expect(sessionStorage.getItem(ANALYTICS_SESSION_KEY)).toBeNull();
    expect(consentGeneration()).toBe(before + 1);
  });

  it('another tab clearing storage (key null) or writing a corrupt record turns analytics off', () => {
    otherTabWrites(stored(true));
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(analyticsAllowed()).toBe(false);
    otherTabWrites(stored(true));
    otherTabWrites('{"version":1,"analytics":"yes"');
    expect(analyticsAllowed()).toBe(false);
  });

  it('runs withdrawal listeners exactly once per withdrawal, not on repeated rejections or acceptance', () => {
    const listener = vi.fn();
    const off = onAnalyticsWithdrawn(listener);
    saveChoice(true); saveChoice(true);
    saveChoice(false); saveChoice(false);
    otherTabWrites(stored(false));
    expect(listener).toHaveBeenCalledOnce();
    off();
  });

  it('an expired choice reads as unset (re-consent required) and never enables analytics', () => {
    localStorage.setItem(CONSENT_KEY, stored(true, Date.now() - 181 * 24 * 60 * 60 * 1000));
    expect(analyticsAllowed()).toBe(false);
  });

  it('with storage blocked, nothing is assumed: only an explicit in-memory choice applies, and rejection stays possible', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    expect(analyticsAllowed()).toBe(false);
    expect(saveChoice(true)).toBe(false);
    expect(analyticsAllowed()).toBe(true);
    expect(saveChoice(false)).toBe(false);
    expect(analyticsAllowed()).toBe(false);
    get.mockRestore(); set.mockRestore();
  });
});

describe('in-flight image search and withdrawal', () => {
  it('without consent: no analytics headers, no reference, no withdrawal traffic', async () => {
    const search = pendingSearch();
    await Promise.resolve();
    expect(search.pending.headers).toEqual({});
    search.pending.resolve({ data: { items: [PRODUCT] }, analyticsToken: 'tok' });
    const outcome = await search.outcome;
    expect(outcome).toEqual({ status: 'success', items: [PRODUCT] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('withdraw while pending: the reference is sent to the server, the search still completes, its token is discarded', async () => {
    saveChoice(true);
    const search = pendingSearch();
    await Promise.resolve();
    const ref = search.pending.headers['X-ElectroHub-Analytics-Ref'];
    expect(search.pending.headers['X-ElectroHub-Analytics']).toBe('consented');
    expect(ref).toMatch(/^[0-9a-f-]{36}$/);
    saveChoice(false);
    expect(withdrawalCalls()).toHaveLength(1);
    const [, init] = withdrawalCalls()[0]!;
    expect(withdrawalBody(0)).toEqual({ refs: [ref] });
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' });
    search.pending.resolve({ data: { items: [PRODUCT] }, analyticsToken: 'tok' });
    const outcome = await search.outcome;
    expect(outcome).toEqual({ status: 'success', items: [PRODUCT] });
    reportImageResultSelected(undefined, PRODUCT.id);
    expect(selectionCalls()).toHaveLength(0);
  });

  it('withdraw in another tab while pending is handled the same way', async () => {
    saveChoice(true);
    const search = pendingSearch();
    await Promise.resolve();
    otherTabWrites(stored(false));
    expect(withdrawalCalls()).toHaveLength(1);
    search.pending.resolve({ data: { items: [PRODUCT] }, analyticsToken: 'tok' });
    expect(await search.outcome).not.toHaveProperty('analyticsToken');
  });

  it('withdraw while a failing search is pending still sends the withdrawal (the server may record the failure)', async () => {
    saveChoice(true);
    const search = pendingSearch();
    await Promise.resolve();
    saveChoice(false);
    search.pending.reject(new TypeError('offline'));
    await search.outcome;
    expect(withdrawalCalls()).toHaveLength(1);
    expect(pendingAnalyticsRefsForTests()).toEqual([]);
  });

  it('a response received before withdrawal keeps its token, but a selection after withdrawal is not sent, even after re-consent', async () => {
    saveChoice(true);
    const search = pendingSearch();
    await Promise.resolve();
    search.pending.resolve({ data: { items: [PRODUCT] }, analyticsToken: 'tok' });
    const outcome = await search.outcome;
    if (outcome.status !== 'success') throw new Error('expected success');
    expect(outcome.analyticsToken).toBe('tok');
    saveChoice(false);
    expect(withdrawalCalls()).toHaveLength(0); // nothing was pending
    reportImageResultSelected(outcome.analyticsToken, PRODUCT.id, outcome.consentGeneration);
    saveChoice(true);
    reportImageResultSelected(outcome.analyticsToken, PRODUCT.id, outcome.consentGeneration);
    expect(selectionCalls()).toHaveLength(0);
  });

  it('a duplicate response callback cannot resurrect a discarded token, and re-consent starts a fresh reference', async () => {
    saveChoice(true);
    const first = pendingSearch();
    await Promise.resolve();
    const firstRef = first.pending.headers['X-ElectroHub-Analytics-Ref'];
    saveChoice(false);
    first.pending.resolve({ data: { items: [PRODUCT] }, analyticsToken: 'tok' });
    first.pending.resolve({ data: { items: [PRODUCT] }, analyticsToken: 'tok2' });
    expect(await first.outcome).not.toHaveProperty('analyticsToken');
    saveChoice(true);
    const second = pendingSearch();
    await Promise.resolve();
    const secondRef = second.pending.headers['X-ElectroHub-Analytics-Ref'];
    expect(secondRef).toBeDefined();
    expect(secondRef).not.toBe(firstRef);
    second.pending.resolve({ data: { items: [PRODUCT] }, analyticsToken: 'fresh' });
    const outcome = await second.outcome;
    if (outcome.status !== 'success') throw new Error('expected success');
    reportImageResultSelected(outcome.analyticsToken, PRODUCT.id, outcome.consentGeneration);
    expect(selectionCalls()).toHaveLength(1);
  });

  it('a withdrawal that cannot be delivered (offline) is retried once when the browser is back online', async () => {
    saveChoice(true);
    const search = pendingSearch();
    await Promise.resolve();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    saveChoice(false);
    expect(withdrawalCalls()).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    window.dispatchEvent(new Event('online'));
    expect(withdrawalCalls()).toHaveLength(2);
    expect(withdrawalBody(1).refs).toEqual(withdrawalBody(0).refs);
    window.dispatchEvent(new Event('online'));
    expect(withdrawalCalls()).toHaveLength(2);
    search.pending.resolve({ data: { items: [] } });
    await search.outcome;
  });
});
