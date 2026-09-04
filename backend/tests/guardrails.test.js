import test from 'node:test';
import assert from 'node:assert/strict';
import { decideTier, actionForTier } from '../guardrails.js';
import { AUTO_RECOVER_MAX_AMOUNT_INR, AUTO_RECOVER_MIN_CONFIDENCE, QUEUE_MIN_CONFIDENCE } from '../config.js';

test('high confidence low amount auto recovers', () => {
  const tier = decideTier('transient_gateway_error', 0.9, 1000, false);
  assert.equal(tier, 'auto');
});

test('high confidence high amount queues not auto', () => {
  const tier = decideTier('transient_gateway_error', 0.9, AUTO_RECOVER_MAX_AMOUNT_INR + 1000, false);
  assert.equal(tier, 'queue');
});

test('exact threshold boundary (0.75 confidence, 2000 INR) auto recovers', () => {
  const tier = decideTier('transient_gateway_error', AUTO_RECOVER_MIN_CONFIDENCE, AUTO_RECOVER_MAX_AMOUNT_INR, false);
  assert.equal(tier, 'auto');
});

test('medium confidence (0.45) queues for merchant approval', () => {
  const tier = decideTier('transient_gateway_error', 0.45, 1000, false);
  assert.equal(tier, 'queue');
});

test('exact queue minimum confidence (0.40) queues for merchant approval', () => {
  const tier = decideTier('transient_gateway_error', QUEUE_MIN_CONFIDENCE, 1000, false);
  assert.equal(tier, 'queue');
});

test('below queue confidence (0.39) stops', () => {
  const tier = decideTier('transient_gateway_error', 0.39, 1000, false);
  assert.equal(tier, 'stop');
});

test('dead card always stops regardless of confidence or amount', () => {
  const tier = decideTier('dead_card', 0.99, 100, false);
  assert.equal(tier, 'stop');
});

test('user abandoned checkout queues for merchant review', () => {
  const tier = decideTier('user_abandoned_checkout', 0.95, 500, false);
  assert.equal(tier, 'queue');
});

test('bank outage always stops even with high confidence', () => {
  const tier = decideTier('transient_gateway_error', 0.99, 100, true);
  assert.equal(tier, 'stop');
});

test('low confidence stops', () => {
  const tier = decideTier('unknown', 0.2, 100, false);
  assert.equal(tier, 'stop');
});

test('action mapping', () => {
  assert.equal(actionForTier('stop', 'dead_card'), 'none');
  assert.equal(actionForTier('auto', 'transient_gateway_error'), 'retry');
  assert.equal(actionForTier('queue', 'transient_gateway_error'), 'retry_pending_approval');
  assert.equal(actionForTier('queue', 'auth_dropped_3ds'), 'nudge');
  assert.equal(actionForTier('queue', 'insufficient_funds'), 'nudge');
  assert.equal(actionForTier('stop', 'auth_dropped_3ds'), 'none');
});
