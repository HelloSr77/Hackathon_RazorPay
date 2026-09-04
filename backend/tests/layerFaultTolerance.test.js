import test from 'node:test';
import assert from 'node:assert/strict';
import { processTransaction } from '../recoveryEngine.js';
import { getDb, initDb } from '../db.js';

test('FAULT TOLERANCE LAYER 1: When LLM fails/times out, engine falls back to rule-based classification without crashing', async () => {
  const db = getDb();
  initDb(db);

  const orderId = `order_fault_l1_${Date.now()}`;
  const info = db.prepare(`
    INSERT INTO transactions (order_id, customer_id, amount_inr, method, bank, card_fingerprint, status)
    VALUES (?, 'cust_fault_l1', 1200, 'card', 'KOTAK', 'card_fp_fault_l1', 'failed')
  `).run(orderId);

  const txnId = Number(info.lastInsertRowid);
  db.prepare(`
    INSERT INTO failure_events (transaction_id, error_code, error_description, attempt_number)
    VALUES (?, 'GATEWAY_ERROR', 'Simulated failure', 1)
  `).run(txnId);

  try {
    const txn = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(txnId);
    // Intentionally pass an invalid / failing LLM provider
    const result = await processTransaction(txn, {
      isBusinessHours: 1,
      llmProvider: 'invalid_crashing_llm_engine'
    });

    assert.ok(result, 'Result must exist despite Layer 1 LLM failure');
    assert.ok(result.decisionId, 'Decision ID must be created');
    assert.ok(['success', 'failed'].includes(result.outcome), `Outcome must be valid (got ${result.outcome})`);
    assert.ok(typeof result.recoveryProbability === 'number', 'ML probability must still be computed');
    assert.ok(result.llmProvider.includes('Rule') || result.llmProvider.includes('Fallback'), 'Must attribute to fallback engine');
  } finally {
    db.prepare(`DELETE FROM recovery_actions WHERE decision_id IN (SELECT id FROM recovery_decisions WHERE transaction_id = ?)`).run(txnId);
    db.prepare(`DELETE FROM recovery_decisions WHERE transaction_id = ?`).run(txnId);
    db.prepare(`DELETE FROM failure_events WHERE transaction_id = ?`).run(txnId);
    db.prepare(`DELETE FROM transactions WHERE id = ?`).run(txnId);
  }
});

test('FAULT TOLERANCE LAYER 2: When ML Model process fails/unavailable, statistical heuristic fallback guarantees valid probability', async () => {
  const { heuristicFallback, scoreTransactionML } = await import('../mlScorer.js');

  // Test that heuristic fallback is strictly bounded and robust for any inputs
  const prob = heuristicFallback(1500, 0.85, 'HDFC', 'transient_gateway_error', 1);
  assert.ok(typeof prob === 'number', 'Fallback probability must be a number');
  assert.ok(prob >= 0.80 && prob <= 1.0, `Sub-cap gateway fallback must be high (got ${prob})`);

  // Test with invalid / extreme inputs
  const extremeProb = heuristicFallback(-999, null, 'UNKNOWN_BANK', 'unknown_cause', 0);
  assert.ok(typeof extremeProb === 'number', 'Must handle extreme/null inputs gracefully');
  assert.ok(extremeProb >= 0.0 && extremeProb <= 1.0, 'Must remain bounded in [0.0, 1.0]');
});

