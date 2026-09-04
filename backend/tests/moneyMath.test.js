import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { headlineMetrics, rootCauseMoneyBreakdown } from '../audit.js';
import { processTransaction } from '../recoveryEngine.js';
import { approveDecision } from '../approvalQueue.js';
import { getDb } from '../db.js';

// Deterministic Mock Razorpay Client (all auto-retries succeed)
class DeterministicMockRazorpay {
  retryPayment(orderId, amountInr) {
    return {
      success: true,
      raw: { id: `pay_det_${Date.now()}`, status: 'captured', order_id: orderId, amount: amountInr * 100 }
    };
  }
  async sendNudge(customerId, orderId, amountInr) {
    return { success: true, raw: { status: 'sent', order_id: orderId } };
  }
}

test('MONEY MATH: synthetic batch produces exact total recovered amount, recovery rate, and root-cause breakdown', async () => {
  const db = getDb();
  const mockRzp = new DeterministicMockRazorpay();

  // Clear previous test records to ensure isolated, pure math assertions
  db.exec(`
    DELETE FROM recovery_actions;
    DELETE FROM recovery_decisions;
    DELETE FROM failure_events;
    DELETE FROM transactions;
  `);

  // Define synthetic batch with known amounts totaling exactly ₹10,000 across 9 transactions
  const deadCardFp = 'fp_dead_card_test_99';
  const deadCustId = 'cust_dead_test_99';

  const batchDefinitions = [
    // 1. Transient gateway error (under ₹2000 cap) -> Auto-recovers ₹1,000
    { orderId: 'ord_math_1', custId: 'c1', amount: 1000, method: 'card', bank: 'ICICI', err: 'GATEWAY_ERROR', cardFp: 'fp_card_1', attempt: 1 },
    // 2. Transient gateway error (under ₹2000 cap) -> Auto-recovers ₹1,500
    { orderId: 'ord_math_2', custId: 'c2', amount: 1500, method: 'card', bank: 'AXIS', err: 'GATEWAY_ERROR', cardFp: 'fp_card_2', attempt: 1 },
    // 3. Transient gateway error (under ₹2000 cap) -> Auto-recovers ₹800
    { orderId: 'ord_math_3', custId: 'c3', amount: 800, method: 'upi', bank: 'SBI', err: 'GATEWAY_ERROR', cardFp: null, attempt: 1 },
    // 4. Transient gateway error (> ₹2000 cap) -> Queued for approval (₹0 auto-recovered)
    { orderId: 'ord_math_4', custId: 'c4', amount: 3500, method: 'card', bank: 'HDFC', err: 'GATEWAY_ERROR', cardFp: 'fp_card_4', attempt: 1 },
    // 5. User checkout abandonment -> Queued for review (₹0 auto-recovered)
    { orderId: 'ord_math_5', custId: 'c5', amount: 1200, method: 'card', bank: 'KOTAK', err: 'payment_cancelled', cardFp: 'fp_card_5', attempt: 1 },
    // 6. Prior decline 1 on dead card -> ₹500
    { orderId: 'ord_math_6_1', custId: deadCustId, amount: 500, method: 'card', bank: 'ICICI', err: 'insufficient_funds', cardFp: deadCardFp, attempt: 1 },
    // 7. Prior decline 2 on dead card -> ₹500
    { orderId: 'ord_math_6_2', custId: deadCustId, amount: 500, method: 'card', bank: 'ICICI', err: 'insufficient_funds', cardFp: deadCardFp, attempt: 2 },
    // 8. 3rd decline on same dead card -> ₹500 (Triggers dead_card stop guardrail)
    { orderId: 'ord_math_6_3', custId: deadCustId, amount: 500, method: 'card', bank: 'ICICI', err: 'insufficient_funds', cardFp: deadCardFp, attempt: 3 },
    // 9. Unknown error (low confidence) -> Stopped by design (₹0 recovered)
    { orderId: 'ord_math_7', custId: 'c7', amount: 500, method: 'netbanking', bank: 'SBI', err: 'UNKNOWN_TERMINAL_ERR', cardFp: null, attempt: 1 },
  ];

  const createdTxns = [];

  for (const item of batchDefinitions) {
    const insInfo = db.prepare(`
      INSERT INTO transactions (order_id, customer_id, amount_inr, method, bank, card_fingerprint, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'failed', datetime('now'))
    `).run(item.orderId, item.custId, item.amount, item.method, item.bank, item.cardFp);

    const txnId = Number(insInfo.lastInsertRowid);

    db.prepare(`
      INSERT INTO failure_events (transaction_id, error_code, error_description, attempt_number)
      VALUES (?, ?, 'Batch test failure', ?)
    `).run(txnId, item.err, item.attempt);

    const txn = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(txnId);
    createdTxns.push(txn);
  }

  // Process all transactions through the recovery engine
  for (const txn of createdTxns) {
    await processTransaction(txn, mockRzp);
  }

  // 1. Assert Batch Headline Money Metrics
  const metrics = headlineMetrics();

  // Total at-risk amount across batch: 1000 + 1500 + 800 + 3500 + 1200 + 500 + 500 + 500 + 500 = 10,000 INR
  assert.equal(metrics.total_amount_inr, 10000.00, 'Total batch amount must equal ₹10,000');
  assert.equal(metrics.total_at_risk_inr, 10000.00, 'Total at-risk amount must equal ₹10,000');

  // Total recovered: 1000 + 1500 + 800 = ₹3,300.00
  assert.equal(metrics.total_recovered_inr, 3300.00, 'Total recovered must equal ₹3,300');

  // Recovery Rate: (3300 / 10000) * 100 = 33.0%
  assert.equal(metrics.recovery_rate_pct, 33.0, 'Batch recovery rate must be exactly 33.0%');

  // Transaction Counts
  assert.equal(metrics.total_transactions, 9, 'Must process exactly 9 transactions');
  assert.equal(metrics.recovered_transactions, 3, 'Must have exactly 3 recovered transactions');
  assert.equal(metrics.queued_for_approval_transactions, 2, 'Must have exactly 2 queued transactions (high amount & cancelled checkout)');

  // 2. Assert Headline Stat String
  assert.match(metrics.headline_stat, /₹3,300 of ₹10,000 at-risk recovered \(33\.0%\) across 9 transactions/);

  // 3. Assert Root-Cause Breakdown Money Math
  const rootBreakdown = rootCauseMoneyBreakdown();
  
  // Find transient_gateway_error: 4 txns, at-risk ₹6,800, recovered ₹3,300 (48.5%)
  const gatewayRow = rootBreakdown.find(r => r.root_cause === 'transient_gateway_error');
  assert.ok(gatewayRow, 'Must include transient_gateway_error breakdown');
  assert.equal(gatewayRow.total_transactions, 4);
  assert.equal(gatewayRow.at_risk_inr, 6800);
  assert.equal(gatewayRow.recovered_inr, 3300);
  assert.equal(gatewayRow.recovery_rate_pct, 48.5);
  assert.equal(gatewayRow.recovered_transactions, 3);

  // Find dead_card (the 3rd decline triggered dead_card)
  const deadCardRow = rootBreakdown.find(r => r.root_cause === 'dead_card');
  assert.ok(deadCardRow, 'Must include dead_card breakdown');
  assert.equal(deadCardRow.recovered_inr, 0);
  assert.equal(deadCardRow.recovery_rate_pct, 0.0);

  // 4. Assert Money Math Updates Dynamically on Merchant Approval
  // Locate the queued decision for ord_math_4 (₹3,500)
  const queuedTxn = db.prepare(`SELECT id FROM transactions WHERE order_id = 'ord_math_4'`).get();
  const queuedDecision = db.prepare(`SELECT id, queue_reason FROM recovery_decisions WHERE transaction_id = ?`).get(queuedTxn.id);
  assert.ok(queuedDecision, 'Queued decision must exist');
  assert.match(queuedDecision.queue_reason, /exceeds auto-recovery cap of ₹2,000/);

  // Merchant approves ord_math_4
  const approveResult = approveDecision(queuedDecision.id, mockRzp);
  assert.equal(approveResult, 'recovered');

  // Re-check metrics after approval
  const updatedMetrics = headlineMetrics();
  // New recovered: 3300 + 3500 = ₹6,800
  assert.equal(updatedMetrics.total_recovered_inr, 6800.00, 'Total recovered must update to ₹6,800 after approval');
  // New recovery rate: (6800 / 10000) * 100 = 68.0%
  assert.equal(updatedMetrics.recovery_rate_pct, 68.0, 'Recovery rate must update to 68.0%');
  assert.equal(updatedMetrics.recovered_transactions, 4, 'Recovered count must increment to 4');
  assert.equal(updatedMetrics.queued_for_approval_transactions, 1, 'Queued count must decrement to 1');
});
