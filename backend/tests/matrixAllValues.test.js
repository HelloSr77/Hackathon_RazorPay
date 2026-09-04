import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreTransactionML, scoreBatchML } from '../mlScorer.js';

const BANKS = ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK'];
const ROOT_CAUSES = [
  'transient_gateway_error',
  'insufficient_funds',
  'auth_dropped_3ds',
  'user_abandoned_checkout',
  'dead_card',
  'unknown'
];
const AMOUNTS = [150, 500, 1200, 2000, 4500, 10000];
const CONFIDENCES = [0.25, 0.50, 0.75, 0.85, 0.95];
const BUSINESS_HOURS = [0, 1];
const MODELS = [
  'recovery_model_gradient_boosting.joblib',
  'recovery_model_logistic_regression.joblib'
];

test('ML Model Matrix: scores all banks, amounts, hours, confidences, and root causes across both models', async () => {
  for (const model of MODELS) {
    const batch = [];

    for (const bank of BANKS) {
      for (const rootCause of ROOT_CAUSES) {
        for (const isBusinessHours of BUSINESS_HOURS) {
          for (const amountInr of AMOUNTS) {
            for (const confidence of CONFIDENCES) {
              batch.push({
                amountInr,
                confidence,
                bank,
                rootCause,
                isBusinessHours
              });
            }
          }
        }
      }
    }

    // Total combinations: 5 banks * 6 causes * 2 hours * 6 amounts * 5 confidences = 1800 combinations per model!
    assert.equal(batch.length, 1800, `Expected 1800 combinations for ${model}`);

    const result = await scoreBatchML(batch, model);
    assert.ok(result);
    assert.equal(result.recovery_probabilities.length, 1800);

    for (let i = 0; i < result.recovery_probabilities.length; i++) {
      const p = result.recovery_probabilities[i];
      assert.equal(typeof p, 'number', `Probability at index ${i} is not a number`);
      assert.ok(!isNaN(p), `Probability at index ${i} is NaN`);
      assert.ok(isFinite(p), `Probability at index ${i} is not finite`);
      assert.ok(p >= 0.0 && p <= 1.0, `Probability ${p} out of bounds [0, 1] at index ${i}`);
    }

    console.log(`  ✔ Model ${model}: Successfully scored all 1,800 combinations across all values with 100% validity!`);
  }
});

test('ML Model Monotonicity: business hours, amount caps, and confidence behave logically', async () => {
  for (const model of MODELS) {
    // 1. Daytime vs Nighttime
    const daytime = await scoreTransactionML({
      amountInr: 1000,
      confidence: 0.85,
      bank: 'HDFC',
      rootCause: 'transient_gateway_error',
      isBusinessHours: 1,
      model
    });

    const nighttime = await scoreTransactionML({
      amountInr: 1000,
      confidence: 0.85,
      bank: 'HDFC',
      rootCause: 'transient_gateway_error',
      isBusinessHours: 0,
      model
    });

    assert.ok(
      daytime.recovery_probability >= nighttime.recovery_probability,
      `Daytime prob (${daytime.recovery_probability}) should be >= nighttime (${nighttime.recovery_probability}) for ${model}`
    );

    // 2. Small amount vs Large amount
    const smallAmt = await scoreTransactionML({
      amountInr: 500,
      confidence: 0.85,
      bank: 'ICICI',
      rootCause: 'transient_gateway_error',
      isBusinessHours: 1,
      model
    });

    const largeAmt = await scoreTransactionML({
      amountInr: 8000,
      confidence: 0.85,
      bank: 'ICICI',
      rootCause: 'transient_gateway_error',
      isBusinessHours: 1,
      model
    });

    assert.ok(
      smallAmt.recovery_probability > largeAmt.recovery_probability,
      `Small amount prob (${smallAmt.recovery_probability}) should be > large amount (${largeAmt.recovery_probability}) for ${model}`
    );

    // 3. High confidence vs Low confidence
    const highConf = await scoreTransactionML({
      amountInr: 1000,
      confidence: 0.90,
      bank: 'KOTAK',
      rootCause: 'transient_gateway_error',
      isBusinessHours: 1,
      model
    });

    const lowConf = await scoreTransactionML({
      amountInr: 1000,
      confidence: 0.35,
      bank: 'KOTAK',
      rootCause: 'transient_gateway_error',
      isBusinessHours: 1,
      model
    });

    assert.ok(
      highConf.recovery_probability >= lowConf.recovery_probability,
      `High conf prob (${highConf.recovery_probability}) should be >= low conf (${lowConf.recovery_probability}) for ${model}`
    );
  }
});
