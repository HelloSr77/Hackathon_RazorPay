import { getDb } from './db.js';
import { canRetry } from './guardrails.js';
import { RazorpayClient } from './razorpayClient.js';

export function getPendingApprovals(search = '') {
  const db = getDb();
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    const stmt = db.prepare(`
      SELECT 
        t.id as transaction_id,
        rd.id as decision_id,
        t.order_id,
        t.customer_id,
        t.amount_inr,
        t.bank,
        t.method,
        rd.root_cause,
        rd.confidence,
        rd.reasoning,
        rd.queue_reason,
        rd.decided_at
      FROM transactions t
      JOIN recovery_decisions rd ON rd.transaction_id = t.id
      WHERE t.status = 'queued_for_approval' 
        AND rd.action_chosen = 'retry_pending_approval'
        AND (t.customer_id LIKE ? OR t.order_id LIKE ?)
      ORDER BY rd.decided_at ASC
    `);
    return stmt.all(term, term);
  }

  const stmt = db.prepare(`
    SELECT 
      t.id as transaction_id,
      rd.id as decision_id,
      t.order_id,
      t.customer_id,
      t.amount_inr,
      t.bank,
      t.method,
      rd.root_cause,
      rd.confidence,
      rd.reasoning,
      rd.queue_reason,
      rd.decided_at
    FROM transactions t
    JOIN recovery_decisions rd ON rd.transaction_id = t.id
    WHERE t.status = 'queued_for_approval' AND rd.action_chosen = 'retry_pending_approval'
    ORDER BY rd.decided_at ASC
  `);
  return stmt.all();
}

export function approveDecision(decisionId, razorpay = new RazorpayClient()) {
  const db = getDb();

  const dStmt = db.prepare(`SELECT * FROM recovery_decisions WHERE id = ?`);
  const decision = dStmt.get(decisionId);
  if (!decision) return 'error: decision not found';

  const tStmt = db.prepare(`SELECT * FROM transactions WHERE id = ?`);
  const transaction = tStmt.get(decision.transaction_id);
  if (!transaction || transaction.status !== 'queued_for_approval') {
    return 'error: transaction is not awaiting approval';
  }

  const { allowed, reason } = canRetry(transaction);
  if (!allowed) {
    const actStmt = db.prepare(`
      INSERT INTO recovery_actions (decision_id, executed_at, razorpay_response, outcome, amount_recovered_inr)
      VALUES (?, datetime('now'), NULL, ?, 0.0)
    `);
    actStmt.run(decision.id, `blocked_by_guardrail_at_approval: ${reason}`);

    const upStmt = db.prepare(`UPDATE transactions SET status = 'stopped' WHERE id = ?`);
    upStmt.run(transaction.id);

    return `blocked: ${reason}`;
  }

  const result = razorpay.retryPayment(transaction.order_id, transaction.amount_inr);
  const success = result.success;

  const actStmt = db.prepare(`
    INSERT INTO recovery_actions (decision_id, executed_at, razorpay_response, outcome, amount_recovered_inr)
    VALUES (?, datetime('now'), ?, ?, ?)
  `);
  actStmt.run(
    decision.id,
    JSON.stringify(result.raw),
    success ? 'success' : 'failed',
    success ? transaction.amount_inr : 0.0
  );

  const upStmt = db.prepare(`UPDATE transactions SET status = ? WHERE id = ?`);
  upStmt.run(success ? 'recovered' : 'failed', transaction.id);

  return success ? 'recovered' : 'retry attempted, failed';
}

export function rejectDecision(decisionId, note = '') {
  const db = getDb();

  const dStmt = db.prepare(`SELECT * FROM recovery_decisions WHERE id = ?`);
  const decision = dStmt.get(decisionId);
  if (!decision) return 'error: decision not found';

  const tStmt = db.prepare(`SELECT * FROM transactions WHERE id = ?`);
  const transaction = tStmt.get(decision.transaction_id);
  if (!transaction || transaction.status !== 'queued_for_approval') {
    return 'error: transaction is not awaiting approval';
  }

  const outcomeStr = 'rejected_by_merchant' + (note ? `: ${note}` : '');
  const actStmt = db.prepare(`
    INSERT INTO recovery_actions (decision_id, executed_at, razorpay_response, outcome, amount_recovered_inr)
    VALUES (?, datetime('now'), NULL, ?, 0.0)
  `);
  actStmt.run(decision.id, outcomeStr);

  const upStmt = db.prepare(`UPDATE transactions SET status = 'stopped' WHERE id = ?`);
  upStmt.run(transaction.id);

  return 'rejected';
}

export function bulkApproveDecisions(decisionIds = [], razorpay = new RazorpayClient()) {
  const results = [];
  for (const id of decisionIds) {
    const res = approveDecision(id, razorpay);
    results.push({ decisionId: id, result: res });
  }
  return {
    total: results.length,
    approved: results.filter(r => r.result === 'recovered').length,
    failed: results.filter(r => r.result !== 'recovered').length,
    results
  };
}

export function bulkRejectDecisions(decisionIds = [], note = '') {
  const results = [];
  for (const id of decisionIds) {
    const res = rejectDecision(id, note);
    results.push({ decisionId: id, result: res });
  }
  return {
    total: results.length,
    rejected: results.filter(r => r.result === 'rejected').length,
    results
  };
}
