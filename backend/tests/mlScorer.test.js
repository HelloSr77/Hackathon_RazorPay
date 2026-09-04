import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreTransactionML } from '../mlScorer.js';
import { getDb, initDb } from '../db.js';
import { processTransaction } from '../recoveryEngine.js';

test('scoreTransactionML returns valid recovery probability from Gradient Boosting model', async () => {
  const result = await scoreTransactionML({
    amountInr: 1200,
    confidence: 0.85,
    bank: 'HDFC',
    rootCause: 'transient_gateway_error',
    isBusinessHours: 1
  });

  assert.ok(result);
  assert.equal(typeof result.recovery_probability, 'number');
  assert.ok(result.recovery_probability >= 0 && result.recovery_probability <= 1);
  assert.ok(result.recovery_probability > 0.75, 'Expected high recovery probability for low amount gateway error on HDFC');
  assert.equal(result.model, 'recovery_model_gradient_boosting.joblib');
});

test('scoreTransactionML differentiates low vs high amounts', async () => {
  const lowAmount = await scoreTransactionML({
    amountInr: 500,
    confidence: 0.85,
    bank: 'HDFC',
    rootCause: 'transient_gateway_error',
    isBusinessHours: 1
  });

  const highAmount = await scoreTransactionML({
    amountInr: 7500,
    confidence: 0.85,
    bank: 'SBI',
    rootCause: 'transient_gateway_error',
    isBusinessHours: 0
  });

  assert.ok(lowAmount.recovery_probability > highAmount.recovery_probability);
});

test('processTransaction integrates ML recovery probability into auto-recovery reasoning', async () => {
  const db = getDb();
  initDb(db);

  const orderId = `order_ml_test_${Date.now()}`;
  let txnId = null;
  let decisionId = null;

  try {
    const info = db.prepare(`
      INSERT INTO transactions (order_id, customer_id, amount_inr, method, bank, card_fingerprint, status)
      VALUES (?, 'cust_ml_test', 950, 'card', 'ICICI', 'card_ml_test', 'failed')
    `).run(orderId);

    txnId = Number(info.lastInsertRowid);
    db.prepare(`
      INSERT INTO failure_events (transaction_id, error_code, error_description, attempt_number)
      VALUES (?, 'GATEWAY_ERROR', 'Single gateway timeout', 1)
    `).run(txnId);

    const txn = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(txnId);
    const result = await processTransaction(txn);

    assert.ok(result);
    decisionId = result.decisionId;
    assert.equal(typeof result.recoveryProbability, 'number');
    assert.ok(result.recoveryProbability > 0 && result.recoveryProbability <= 1);

    const decision = db.prepare(`SELECT * FROM recovery_decisions WHERE id = ?`).get(result.decisionId);
    assert.ok(decision.reasoning.includes('ML Recovery Probability'));
  } finally {
    if (decisionId) {
      db.prepare(`DELETE FROM recovery_actions WHERE decision_id = ?`).run(decisionId);
      db.prepare(`DELETE FROM recovery_decisions WHERE id = ?`).run(decisionId);
    }
    if (txnId) {
      db.prepare(`DELETE FROM failure_events WHERE transaction_id = ?`).run(txnId);
      db.prepare(`DELETE FROM transactions WHERE id = ?`).run(txnId);
    }
  }
});
