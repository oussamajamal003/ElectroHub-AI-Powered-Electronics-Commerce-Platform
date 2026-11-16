const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, assertExactScope, report } = require('./dev-email-exact-send.cjs');

const ORDER = 'ORD-9FB0FC8A-3CBB-47C2-A938-A925E9913648';
const id = '9fb0fc8a-3cbb-47c2-a938-a925e9913648';
const row = patch => ({ orderId: id, type: 'ORDER_CONFIRMED', dispatchState: 'READY', deliveryState: 'UNKNOWN', attemptCount: 0, acceptedAt: null,
  deliveredAt: null, providerMessageId: null, lastErrorCode: null, ...patch });

test('arguments: dry-run by default; send requires an explicit recipient confirmation', () => {
  assert.deepEqual(parse([`--order=${ORDER}`]), { orderId: id, send: false, confirm: '' });
  assert.throws(() => parse([`--order=${ORDER}`, '--send']), /confirm-recipient/);
  assert.throws(() => parse(['--order=all']));
  assert.throws(() => parse([`--order=${ORDER}`, '--replay-backlog']));
  assert.equal(parse([`--order=${ORDER}`, '--send', '--confirm-recipient=Me@Example.com']).confirm, 'me@example.com');
});

test('scope is exactly this order: other sendable backlog for the recipient, leased rows or more than two rows refuse', () => {
  assert.equal(assertExactScope([row(), row({ type: 'PAYMENT_CONFIRMED' }), row({ orderId: 'old', dispatchState: 'ACCEPTED' })], id), 2);
  assert.throws(() => assertExactScope([row(), row({ orderId: 'other' })], id), /OTHER_BACKLOG/);
  assert.throws(() => assertExactScope([row(), row({ orderId: 'other', dispatchState: 'RETRY_WAIT' })], id), /OTHER_BACKLOG/);
  assert.throws(() => assertExactScope([row({ dispatchState: 'LEASED' })], id), /NOT_EXACT/);
  assert.throws(() => assertExactScope([row(), row(), row()], id), /NOT_EXACT/);
  assert.throws(() => assertExactScope([row({ dispatchState: 'ACCEPTED' })], id), /NOTHING_TO_SEND/);
});

test('report separates enqueue, dispatch, provider acceptance and delivery; queued is never sent', () => {
  assert.deepEqual(report([row()], id)[0], { type: 'ORDER_CONFIRMED', enqueued: true, dispatched: false, providerAccepted: false,
    dispatchState: 'READY', delivered: 'UNVERIFIED', deliveryState: 'UNKNOWN', lastErrorCode: null });
  const accepted = report([row({ dispatchState: 'ACCEPTED', attemptCount: 1, acceptedAt: new Date(), providerMessageId: 'm' })], id)[0];
  assert.equal(accepted.providerAccepted, true); assert.equal(accepted.delivered, 'UNVERIFIED');
  assert.equal(report([row({ deliveryState: 'DELIVERED' })], id)[0].delivered, 'PROVIDER_REPORTED');
});

test('delivery evidence is VERIFIED only by a provider delivered event; bounces and blocks are failures; nothing else is a claim', () => {
  const { summarize } = require('./dev-email-delivery-evidence.cjs');
  assert.deepEqual(summarize([{ event: 'requests' }, { event: 'delivered' }]), { events: ['delivered', 'requests'], delivery: 'VERIFIED_DELIVERED' });
  assert.equal(summarize([{ event: 'requests' }]).delivery, 'NOT_VERIFIED');
  assert.equal(summarize([{ event: 'requests' }, { event: 'deferred' }]).delivery, 'NOT_VERIFIED');
  for (const failure of ['hardBounces', 'softBounces', 'blocked', 'invalid', 'error', 'spam']) {
    assert.equal(summarize([{ event: 'requests' }, { event: failure }]).delivery, 'PROVIDER_REPORTED_FAILURE');
  }
  assert.deepEqual(summarize(null), { events: [], delivery: 'NOT_VERIFIED' });
  assert.deepEqual(summarize([{ event: 'email', email: 'x@y.z' }]).events, []);
});
