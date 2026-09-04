import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleBasedClassify, classifyRootCause } from '../classifier.js';

test('GATEWAY_ERROR with 0 prior failures classifies as transient_gateway_error', () => {
  const result = ruleBasedClassify('GATEWAY_ERROR', 1, 0);
  assert.equal(result.root_cause, 'transient_gateway_error');
  assert.equal(result.confidence, 0.85);
});

test('authentication_failed classifies as auth_dropped_3ds', () => {
  const result = ruleBasedClassify('authentication_failed', 1, 0);
  assert.equal(result.root_cause, 'auth_dropped_3ds');
  assert.equal(result.confidence, 0.78);
});

test('payment_cancelled classifies as user_abandoned_checkout', () => {
  const result = ruleBasedClassify('payment_cancelled', 1, 0);
  assert.equal(result.root_cause, 'user_abandoned_checkout');
  assert.equal(result.confidence, 0.90);
});

test('insufficient_funds with <2 prior failures classifies as insufficient_funds', () => {
  const result = ruleBasedClassify('insufficient_funds', 1, 1);
  assert.equal(result.root_cause, 'insufficient_funds');
  assert.equal(result.confidence, 0.75);
});

test('insufficient_funds with >=2 prior failures classifies as dead_card', () => {
  const result = ruleBasedClassify('insufficient_funds', 3, 2);
  assert.equal(result.root_cause, 'dead_card');
  assert.equal(result.confidence, 0.90);
});

test('unknown error code classifies as unknown with low confidence', () => {
  const result = ruleBasedClassify('SOMETHING_UNEXPECTED', 1, 0);
  assert.equal(result.root_cause, 'unknown');
  assert.equal(result.confidence, 0.30);
});

test('classifyRootCause falls back to rule-based when no API key', async () => {
  const result = await classifyRootCause('GATEWAY_ERROR', 1, 0, 1000, 'card');
  assert.equal(result.root_cause, 'transient_gateway_error');
  assert.ok(result.confidence > 0);
});
