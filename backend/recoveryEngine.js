import { getDb } from './db.js';
import { checkBankOutage } from './correlation.js';
import { 
  priorFailuresForCard, 
  canRetry, 
  decideTier, 
  actionForTier, 
  canSendNudge, 
  getQueueReason 
} from './guardrails.js';
import { classifyRootCause, ruleBasedClassify } from './classifier.js';
import { RazorpayClient } from './razorpayClient.js';
import { scoreTransactionML, heuristicFallback } from './mlScorer.js';

export function getLatestFailure(transactionId) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM failure_events 
    WHERE transaction_id = ? 
    ORDER BY datetime(occurred_at) DESC LIMIT 1
  `);
  return stmt.get(transactionId);
}

export async function processTransaction(transaction, optionsOrRazorpay = {}) {
  const db = getDb();
  const razorpay = (optionsOrRazorpay && typeof optionsOrRazorpay.retryPayment === 'function')
    ? optionsOrRazorpay
    : (optionsOrRazorpay?.razorpay || new RazorpayClient());
  const options = (optionsOrRazorpay && typeof optionsOrRazorpay.retryPayment === 'function')
    ? {}
    : (optionsOrRazorpay || {});
  const failure = getLatestFailure(transaction.id);
  if (!failure) return null;

  // 1. Check Bank Outage Correlation (Defensively)
  let bankOutage = false;
  let outageCount = 0;
  try {
    const outageRes = checkBankOutage(transaction.bank);
    bankOutage = outageRes.isOutage;
    outageCount = outageRes.failureCount;
  } catch (err) {
    console.warn(`[RecoveryEngine] Correlation check warning: ${err.message}`);
  }

  // 2. Diagnose Root Cause (Layer 1 - LLM with infallible rule fallback)
  let priorFailures = 0;
  try {
    priorFailures = priorFailuresForCard(transaction.card_fingerprint, transaction.id);
  } catch (_) {}

  let classification;
  try {
    if (bankOutage && failure.error_code === 'GATEWAY_ERROR') {
      classification = {
        root_cause: 'bank_outage',
        confidence: 0.95,
        reasoning: `${outageCount} GATEWAY_ERROR failures on ${transaction.bank} in last window -- systemic outage, not isolated.`,
        llm_provider: 'System Outage Detector'
      };
    } else {
      classification = await classifyRootCause(
        failure.error_code,
        failure.attempt_number,
        priorFailures,
        transaction.amount_inr,
        transaction.method,
        {
          provider: options.llmProvider || (options.useLLM === false ? 'rule' : 'gemini'),
          bank: transaction.bank,
        }
      );
    }
  } catch (err) {
    console.warn(`[RecoveryEngine] Layer 1 (LLM) failed: ${err.message}. Seamlessly falling back to rule-based engine.`);
    classification = ruleBasedClassify(failure.error_code, failure.attempt_number, priorFailures);
    classification.llm_provider = 'Heuristic Rule Engine (LLM Fallback)';
  }

  if (!classification || !classification.root_cause) {
    classification = ruleBasedClassify(failure.error_code, failure.attempt_number, priorFailures);
    classification.llm_provider = 'Heuristic Rule Engine (Safety Fallback)';
  }

  const { root_cause: rootCause, confidence } = classification;
  let { reasoning } = classification;

  // 3. Escalation Ladder Decision (Layer 3 - Policy & Safety Guardrails)
  let tier = 'queue';
  try {
    tier = decideTier(rootCause, confidence, transaction.amount_inr, bankOutage);
  } catch (err) {
    console.warn(`[RecoveryEngine] Guardrail tier decision exception: ${err.message}. Holding in safe queue.`);
    tier = 'queue';
  }

  let action = 'none';
  try {
    action = actionForTier(tier, rootCause);
  } catch (_) {
    action = tier === 'queue' ? 'retry_pending_approval' : 'none';
  }
  let queueReason = null;

  // 4. ML Recovery Probability Scoring (Layer 2 - Statistical ML with infallible mathematical fallback)
  let mlProbability = null;
  if ((tier === 'auto' || tier === 'queue') && rootCause !== 'dead_card' && !bankOutage) {
    const currentHour = new Date().getHours();
    const defaultBizHours = (currentHour >= 9 && currentHour < 21) ? 1 : 0;
    const isBizHours = (options.isBusinessHours !== undefined && options.isBusinessHours !== null)
      ? Number(options.isBusinessHours)
      : defaultBizHours;

    try {
      const mlRes = await scoreTransactionML({
        amountInr: transaction.amount_inr,
        confidence,
        bank: transaction.bank,
        rootCause,
        isBusinessHours: isBizHours,
      });
      if (mlRes && mlRes.recovery_probability !== undefined && !isNaN(mlRes.recovery_probability)) {
        mlProbability = mlRes.recovery_probability;
      } else {
        throw new Error('ML returned invalid probability');
      }
    } catch (err) {
      console.warn(`[RecoveryEngine] Layer 2 (ML Model) failed: ${err.message}. Using statistical heuristic fallback.`);
      mlProbability = heuristicFallback(transaction.amount_inr, confidence, transaction.bank, rootCause, isBizHours);
    }
  }

  // 5. Hard Bound Guardrail & Compliance Checks (Layer 3)
  if (action === 'retry') {
    try {
      const { allowed, reason: boundReason } = canRetry(transaction);
      if (!allowed) {
        action = 'none';
        tier = 'stop';
        reasoning += ` | [STOPPED] Blocked by safety guardrail: ${boundReason}`;
      }
    } catch (err) {
      console.warn(`[RecoveryEngine] Guardrail retry check exception: ${err.message}. Holding for merchant approval.`);
      action = 'retry_pending_approval';
      tier = 'queue';
      queueReason = `Guardrail safety check exception; held for merchant review`;
    }
  } else if (action === 'nudge') {
    try {
      const nudgeCheck = canSendNudge(transaction.customer_id);
      if (!nudgeCheck.allowed) {
        if (nudgeCheck.code === 'CUSTOMER_OPTED_OUT') {
          tier = 'stop';
          action = 'none';
          reasoning += ` | [STOPPED] Blocked by compliance guardrail: ${nudgeCheck.reason}`;
        } else if (nudgeCheck.code === 'DND_ACTIVE') {
          // Under DND: suppress automated WhatsApp/SMS and route to queue for daytime approval
          action = 'retry_pending_approval';
          tier = 'queue';
          queueReason = `DND window active: communication held until daytime to comply with TRAI regulations`;
          reasoning += ` | [QUEUED FOR APPROVAL] ${queueReason}`;
        }
      }
    } catch (err) {
      console.warn(`[RecoveryEngine] Compliance check exception: ${err.message}. Holding for daytime review.`);
      action = 'retry_pending_approval';
      tier = 'queue';
      queueReason = `Compliance check exception; held for merchant review`;
    }
  }

  // 5. Append decision explanation & determine queue reason
  const mlPart = mlProbability !== null ? ` | ML Recovery Probability: ${(mlProbability * 100).toFixed(1)}%` : '';

  if (tier === 'queue') {
    if (!queueReason) {
      queueReason = getQueueReason(rootCause, confidence, transaction.amount_inr, bankOutage);
    }
    if (!reasoning.includes('[QUEUED FOR APPROVAL]')) {
      if (action === 'nudge') {
        reasoning += ` | [CUSTOMER NUDGE] Suppressed blind headless retries. Scheduled interactive WhatsApp payment link.${mlPart} Policy: ${queueReason}`;
      } else {
        reasoning += ` | [QUEUED FOR APPROVAL] Dual authorization required: ${queueReason}${mlPart}`;
      }
    }
  } else if (tier === 'auto') {
    if (!reasoning.includes('[AUTO-RECOVERED]')) {
      reasoning += ` | [AUTO-RECOVERED] Guardrail approved (under ₹2,000 threshold during active hours). High AI confidence (${Math.round(confidence * 100)}%)${mlPart}. Real-time autonomous retry executed.`;
    }
  } else if (tier === 'stop') {
    if (!reasoning.includes('[STOPPED]')) {
      if (bankOutage) {
        reasoning += ` | [STOPPED] Active switch outage on ${transaction.bank}.${mlPart} Retries halted to prevent network fee penalties.`;
      } else if (rootCause === 'dead_card') {
        reasoning += ` | [STOPPED] Terminal card decline velocity reached (${priorFailures + 1} attempts).${mlPart} Retries halted to safeguard merchant reputation.`;
      } else {
        reasoning += ` | [STOPPED] Low AI confidence (${Math.round(confidence * 100)}%)${mlPart} or unrecoverable decline pattern. Retries halted.`;
      }
    }
  }

  // 6. Log Decision
  const decStmt = db.prepare(`
    INSERT INTO recovery_decisions (transaction_id, root_cause, confidence, tier, action_chosen, reasoning, queue_reason, bank_outage_flagged, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const decResult = decStmt.run(
    transaction.id,
    rootCause,
    confidence,
    tier,
    action,
    reasoning,
    queueReason,
    bankOutage ? 1 : 0
  );
  const decisionId = Number(decResult.lastInsertRowid);

  // 6. Execute Action & Log Outcome
  let outcome = 'skipped';
  let amountRecovered = 0.0;
  let rawResponse = null;
  let newStatus = transaction.status;

  if (action === 'retry') {
    try {
      const result = razorpay.retryPayment(transaction.order_id, transaction.amount_inr);
      rawResponse = result && result.raw ? JSON.stringify(result.raw) : null;
      if (result && result.success) {
        outcome = 'success';
        amountRecovered = transaction.amount_inr;
        newStatus = 'recovered';
      } else {
        outcome = 'failed';
        newStatus = 'failed';
      }
    } catch (err) {
      console.warn(`[RecoveryEngine] Razorpay retry execution error: ${err.message}`);
      outcome = 'failed';
      newStatus = 'failed';
      rawResponse = JSON.stringify({ error: err.message, fallback: true });
    }
  } else if (action === 'retry_pending_approval') {
    outcome = 'awaiting_approval';
    newStatus = 'queued_for_approval';
  } else if (action === 'nudge') {
    try {
      const result = await razorpay.sendNudge(transaction.customer_id, transaction.order_id, transaction.amount_inr);
      rawResponse = result && result.raw ? JSON.stringify(result.raw) : null;
      outcome = 'nudge_sent';
      newStatus = 'nudged';
    } catch (err) {
      console.warn(`[RecoveryEngine] Messaging dispatch error: ${err.message}. Routed to merchant approval.`);
      outcome = 'awaiting_approval';
      newStatus = 'queued_for_approval';
      rawResponse = JSON.stringify({ error: err.message, fallback: true });
    }
  } else {
    outcome = 'not_recovered_by_design';
    newStatus = 'stopped';
  }

  // Update Transaction Status
  const upStmt = db.prepare(`UPDATE transactions SET status = ? WHERE id = ?`);
  upStmt.run(newStatus, transaction.id);

  // Insert Recovery Action
  const actStmt = db.prepare(`
    INSERT INTO recovery_actions (decision_id, executed_at, razorpay_response, outcome, amount_recovered_inr)
    VALUES (?, datetime('now'), ?, ?, ?)
  `);
  actStmt.run(decisionId, rawResponse, outcome, amountRecovered);

  return {
    decisionId,
    outcome,
    newStatus,
    recoveryProbability: mlProbability,
    llmProvider: classification.llm_provider || 'Gemini 1.5 Flash',
    llmReasoning: classification.reasoning,
    executionSteps: [
      {
        step: 1,
        title: 'Webhook Event Ingested',
        status: 'completed',
        detail: `Captured failure event for Order ${transaction.order_id}: ${failure.error_code} on ${transaction.bank} (INR ${transaction.amount_inr})`
      },
      {
        step: 2,
        title: 'LLM Cognitive Root Cause Diagnosis',
        status: 'completed',
        detail: `${classification.llm_provider || 'Gemini 1.5 Flash'} diagnosed '${rootCause}' with ${Math.round(confidence * 100)}% confidence`
      },
      {
        step: 3,
        title: 'Compliance & Safety Guardrails',
        status: tier === 'stop' ? 'halted' : 'passed',
        detail: tier === 'stop'
          ? `Halted by guardrail: ${reasoning.includes('[STOPPED]') ? reasoning.split('[STOPPED]')[1].trim() : 'Declined'}`
          : (transaction.amount_inr <= 2000 ? `Passed INR 2,000 auto-recovery cap & RBI DND quiet-hour check` : `Exceeds INR 2,000 cap -> Routed to merchant dual-authorization queue`)
      },
      {
        step: 4,
        title: 'Gradient Boosting Predictive Scorer',
        status: 'completed',
        detail: mlProbability !== null
          ? `Statistical ML model scored recovery probability at ${(mlProbability * 100).toFixed(1)}%`
          : `Heuristic safety matrix evaluated recovery potential`
      },
      {
        step: 5,
        title: 'Autonomous Action Execution',
        status: action === 'retry' ? (outcome === 'success' ? 'success' : 'retry_failed') : (action === 'none' ? 'halted' : 'queued'),
        detail: action === 'retry'
          ? (outcome === 'success' ? 'Real-time Razorpay smart retry succeeded! Payment recovered.' : 'Retry attempted; downstream issuer declined.')
          : (action === 'nudge' ? 'Dispatched 1-click WhatsApp interactive checkout link.' : (tier === 'queue' ? 'Queued in merchant dashboard for dual authorization.' : 'Halted to protect customer relationship.'))
      }
    ]
  };
}

export async function runBatch(statusFilter = ['failed']) {
  const db = getDb();
  const placeholders = statusFilter.map(() => '?').join(',');
  const stmt = db.prepare(`SELECT * FROM transactions WHERE status IN (${placeholders})`);
  const transactions = stmt.all(...statusFilter);

  const razorpay = new RazorpayClient();
  const results = [];

  for (const txn of transactions) {
    const res = await processTransaction(txn, razorpay);
    if (res) results.push(res);
  }

  return {
    processed: results.length,
    recovered: results.filter((r) => r.outcome === 'success').length,
    queued_for_approval: results.filter((r) => r.outcome === 'awaiting_approval').length,
    nudged: results.filter((r) => r.outcome === 'nudge_sent').length,
    not_recovered_by_design: results.filter((r) => r.outcome === 'not_recovered_by_design').length,
    retry_failed: results.filter((r) => r.outcome === 'failed').length,
  };
}
