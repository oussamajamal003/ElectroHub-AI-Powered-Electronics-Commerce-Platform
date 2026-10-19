import { describe, expect, it } from 'vitest';
import { classifySendResult, projectEmailConfirmation, retryDelayMs, usableRecipient, eventKeys, MAX_RETRY_AFTER_MS,
  type ConfirmationEventFacts } from '../commerce-email.domain.js';
import { commerceEmailConfig, dispatchPermission, trustedOrigin } from '../commerce-email.config.js';
import { parseRetryAfter } from '../../integrations/brevo/brevo.client.js';

const now = Date.parse('2026-10-18T12:00:00Z');
const fact = (type: string, over: Partial<ConfirmationEventFacts> = {}): ConfirmationEventFacts => ({ type, dispatchState: 'READY', deliveryState: 'UNKNOWN',
  attemptCount: 0, createdAt: new Date(now - 1_000), updatedAt: new Date(now - 500), ...over });
const both = (order: Partial<ConfirmationEventFacts>, payment: Partial<ConfirmationEventFacts> = order) =>
  projectEmailConfirmation([fact('ORDER_CONFIRMED', order), fact('PAYMENT_CONFIRMED', payment)], now)?.state;

describe('customer email projection (T25, T18, PARTIAL precedence)', () => {
  it('omits the projection when no event exists instead of inventing QUEUED', () => {
    expect(projectEmailConfirmation([], now)).toBeNull();
    expect(projectEmailConfirmation([fact('ORDER_CANCELLED')], now)).toBeNull();
  });
  it('maps every aggregate state with the documented precedence', () => {
    expect(both({})).toBe('QUEUED');
    expect(both({ dispatchState: 'LEASED' }, {})).toBe('QUEUED');
    expect(both({ dispatchState: 'RETRY_WAIT', attemptCount: 1 }, {})).toBe('DELAYED');
    expect(both({ createdAt: new Date(now - 6 * 60_000) })).toBe('DELAYED');
    expect(both({ dispatchState: 'ACCEPTED' })).toBe('SENT');
    expect(both({ dispatchState: 'ACCEPTED', deliveryState: 'DELIVERED' })).toBe('DELIVERED');
    expect(both({ dispatchState: 'ACCEPTED', deliveryState: 'DELIVERED' }, { dispatchState: 'ACCEPTED' })).toBe('SENT'); // never inferred
    expect(both({ dispatchState: 'ACCEPTED' }, {})).toBe('PARTIAL');
    expect(both({ dispatchState: 'ACCEPTED' }, { dispatchState: 'FAILED' })).toBe('PARTIAL');
    expect(both({ dispatchState: 'ACCEPTED' }, { dispatchState: 'ACCEPTED', deliveryState: 'BOUNCED' })).toBe('PARTIAL');
    expect(both({ dispatchState: 'UNCERTAIN' })).toBe('UNAVAILABLE');
    expect(both({ dispatchState: 'SUPPRESSED' })).toBe('UNAVAILABLE');
    expect(both({}, { dispatchState: 'FAILED' })).toBe('UNAVAILABLE');
    expect(projectEmailConfirmation([fact('ORDER_CONFIRMED', { dispatchState: 'ACCEPTED' })], now)?.state).toBe('PARTIAL'); // one missing
  });
});

describe('provider outcome classification (never from error prose)', () => {
  it.each([
    [{ success: true, messageId: '<abc@relay>' }, 'ACCEPTED'],
    [{ success: true }, 'UNCERTAIN'],
    [{ success: true, messageId: 'bad id with spaces' }, 'UNCERTAIN'],
    [{ success: false }, 'UNCERTAIN'],
    [{ success: false, failure: { category: 'rejected', httpStatus: 429 } }, 'RETRY'],
    [{ success: false, failure: { category: 'connect' } }, 'RETRY'],
    [{ success: false, failure: { category: 'rejected', httpStatus: 401 } }, 'PAUSE'],
    [{ success: false, failure: { category: 'rejected', httpStatus: 403 } }, 'PAUSE'],
    [{ success: false, failure: { category: 'configuration' } }, 'PAUSE'],
    [{ success: false, failure: { category: 'rejected', httpStatus: 400 } }, 'PERMANENT'],
    [{ success: false, failure: { category: 'rejected', httpStatus: 500 } }, 'UNCERTAIN'],
    [{ success: false, failure: { category: 'rejected', httpStatus: 503 } }, 'UNCERTAIN'],
    [{ success: false, failure: { category: 'rejected' } }, 'UNCERTAIN'],
    [{ success: false, failure: { category: 'timeout' } }, 'UNCERTAIN'],
    [{ success: false, failure: { category: 'network' } }, 'UNCERTAIN'],
    [{ success: false, failure: { category: 'invalid_response' } }, 'UNCERTAIN'],
  ] as const)('%j → %s', (result, kind) => { expect(classifySendResult(result).kind).toBe(kind); });
  it('carries a validated Retry-After for 429 only', () => {
    expect(classifySendResult({ success: false, failure: { category: 'rejected', httpStatus: 429, retryAfterMs: 5_000 } })).toMatchObject({ retryAfterMs: 5_000 });
  });
});

