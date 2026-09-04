import { getDb } from './db.js';
import {
  runtimeSettings,
  RETRY_COOL_DOWN_MINUTES,
  MAX_RECOVERY_ATTEMPTS_PER_CUSTOMER_PER_DAY,
} from './config.js';

export function priorFailuresForCard(cardFingerprint, excludeTxnId = null) {
  if (!cardFingerprint) return 0;
  const db = getDb();
  let query = `
    SELECT COUNT(fe.id) as count
    FROM failure_events fe
    JOIN transactions t ON fe.transaction_id = t.id
    WHERE t.card_fingerprint = ?
      AND fe.error_code IN ('insufficient_funds', 'card_declined')
  `;
  const params = [cardFingerprint];
  if (excludeTxnId) {
    query += ` AND t.id != ?`;
    params.push(excludeTxnId);
  }
  const stmt = db.prepare(query);
  const row = stmt.get(...params);
  return row ? row.count : 0;
}

export function canRetry(transaction) {
  const db = getDb();

  // 1. Max retries check
  const attemptsStmt = db.prepare(`
    SELECT COUNT(ra.id) as count
    FROM recovery_actions ra
    JOIN recovery_decisions rd ON ra.decision_id = rd.id
    WHERE rd.transaction_id = ? AND ra.outcome IN ('success', 'failed')
  `);
  const attemptsRow = attemptsStmt.get(transaction.id);
  const retryCount = attemptsRow ? attemptsRow.count : 0;

  const maxRetries = runtimeSettings.MAX_RETRIES_PER_TRANSACTION;
  if (retryCount >= maxRetries) {
    return { allowed: false, reason: `Exceeded max retries per transaction (${maxRetries})` };
  }

  // 2. Cool-down check
  const lastRetryStmt = db.prepare(`
    SELECT ra.executed_at
    FROM recovery_actions ra
    JOIN recovery_decisions rd ON ra.decision_id = rd.id
    WHERE rd.transaction_id = ? AND ra.outcome IN ('success', 'failed')
    ORDER BY ra.executed_at DESC LIMIT 1
  `);
  const lastRetryRow = lastRetryStmt.get(transaction.id);
  if (lastRetryRow && lastRetryRow.executed_at) {
    const lastTime = new Date(lastRetryRow.executed_at);
    const minutesSince = (Date.now() - lastTime.getTime()) / (1000 * 60);
    if (minutesSince < RETRY_COOL_DOWN_MINUTES) {
      return { allowed: false, reason: `Cool-down active (${Math.round(RETRY_COOL_DOWN_MINUTES - minutesSince)}m remaining)` };
    }
  }

  // 3. Daily customer cap
  const dailyStmt = db.prepare(`
    SELECT COUNT(ra.id) as count
    FROM recovery_actions ra
    JOIN recovery_decisions rd ON ra.decision_id = rd.id
    JOIN transactions t ON rd.transaction_id = t.id
    WHERE t.customer_id = ?
      AND ra.outcome IN ('success', 'failed')
      AND datetime(ra.executed_at) >= datetime('now', '-1 day')
  `);
  const dailyRow = dailyStmt.get(transaction.customer_id);
  const dailyCount = dailyRow ? dailyRow.count : 0;

  if (dailyCount >= MAX_RECOVERY_ATTEMPTS_PER_CUSTOMER_PER_DAY) {
    return { allowed: false, reason: `Exceeded daily retry limit for customer (${MAX_RECOVERY_ATTEMPTS_PER_CUSTOMER_PER_DAY})` };
  }

  return { allowed: true, reason: 'Allowed' };
}

export function decideTier(rootCause, confidence, amountInr, bankOutage = false) {
  const queueMinConf = runtimeSettings.QUEUE_MIN_CONFIDENCE;
  const autoMinConf = runtimeSettings.AUTO_RECOVER_MIN_CONFIDENCE;
  const autoMaxAmount = runtimeSettings.AUTO_RECOVER_MAX_AMOUNT_INR;

  if (rootCause === 'dead_card' || bankOutage || confidence < queueMinConf) {
    return 'stop';
  }
  if (rootCause === 'transient_gateway_error' && confidence >= autoMinConf && amountInr <= autoMaxAmount) {
    return 'auto';
  }
  return 'queue';
}

export function actionForTier(tier, rootCause) {
  if (tier === 'stop') return 'none';
  if (tier === 'auto') return 'retry';
  if (tier === 'queue') {
    if (rootCause === 'auth_dropped_3ds' || rootCause === 'insufficient_funds') {
      return 'nudge';
    }
    return 'retry_pending_approval';
  }
  return 'none';
}

