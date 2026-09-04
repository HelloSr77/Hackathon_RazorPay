import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  isDndWindowActive, 
  canSendNudge, 
  setCustomerConsent, 
  isCustomerOptedOut, 
  getQueueReason 
} from '../guardrails.js';
import { runtimeSettings, updateSettings } from '../config.js';
import { getDb } from '../db.js';

test('DND window correctly detects quiet hours (spanning midnight: 21:00 to 09:00)', () => {
  // 11:00 PM (23:00) -> should be inside DND
  const nightTime = new Date('2026-09-03T23:15:00');
  assert.equal(isDndWindowActive(nightTime), true);

  // 03:30 AM -> should be inside DND
  const earlyMorning = new Date('2026-09-03T03:30:00');
  assert.equal(isDndWindowActive(earlyMorning), true);

  // 02:00 PM (14:00) -> should be outside DND
  const afternoonTime = new Date('2026-09-03T14:00:00');
  assert.equal(isDndWindowActive(afternoonTime), false);
});

test('canSendNudge blocks communications during DND hours', () => {
  const nightTime = new Date('2026-09-03T22:30:00');
  const result = canSendNudge('cust_compliance_dnd_test', nightTime);
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'DND_ACTIVE');
  assert.match(result.reason, /Do-Not-Disturb/i);
});

test('canSendNudge permits communications during daytime hours for consenting customers', () => {
  const dayTime = new Date('2026-09-03T11:00:00');
  const result = canSendNudge('cust_consenting_daytime_user', dayTime);
  assert.equal(result.allowed, true);
});

test('opt-out tracking blocks WhatsApp/SMS nudges even during daytime', () => {
  const customerId = 'cust_optout_test_123';
  setCustomerConsent(customerId, true, 'Customer opted out via reply STOP');

  assert.equal(isCustomerOptedOut(customerId), true);

  const dayTime = new Date('2026-09-03T12:00:00');
  const result = canSendNudge(customerId, dayTime);
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'CUSTOMER_OPTED_OUT');
  assert.match(result.reason, /opted out/i);

  // Re-opt-in customer
  setCustomerConsent(customerId, false, 'Customer opted back in via checkout preference');
  assert.equal(isCustomerOptedOut(customerId), false);
  const reoptResult = canSendNudge(customerId, dayTime);
  assert.equal(reoptResult.allowed, true);
});

test('getQueueReason provides specific visible logged explanations for each queue decision', () => {
  // Reason 1: Exceeds amount cap
  const highAmountReason = getQueueReason('transient_gateway_error', 0.85, 4500);
  assert.match(highAmountReason, /exceeds auto-recovery cap of ₹2,000/);

  // Reason 2: User abandoned checkout
  const abandonmentReason = getQueueReason('user_abandoned_checkout', 0.90, 800);
  assert.match(abandonmentReason, /cancelled checkout; merchant review required/);

  // Reason 3: Moderate AI confidence
  const modConfidenceReason = getQueueReason('unknown', 0.55, 1200);
  assert.match(modConfidenceReason, /falls in merchant review band/);

  // Reason 4: 3DS OTP drop
  const otpDropReason = getQueueReason('auth_dropped_3ds', 0.70, 900);
  assert.match(otpDropReason, /3DS OTP authentication dropped/);
});
