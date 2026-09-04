process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../server.js';
import { getDb } from '../db.js';

let server;
let baseUrl;

test.before(() => {
  return new Promise((resolve) => {
    // Listen on ephemeral port for tests
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

test.after(() => {
  return new Promise((resolve) => {
    server.close(resolve);
  });
});

test('POST /api/score: single transaction scoring returns valid probability and model name', async () => {
  const res = await fetch(`${baseUrl}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amountInr: 1200,
      confidence: 0.85,
      bank: 'HDFC',
      rootCause: 'transient_gateway_error',
      isBusinessHours: 1
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.equal(typeof data.recovery_probability, 'number');
  assert.ok(data.recovery_probability >= 0 && data.recovery_probability <= 1);
  assert.ok(data.recovery_probability > 0.70);
  assert.equal(data.model, 'recovery_model_gradient_boosting.joblib');
});

test('POST /api/score: batch transaction scoring evaluates all items in a single request', async () => {
  const res = await fetch(`${baseUrl}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { amountInr: 500, bank: 'HDFC', confidence: 0.85, rootCause: 'transient_gateway_error', isBusinessHours: 1 },
      { amountInr: 1500, bank: 'ICICI', confidence: 0.85, rootCause: 'transient_gateway_error', isBusinessHours: 1 },
      { amountInr: 5000, bank: 'SBI', confidence: 0.85, rootCause: 'transient_gateway_error', isBusinessHours: 0 }
    ])
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.equal(data.count, 3);
  assert.equal(data.results.length, 3);

  // Assert each item has a valid numeric recovery probability
  for (const item of data.results) {
    assert.equal(typeof item.recovery_probability, 'number');
    assert.ok(item.recovery_probability >= 0.0 && item.recovery_probability <= 1.0);
  }

  // Low amount HDFC should have higher probability than high amount SBI night
  assert.ok(data.results[0].recovery_probability > data.results[2].recovery_probability);
});

test('POST /api/simulator/trigger: live failure simulator returns recoveryProbability', async () => {
  const db = getDb();
  const res = await fetch(`${baseUrl}/api/simulator/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      errorCode: 'GATEWAY_ERROR',
      bank: 'ICICI',
      amountInr: 1100,
      priorFailures: 0
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(data.orderId);
  assert.ok(data.decision);
  assert.notEqual(data.recoveryProbability, null);
  assert.equal(typeof data.recoveryProbability, 'number');
  assert.ok(data.recoveryProbability >= 0 && data.recoveryProbability <= 1);

  // Clean up simulated test rows
  try {
    const txn = db.prepare(`SELECT id FROM transactions WHERE order_id = ?`).get(data.orderId);
    if (txn) {
      db.prepare(`DELETE FROM recovery_actions WHERE decision_id IN (SELECT id FROM recovery_decisions WHERE transaction_id = ?)`).run(txn.id);
      db.prepare(`DELETE FROM recovery_decisions WHERE transaction_id = ?`).run(txn.id);
      db.prepare(`DELETE FROM failure_events WHERE transaction_id = ?`).run(txn.id);
      db.prepare(`DELETE FROM transactions WHERE id = ?`).run(txn.id);
    }
  } catch (_) {}
});