// Compliance Guardrails

/**
 * Checks if current time is within Do-Not-Disturb (DND) window.
 * Complies with TRAI regulation prohibiting promotional/recovery communication during night hours.
 */
export function isDndWindowActive(date = new Date()) {
  if (!runtimeSettings.DND_ENABLED) return false;
  const hour = date.getHours();
  const start = runtimeSettings.DND_START_HOUR; // Default: 21 (9:00 PM)
  const end = runtimeSettings.DND_END_HOUR;     // Default: 9 (9:00 AM)

  if (start > end) {
    // Spans midnight (e.g. 21:00 to 09:00)
    return hour >= start || hour < end;
  }
  return hour >= start && hour < end;
}

/**
 * Checks if a customer has opted out of WhatsApp/SMS nudges.
 */
export function isCustomerOptedOut(customerId) {
  if (!customerId) return false;
  const db = getDb();
  const stmt = db.prepare(`SELECT opted_out FROM customer_consents WHERE customer_id = ?`);
  const row = stmt.get(customerId);
  return Boolean(row && row.opted_out === 1);
}

/**
 * Sets opt-out or consent status for a customer.
 */
export function setCustomerConsent(customerId, optedOut = true, reason = '') {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO customer_consents (customer_id, opted_out, reason, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(customer_id) DO UPDATE SET
      opted_out = excluded.opted_out,
      reason = excluded.reason,
      updated_at = excluded.updated_at
  `);
  stmt.run(customerId, optedOut ? 1 : 0, reason);
  return { customerId, optedOut: Boolean(optedOut), reason };
}

/**
 * Retrieves all registered customer consent records.
 */
export function getCustomerConsents() {
  const db = getDb();
  return db.prepare(`SELECT * FROM customer_consents ORDER BY updated_at DESC`).all();
}

/**
 * Evaluates whether a customer nudge via WhatsApp/SMS is legally and policy compliant.
 */
export function canSendNudge(customerId, date = new Date()) {
  // 1. Consent / Opt-out check
  if (isCustomerOptedOut(customerId)) {
    return {
      allowed: false,
      reason: 'Customer has opted out of WhatsApp/SMS recovery communications',
      code: 'CUSTOMER_OPTED_OUT'
    };
  }

  // 2. DND window check
  if (isDndWindowActive(date)) {
    const startStr = `${String(runtimeSettings.DND_START_HOUR).padStart(2, '0')}:00`;
    const endStr = `${String(runtimeSettings.DND_END_HOUR).padStart(2, '0')}:00`;
    return {
      allowed: false,
      reason: `Do-Not-Disturb (DND) window active between ${startStr} and ${endStr} (TRAI regulatory compliance)`,
      code: 'DND_ACTIVE'
    };
  }

  return { allowed: true, reason: 'Allowed' };
}

/**
 * Produces a clear, explicit, visible logged reason for why a transaction was queued for human approval.
 */
export function getQueueReason(rootCause, confidence, amountInr, bankOutage = false) {
  const autoMaxAmount = runtimeSettings.AUTO_RECOVER_MAX_AMOUNT_INR;
  const autoMinConf = runtimeSettings.AUTO_RECOVER_MIN_CONFIDENCE;
  const queueMinConf = runtimeSettings.QUEUE_MIN_CONFIDENCE;

  if (amountInr > autoMaxAmount) {
    return `Transaction amount (₹${amountInr.toLocaleString()}) exceeds auto-recovery cap of ₹${autoMaxAmount.toLocaleString()} (dual authorization required)`;
  }
  if (rootCause === 'user_abandoned_checkout') {
    return `Customer explicitly cancelled checkout; merchant review required before triggering re-engagement`;
  }
  if (rootCause === 'auth_dropped_3ds') {
    return `3DS OTP authentication dropped; manual verification advised`;
  }
  if (rootCause === 'transient_gateway_error' && confidence < autoMinConf) {
    return `Gateway error confidence (${Math.round(confidence * 100)}%) below auto-recovery threshold (${Math.round(autoMinConf * 100)}%)`;
  }
  if (confidence >= queueMinConf && confidence < autoMinConf) {
    return `Moderate AI confidence (${Math.round(confidence * 100)}%) falls in merchant review band (${Math.round(queueMinConf * 100)}% - ${Math.round(autoMinConf * 100)}%)`;
  }
  return `Escalation policy: transaction risk profile requires merchant authorization`;
}
