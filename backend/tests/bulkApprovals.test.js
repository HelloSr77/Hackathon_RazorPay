import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb, initDb } from '../db.js';
import { bulkApproveDecisions, bulkRejectDecisions, getPendingApprovals } from '../approvalQueue.js';
import { exportAuditLogCsv } from '../audit.js';

test('bulk approve decisions approves multiple queued items', () => {
  const db = getDb();
  initDb(db);

  const uniqueId = Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  const t1 = db.prepare(`
    INSERT INTO transactions (order_id, customer_id, amount_inr, method, bank, status)
    VALUES (?, ?, 1200, 'card', 'HDFC', 'queued_for_approval')
  `).run(`order_bulk_${uniqueId}`, `cust_bulk_${uniqueId}`);
  const tid1 = Number(t1.lastInsertRowid);

  const d1 = db.prepare(`
    INSERT INTO recovery_decisions (transaction_id, root_cause, confidence, tier, action_chosen, reasoning)
    VALUES (?, 'transient_gateway_error', 0.85, 'queue', 'retry_pending_approval', 'test')
  `).run(tid1);
  const did1 = Number(d1.lastInsertRowid);

  const mockRazorpay = {
    retryPayment: () => ({ success: true, raw: { id: 'pay_mock' } })
  };

  const summary = bulkApproveDecisions([did1], mockRazorpay);
  assert.equal(summary.total, 1);
  assert.equal(summary.approved, 1);
});

test('getPendingApprovals filters by search query matching order_id or customer_id', () => {
  const db = getDb();
  initDb(db);

  const uid = Date.now() + '_srch';

  const t1 = db.prepare(`
    INSERT INTO transactions (order_id, customer_id, amount_inr, method, bank, status)
    VALUES (?, ?, 1500, 'card', 'ICICI', 'queued_for_approval')
  `).run(`order_search_target_${uid}`, `cust_alpha_${uid}`);

  const t2 = db.prepare(`
    INSERT INTO transactions (order_id, customer_id, amount_inr, method, bank, status)
    VALUES (?, ?, 2500, 'upi', 'HDFC', 'queued_for_approval')
  `).run(`order_other_${uid}`, `cust_search_target_${uid}`);

  db.prepare(`
    INSERT INTO recovery_decisions (transaction_id, root_cause, confidence, tier, action_chosen, reasoning)
    VALUES (?, 'transient_gateway_error', 0.80, 'queue', 'retry_pending_approval', 'test1')
  `).run(Number(t1.lastInsertRowid));

  db.prepare(`
    INSERT INTO recovery_decisions (transaction_id, root_cause, confidence, tier, action_chosen, reasoning)
    VALUES (?, 'auth_dropped_3ds', 0.70, 'queue', 'retry_pending_approval', 'test2')
  `).run(Number(t2.lastInsertRowid));

  // Search by order_id substring
  const resOrder = getPendingApprovals(`order_search_target_${uid}`);
  assert.equal(resOrder.length, 1);
  assert.equal(resOrder[0].order_id, `order_search_target_${uid}`);

  // Search by customer_id substring
  const resCust = getPendingApprovals(`cust_search_target_${uid}`);
  assert.equal(resCust.length, 1);
  assert.equal(resCust[0].customer_id, `cust_search_target_${uid}`);
});

test('export audit log csv generates valid CSV string with headers', () => {
  const csv = exportAuditLogCsv();
  assert.ok(csv.includes('Order ID'));
  assert.ok(csv.includes('Customer ID'));
  assert.ok(csv.includes('Amount (INR)'));
});
