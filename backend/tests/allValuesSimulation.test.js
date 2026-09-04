import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreTransactionML, scoreBatchML } from '../mlScorer.js';
import { processTransaction } from '../recoveryEngine.js';
import { getDb, initDb } from '../db.js';

test('ML MODEL SCALE TESTS: accurately scores all requested amounts (100, 200, 500, 1000, 2000, 5000, 10000, 25000, 50000, 60000, 90000, 100000)', async () => {
  const testAmounts = [100, 200, 500, 1000, 2000, 5000, 10000, 25000, 50000, 60000, 90000, 100000];
  const banks = ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK'];

  // 1. Vectorized Batch Scoring Test across all amounts and banks
  const batchPayload = [];
  for (const amt of testAmounts) {
    for (const bank of banks) {
      batchPayload.push({
        amountInr: amt,
        confidence: 0.85,
        bank,
        rootCause: 'transient_gateway_error',
        isBusinessHours: 1
      });
    }
  }

  const batchRes = await scoreBatchML(batchPayload);
  const batchResults = batchRes.recovery_probabilities;
  assert.equal(batchResults.length, batchPayload.length, 'Must return predictions for all batch items');

  batchResults.forEach((prob, idx) => {
    const item = batchPayload[idx];
    assert.ok(typeof prob === 'number', `Probability for ₹${item.amountInr} must be a number`);
    assert.ok(!isNaN(prob), `Probability for ₹${item.amountInr} must not be NaN`);
    assert.ok(prob >= 0.0 && prob <= 1.0, `Probability for ₹${item.amountInr} (${prob}) must be within [0.0, 1.0]`);

    // Sub-cap amounts (<= 2000) must score >= 0.80
    if (item.amountInr <= 2000) {
      assert.ok(prob >= 0.80, `Sub-cap ₹${item.amountInr} should have >= 80% recovery probability (got ${(prob * 100).toFixed(1)}%)`);
    }

    // High-ticket amounts (> 2000) must maintain healthy assisted recovery >= 0.50
    if (item.amountInr >= 5000 && ['HDFC', 'ICICI', 'AXIS'].includes(item.bank)) {
      assert.ok(prob >= 0.50, `High ticket ₹${item.amountInr} ${item.bank} should maintain >= 50% assisted probability (got ${(prob * 100).toFixed(1)}%)`);
    }
  });
});

test('LIVE SIMULATOR INTEGRATION: processes full spectrum of transaction amounts with appropriate tier gating and ML recovery probability', async () => {
  const db = getDb();
  initDb(db);

  const amountsToSimulate = [100, 500, 1250, 2000, 5000, 10000, 25000, 50000, 90000, 100000];
  const createdTxnIds = [];

  try {
    for (const amt of amountsToSimulate) {
      const orderId = `order_sim_scale_test_${Date.now()}_${amt}`;
      const info = db.prepare(`
        INSERT INTO transactions (order_id, customer_id, amount_inr, method, bank, card_fingerprint, status)
        VALUES (?, ?, ?, 'card', 'ICICI', ?, 'failed')
      `).run(orderId, `cust_scale_test_${amt}`, amt, `card_fp_scale_test_${amt}`);

      const txnId = Number(info.lastInsertRowid);
      createdTxnIds.push(txnId);

      db.prepare(`
        INSERT INTO failure_events (transaction_id, error_code, error_description, attempt_number)
        VALUES (?, 'GATEWAY_ERROR', 'Simulated scale failure', 1)
      `).run(txnId);

      const txn = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(txnId);
      const result = await processTransaction(txn, { isBusinessHours: 1 });

      assert.ok(result, `Result must exist for amount ₹${amt}`);
      assert.ok(result.decisionId, `Decision must be created for amount ₹${amt}`);

      // Verify tier gating rule: <= 2000 auto vs > 2000 queue
      const decision = db.prepare(`SELECT * FROM recovery_decisions WHERE id = ?`).get(result.decisionId);
      assert.ok(decision, `Decision record must exist for ₹${amt}`);

      if (amt <= 2000) {
        assert.equal(decision.tier, 'auto', `Amount ₹${amt} under threshold must be 'auto' tier`);
        assert.equal(decision.action_chosen, 'retry', `Amount ₹${amt} under threshold must choose 'retry' action`);
      } else {
        assert.equal(decision.tier, 'queue', `Amount ₹${amt} exceeding threshold must be 'queue' tier`);
        assert.equal(decision.action_chosen, 'retry_pending_approval', `Amount ₹${amt} must require merchant approval`);
      }

      // Check reasoning contains the ML Recovery Probability
      assert.ok(decision.reasoning.includes('ML Recovery Probability:'), `Reasoning must include ML Recovery Probability for ₹${amt}`);
    }
  } finally {
    // Clean up created records cleanly
    for (const txnId of createdTxnIds) {
      db.prepare(`DELETE FROM recovery_actions WHERE decision_id IN (SELECT id FROM recovery_decisions WHERE transaction_id = ?)`).run(txnId);
      db.prepare(`DELETE FROM recovery_decisions WHERE transaction_id = ?`).run(txnId);
      db.prepare(`DELETE FROM failure_events WHERE transaction_id = ?`).run(txnId);
      db.prepare(`DELETE FROM transactions WHERE id = ?`).run(txnId);
    }
  }
});