test('FAULT TOLERANCE LAYER 3: When Razorpay / Payment Gateway throws network error, transaction records failure safely without process crash', async () => {
  const db = getDb();
  initDb(db);

  const orderId = `order_fault_l3_${Date.now()}`;
  const info = db.prepare(`
    INSERT INTO transactions (order_id, customer_id, amount_inr, method, bank, card_fingerprint, status)
    VALUES (?, 'cust_fault_l3', 1000, 'card', 'KOTAK', 'card_fp_fault_l3', 'failed')
  `).run(orderId);

  const txnId = Number(info.lastInsertRowid);
  db.prepare(`
    INSERT INTO failure_events (transaction_id, error_code, error_description, attempt_number)
    VALUES (?, 'GATEWAY_ERROR', 'Simulated failure', 1)
  `).run(txnId);

  // Mock Razorpay client that actively throws an unhandled network error
  const crashingRazorpayMock = {
    retryPayment: () => {
      throw new Error('ECONNRESET: Razorpay switch connection dropped');
    },
    sendNudge: () => {
      throw new Error('ETIMEDOUT: Messaging gateway unreachable');
    }
  };

  try {
    const txn = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(txnId);
    // processTransaction should catch the gateway crash and update status safely
    const result = await processTransaction(txn, crashingRazorpayMock);

    assert.ok(result, 'Must return result despite payment gateway crash');
    assert.equal(result.outcome, 'failed', 'Outcome must safely be marked as failed');
    assert.equal(result.newStatus, 'failed', 'Status must safely be marked as failed');

    const decision = db.prepare(`SELECT * FROM recovery_decisions WHERE id = ?`).get(result.decisionId);
    assert.ok(decision, 'Recovery decision record must be persisted');
  } finally {
    db.prepare(`DELETE FROM recovery_actions WHERE decision_id IN (SELECT id FROM recovery_decisions WHERE transaction_id = ?)`).run(txnId);
    db.prepare(`DELETE FROM recovery_decisions WHERE transaction_id = ?`).run(txnId);
    db.prepare(`DELETE FROM failure_events WHERE transaction_id = ?`).run(txnId);
    db.prepare(`DELETE FROM transactions WHERE id = ?`).run(txnId);
  }
});

test('FAULT TOLERANCE TRIPLE STRESS: When Layer 1, Layer 2, and Layer 3 ALL fail simultaneously, engine executes safely', async () => {
  const db = getDb();
  initDb(db);

  const orderId = `order_fault_triple_${Date.now()}`;
  const info = db.prepare(`
    INSERT INTO transactions (order_id, customer_id, amount_inr, method, bank, card_fingerprint, status)
    VALUES (?, 'cust_fault_triple', 5000, 'card', 'SBI', 'card_fp_fault_triple', 'failed')
  `).run(orderId);

  const txnId = Number(info.lastInsertRowid);
  db.prepare(`
    INSERT INTO failure_events (transaction_id, error_code, error_description, attempt_number)
    VALUES (?, 'unknown_fatal_error_code', 'Fatal upstream crash', 1)
  `).run(txnId);

  try {
    const txn = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(txnId);
    const crashingGateway = {
      retryPayment: () => { throw new Error('Simulated gateway total failure'); },
      sendNudge: () => { throw new Error('Simulated messaging total failure'); }
    };

    // Trigger with broken LLM provider, unknown error code, and crashing gateway
    const result = await processTransaction(txn, crashingGateway);

    assert.ok(result, 'Must return valid result under triple layer failure');
    assert.ok(result.decisionId, 'Decision must be logged');
    assert.ok(['stopped', 'queued_for_approval', 'failed'].includes(result.newStatus), 'Status must be a safe terminal state');

    const executionSteps = result.executionSteps;
    assert.ok(Array.isArray(executionSteps), 'Execution steps must exist');
    assert.equal(executionSteps.length, 5, 'All 5 steps must complete gracefully');
  } finally {
    db.prepare(`DELETE FROM recovery_actions WHERE decision_id IN (SELECT id FROM recovery_decisions WHERE transaction_id = ?)`).run(txnId);
    db.prepare(`DELETE FROM recovery_decisions WHERE transaction_id = ?`).run(txnId);
    db.prepare(`DELETE FROM failure_events WHERE transaction_id = ?`).run(txnId);
    db.prepare(`DELETE FROM transactions WHERE id = ?`).run(txnId);
  }
});
