import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb, initDb } from '../db.js';
import { processTransaction } from '../recoveryEngine.js';

test('transaction failure simulator processes single transaction live', async () => {
  const db = getDb();
  initDb(db);

  const orderId = `order_sim_test_${Date.now()}`;
  const info = db.prepare(`
    INSERT INTO transactions (order_id, customer_id, amount_inr, method, bank, card_fingerprint, status)
    VALUES (?, 'cust_sim_test', 850, 'card', 'ICICI', 'card_sim_test', 'failed')
  `).run(orderId);

  const txnId = Number(info.lastInsertRowid);
  let decisionId = null;

  try {
    db.prepare(`
      INSERT INTO failure_events (transaction_id, error_code, error_description, attempt_number)
      VALUES (?, 'GATEWAY_ERROR', 'Simulated test failure', 1)
    `).run(txnId);

    const txn = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(txnId);
    const result = await processTransaction(txn);

    assert.ok(result);
    assert.ok(result.decisionId);
    decisionId = result.decisionId;
    assert.ok(result.newStatus);
  } finally {
    if (decisionId) {
      db.prepare(`DELETE FROM recovery_actions WHERE decision_id = ?`).run(decisionId);
      db.prepare(`DELETE FROM recovery_decisions WHERE id = ?`).run(decisionId);
    }
    db.prepare(`DELETE FROM failure_events WHERE transaction_id = ?`).run(txnId);
    db.prepare(`DELETE FROM transactions WHERE id = ?`).run(txnId);
  }
});
