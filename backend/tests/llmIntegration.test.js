import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiClassify, ruleBasedClassify, classifyRootCause, generateGeminiDiagnosticReasoning } from '../classifier.js';
import { processTransaction } from '../recoveryEngine.js';
import { getDb, initDb } from '../db.js';

test('LLM INTEGRATION: geminiClassify generates comprehensive cognitive diagnostic reasoning', async () => {
  const errorCodes = [
    { code: 'GATEWAY_ERROR', prior: 0, expectedCause: 'transient_gateway_error' },
    { code: 'authentication_failed', prior: 0, expectedCause: 'auth_dropped_3ds' },
    { code: 'payment_cancelled', prior: 0, expectedCause: 'user_abandoned_checkout' },
    { code: 'insufficient_funds', prior: 0, expectedCause: 'insufficient_funds' },
    { code: 'card_declined', prior: 2, expectedCause: 'dead_card' }
  ];

  for (const item of errorCodes) {
    const res = await geminiClassify(item.code, 1, item.prior, 1500, 'card', 'HDFC');
    assert.ok(res, `Result must exist for ${item.code}`);
    assert.equal(res.root_cause, item.expectedCause, `Root cause must match for ${item.code}`);
    assert.ok(res.confidence >= 0.70, `Confidence must be high for known patterns (${res.confidence})`);
    assert.ok(res.reasoning.length > 80, `LLM reasoning must be deep and descriptive (got ${res.reasoning.length} chars)`);
    assert.ok(res.reasoning.includes('strategy') || res.reasoning.includes('diagnosis') || res.reasoning.includes('recommendation') || res.reasoning.includes('analysis'), 'LLM reasoning must include strategic advice');
    assert.ok(res.llm_provider.includes('Gemini'), `Provider must attribute to Gemini`);
  }
});

test('LLM ROUTING: classifyRootCause toggles seamlessly between Gemini and Rule-Based engine', async () => {
  // 1. LLM / Gemini Mode
  const geminiRes = await classifyRootCause('GATEWAY_ERROR', 1, 0, 1000, 'card', { provider: 'gemini', bank: 'ICICI' });
  assert.equal(geminiRes.root_cause, 'transient_gateway_error');
  assert.ok(geminiRes.llm_provider.includes('Gemini'));
  assert.ok(geminiRes.reasoning.length > 100, 'Gemini reasoning should be comprehensive');

  // 2. Deterministic Rule-Based Mode
  const ruleRes = await classifyRootCause('GATEWAY_ERROR', 1, 0, 1000, 'card', { provider: 'rule', bank: 'ICICI' });
  assert.equal(ruleRes.root_cause, 'transient_gateway_error');
  assert.equal(ruleRes.confidence, 0.85);
  assert.equal(ruleRes.reasoning, 'Downstream payment gateway timeout detected with zero historical decline velocity.');
});

test('END-TO-END PIPELINE: combines Gemini LLM reasoning with Gradient Boosting ML scoring and 5-step execution pipeline', async () => {
  const db = getDb();
  initDb(db);

  const orderId = `order_sim_llm_test_${Date.now()}`;
  const info = db.prepare(`
    INSERT INTO transactions (order_id, customer_id, amount_inr, method, bank, card_fingerprint, status)
    VALUES (?, 'cust_llm_test', 1250, 'card', 'KOTAK', 'card_fp_llm_test', 'failed')
  `).run(orderId);

  const txnId = Number(info.lastInsertRowid);
  db.prepare(`
    INSERT INTO failure_events (transaction_id, error_code, error_description, attempt_number)
    VALUES (?, 'GATEWAY_ERROR', 'HTTP 504 Gateway Timeout from switch', 1)
  `).run(txnId);

  try {
    const txn = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(txnId);
    const result = await processTransaction(txn, { isBusinessHours: 1, llmProvider: 'gemini' });

    // 1. Verify LLM Attribution & Reasoning
    assert.ok(result.llmProvider.includes('Gemini'), `Must attribute to Gemini (got ${result.llmProvider})`);
    assert.ok(result.llmReasoning.length > 50, 'LLM Reasoning must be rich and descriptive');

    // 2. Verify ML Recovery Probability Integration
    assert.ok(typeof result.recoveryProbability === 'number', 'ML recovery probability must be computed');
    assert.ok(result.recoveryProbability >= 0.85, `₹1,250 HDFC Gateway timeout must have high recovery probability (got ${(result.recoveryProbability * 100).toFixed(1)}%)`);

    // 3. Verify 5-Step Execution Pipeline
    assert.ok(Array.isArray(result.executionSteps), 'Must return executionSteps array');
    assert.equal(result.executionSteps.length, 5, 'Execution pipeline must contain exactly 5 steps');

    const stepTitles = result.executionSteps.map(s => s.title);
    assert.ok(stepTitles.includes('Webhook Event Ingested'));
    assert.ok(stepTitles.includes('LLM Cognitive Root Cause Diagnosis'));
    assert.ok(stepTitles.includes('Compliance & Safety Guardrails'));
    assert.ok(stepTitles.includes('Gradient Boosting Predictive Scorer'));
    assert.ok(stepTitles.includes('Autonomous Action Execution'));
  } finally {
    db.prepare(`DELETE FROM recovery_actions WHERE decision_id IN (SELECT id FROM recovery_decisions WHERE transaction_id = ?)`).run(txnId);
    db.prepare(`DELETE FROM recovery_decisions WHERE transaction_id = ?`).run(txnId);
    db.prepare(`DELETE FROM failure_events WHERE transaction_id = ?`).run(txnId);
    db.prepare(`DELETE FROM transactions WHERE id = ?`).run(txnId);
  }
});
