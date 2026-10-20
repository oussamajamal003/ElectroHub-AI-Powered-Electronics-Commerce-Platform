const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertAcceptanceTarget } = require('./task04-dev-acceptance.cjs');
const runtime = { category: 'dev', identity: 'supabase:pzxekjybdiulzmssalfo/postgres' };
const targets = { runtime, migration: runtime };
test('synthetic acceptance refuses production, isolated, shared test bypass, live keys and mismatched migration targets before writes', () => {
  const env = { NODE_ENV: 'development', STRIPE_SECRET_KEY: 'sk_test_fixture' };
  assert.doesNotThrow(() => assertAcceptanceTarget(env, targets));
  for (const patch of [{ NODE_ENV: 'production' }, { NODE_ENV: 'test' }, { STRIPE_SECRET_KEY: 'sk_live_fixture' }, { STRIPE_SECRET_KEY: '' }]) {
    assert.throws(() => assertAcceptanceTarget({ ...env, ...patch }, targets));
  }
  assert.throws(() => assertAcceptanceTarget(env, { ...targets, runtime: { category: 'disposable', identity: 'loopback' } }));
  assert.throws(() => assertAcceptanceTarget(env, { ...targets, migration: { identity: 'other' } }));
});

const { classifyResume, withResumeAuthorization, RESUME_WINDOW_MS } = require('./task04-dev-acceptance.cjs');
const NOW = Date.parse('2026-10-20T15:00:00Z');
const attemptId = '11111111-1111-4111-8111-111111111111';
const preSubmit = () => ({ id: attemptId, state: 'AWAITING_INPUT', submittedAt: null, confirmationStartedAt: null, orderId: null,
  cancelRequested: false, failureCode: null, providerIntentId: 'pi_fixture', work: { state: 'READY' }, expiresAt: new Date(NOW + 2 * RESUME_WINDOW_MS) });
const idleIntent = () => ({ id: 'pi_fixture', attemptId, livemode: false, status: 'requires_payment_method', received: 0, capturable: 0, methodType: null, declined: false });
const input = (patch = {}) => ({ stage: 'journeyStarted', orders: [], attempts: [preSubmit()], intent: idleIntent(), events: 0, now: NOW, ...patch });

test('a harmless pre-submit interruption resumes with the same attempt and provider identity', () => {
  assert.deepEqual(classifyResume(input()), { resumable: true, reason: 'PRE_SUBMIT_ATTEMPT_PRESERVED', attemptId });
  assert.deepEqual(classifyResume(input({ attempts: [], intent: null })), { resumable: true, reason: 'PRE_SUBMIT_NO_ATTEMPT', attemptId: null });
});

test('recorded or uncertain submissions, paid or duplicated state and contradictory evidence never resume', () => {
  const refused = patch => assert.equal(classifyResume(input(patch)).resumable, false, JSON.stringify(patch));
  for (const stage of ['confirmSubmitted', 'purchased', 'unknown', undefined, 'prepared']) refused({ stage });
  refused({ orders: [{ id: 'o' }] });
  refused({ attempts: [preSubmit(), preSubmit()] });
  refused({ events: 1 });
  refused({ events: undefined });
  refused({ orders: undefined });
  refused({ attempts: [], intent: idleIntent() });
  for (const attempt of [{ submittedAt: new Date(NOW) }, { confirmationStartedAt: new Date(NOW) }, { state: 'PAID' }, { state: 'PROCESSING' },
    { state: 'DECLINED' }, { orderId: 'o' }, { cancelRequested: true }, { failureCode: 'PAYMENT_NOT_CONFIRMED' }, { work: { state: 'LEASED' } },
    { work: null }, { expiresAt: new Date(NOW) }, { expiresAt: null }]) refused({ attempts: [{ ...preSubmit(), ...attempt }] });
  for (const intent of [null, { id: 'pi_other' }, { attemptId: 'other' }, { livemode: true }, { status: 'requires_capture' }, { status: 'succeeded' },
    { status: 'processing' }, { received: 1 }, { capturable: 1 }, { methodType: 'card' }, { declined: true }]) {
    refused({ intent: intent && { ...idleIntent(), ...intent } });
  }
});

test('resume authorization is single-use, monotonic and preserves original progress and history', () => {
  const state = { stage: 'journeyStarted', runId: 'run', startedAt: 'original' };
  const first = withResumeAuthorization(state, classifyResume(input()), new Date(NOW));
  assert.equal(first.startedAt, 'original');
  assert.equal(first.resumeAuthorization.attemptId, attemptId);
  assert.equal(Date.parse(first.resumeAuthorization.expiresAt) - NOW, RESUME_WINDOW_MS);
  assert.throws(() => withResumeAuthorization(first, classifyResume(input())), /ALREADY_PENDING/);
  const consumed = { ...first, resumeAuthorization: { ...first.resumeAuthorization, consumedAt: 'x' } };
  const second = withResumeAuthorization(consumed, classifyResume(input()));
  assert.equal(second.resumeHistory.length, 1);
  assert.equal(second.resumeHistory[0].consumedAt, 'x');
  assert.throws(() => withResumeAuthorization({ ...state, stage: 'confirmSubmitted' }, classifyResume(input())), /NOT_PERMITTED/);
  assert.throws(() => withResumeAuthorization(state, { resumable: false }), /NOT_PERMITTED/);
});

test('a never-submitted attempt released by the scoped worker resumes as a new single purchase; anything else stays refused', () => {
  const { uniquePurchase } = require('./task04-dev-acceptance.cjs');
  const released = () => ({ ...preSubmit(), state: 'CANCELED', providerStatus: 'canceled', failureCode: 'PAYMENT_EXPIRED', work: { state: 'DONE' }, expiresAt: new Date(NOW - 1) });
  const canceledIntent = () => ({ ...idleIntent(), status: 'canceled' });
  assert.deepEqual(classifyResume(input({ attempts: [released()], intent: canceledIntent(), events: 1 })),
    { resumable: true, reason: 'PRE_SUBMIT_ATTEMPT_RELEASED', attemptId: null });
  for (const patch of [{ submittedAt: new Date(NOW) }, { confirmationStartedAt: new Date(NOW) }, { orderId: 'o' }, { work: { state: 'READY' } }, { providerStatus: 'succeeded' }]) {
    assert.equal(classifyResume(input({ attempts: [{ ...released(), ...patch }], intent: canceledIntent(), events: 1 })).resumable, false, JSON.stringify(patch));
  }
  for (const patch of [{ received: 1 }, { capturable: 1 }, { methodType: 'card' }, { livemode: true }, { status: 'succeeded' }, { attemptId: 'other' }]) {
    assert.equal(classifyResume(input({ attempts: [released()], intent: { ...canceledIntent(), ...patch }, events: 1 })).resumable, false, JSON.stringify(patch));
  }
  const order = { id: 'order-1' };
  const paid = { id: 'paid', state: 'PAID', orderId: 'order-1', submittedAt: new Date(NOW), work: { state: 'DONE' } };
  assert.equal(uniquePurchase([order], [released(), paid]), paid);
  assert.equal(uniquePurchase([order], [paid]), paid);
  assert.equal(uniquePurchase([order], [paid, { ...paid, id: 'paid-2' }]), null);
  assert.equal(uniquePurchase([order, { id: 'order-2' }], [released(), paid]), null);
  assert.equal(uniquePurchase([order], [{ ...released(), submittedAt: new Date(NOW) }, paid]), null);
  assert.equal(uniquePurchase([order], [released(), released(), paid]), null);
  assert.equal(uniquePurchase([order], [released()]), null);
});