describe('retry policy', () => {
  it('follows the 30s/2m/10m/30m ladder with bounded jitter and a capped Retry-After floor', () => {
    expect(retryDelayMs(1, undefined, () => 0.5)).toBe(30_000);
    expect(retryDelayMs(2, undefined, () => 0.5)).toBe(120_000);
    expect(retryDelayMs(3, undefined, () => 0.5)).toBe(600_000);
    expect(retryDelayMs(4, undefined, () => 0.5)).toBe(1_800_000);
    expect(retryDelayMs(9, undefined, () => 0.5)).toBe(1_800_000);
    expect(retryDelayMs(1, undefined, () => 0)).toBe(27_000);
    expect(retryDelayMs(1, undefined, () => 1)).toBe(33_000);
    expect(retryDelayMs(1, 90_000, () => 0.5)).toBe(90_000);
    expect(retryDelayMs(1, 10 * 3_600_000, () => 0.5)).toBe(MAX_RETRY_AFTER_MS);
    expect(retryDelayMs(1, -5, () => 0.5)).toBe(30_000);
  });
  it('parses Retry-After seconds and dates, ignoring garbage', () => {
    expect(parseRetryAfter('7')).toBe(7_000);
    expect(parseRetryAfter(new Date(now + 20_000).toUTCString(), now)).toBe(20_000);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter('99999999')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe('recipient and identity', () => {
  it('uses only a usable active account address, normalized; otherwise suppresses (T09)', () => {
    expect(usableRecipient({ email: ' Buyer@Example.COM ', isActive: true })).toEqual({ recipient: 'buyer@example.com' });
    expect(usableRecipient({ email: 'x@example.com', isActive: false })).toEqual({ suppression: 'ACCOUNT_INACTIVE' });
    expect(usableRecipient({ email: 'deleted-1@deleted.invalid', isActive: true })).toEqual({ suppression: 'RECIPIENT_UNAVAILABLE' });
    expect(usableRecipient({ email: 'not an email', isActive: true })).toEqual({ suppression: 'RECIPIENT_UNAVAILABLE' });
    expect(usableRecipient(null)).toEqual({ suppression: 'RECIPIENT_UNAVAILABLE' });
  });
  it('stable keys identify one logical event; transitions are keyed by their own identity', () => {
    expect(eventKeys.orderConfirmed('o')).toBe('order:o:confirmed');
    expect(eventKeys.paymentSucceeded('p')).toBe('payment:p:succeeded');
    expect(eventKeys.orderTransition('o', 't1')).not.toBe(eventKeys.orderTransition('o', 't2'));
    expect(eventKeys.paymentRefund('p', 're_1')).toBe('payment:p:refund:re_1');
  });
});

describe('configuration and dispatch gate', () => {
  const base = { NODE_ENV: 'development', COMMERCE_EMAIL_DISPATCH_ENABLED: 'true', COMMERCE_EMAIL_ORIGIN: 'https://shop.example.com' };
  it('is safe by default: nothing enqueued, dispatched or sent', () => {
    const config = commerceEmailConfig({});
    expect(config).toMatchObject({ enqueueEnabled: false, dispatchEnabled: false, sendMode: 'disabled', allowedRecipients: [], batchSize: 10, concurrency: 2, leaseMs: 60_000 });
    expect(dispatchPermission(config, { kind: 'shared', identity: 'db.example:5432/postgres' }, {}).allowed).toBe(false);
  });
  it('accepts only trusted origins', () => {
    expect(trustedOrigin('https://shop.example.com/', 'production')).toBe('https://shop.example.com');
    expect(trustedOrigin('http://localhost:5173', 'development')).toBe('http://localhost:5173');
    expect(trustedOrigin('http://localhost:5173', 'production')).toBeNull();
    for (const bad of ['http://shop.example.com', 'javascript:alert(1)', 'https://shop.example.com/evil', 'https://u:p@shop.example.com', 'https://a.com?x=1', 'nope']) {
      expect(trustedOrigin(bad, 'development')).toBeNull();
    }
  });
  it('rejects a lease that cannot outlive a provider call plus acknowledgement', () => {
    expect(() => commerceEmailConfig({ COMMERCE_EMAIL_LEASE_MS: '20000', COMMERCE_EMAIL_PROVIDER_TIMEOUT_MS: '10000' })).toThrow(/LEASE/);
  });
  it('gates each send mode on its target', () => {
    const shared = { kind: 'shared', identity: 'db.example:5432/postgres' };
    const allow = (env: Record<string, string>, target = shared) => dispatchPermission(commerceEmailConfig({ ...base, ...env }), target, { ...base, ...env }).reason;
    expect(allow({ COMMERCE_EMAIL_SEND_MODE: 'capture', COMMERCE_EMAIL_CAPTURE_DIR: 'x' })).toBe('capture-requires-disposable-target');
    expect(allow({ COMMERCE_EMAIL_SEND_MODE: 'capture', COMMERCE_EMAIL_CAPTURE_DIR: 'x' }, { kind: 'disposable', identity: 'l' })).toBe('capture-disposable');
    expect(allow({ COMMERCE_EMAIL_SEND_MODE: 'allowlist' })).toBe('allowlist-empty');
    expect(allow({ COMMERCE_EMAIL_SEND_MODE: 'allowlist', COMMERCE_EMAIL_ALLOWED_RECIPIENTS: 'qa@example.com' })).toBe('allowlist');
    expect(allow({ COMMERCE_EMAIL_SEND_MODE: 'live' })).toBe('live-target-not-approved');
    expect(allow({ COMMERCE_EMAIL_SEND_MODE: 'live', COMMERCE_EMAIL_LIVE_APPROVED_TARGET: 'other:5432/postgres' })).toBe('live-target-not-approved');
    expect(allow({ COMMERCE_EMAIL_SEND_MODE: 'live', COMMERCE_EMAIL_LIVE_APPROVED_TARGET: shared.identity })).toBe('live-approved-target');
    expect(allow({ COMMERCE_EMAIL_SEND_MODE: 'live', npm_lifecycle_event: 'dev' })).toBe('watched-dev-server');
    expect(allow({ COMMERCE_EMAIL_SEND_MODE: 'live', COMMERCE_EMAIL_ORIGIN: 'http://evil.example' })).toBe('trusted-origin-missing');
  });
});
