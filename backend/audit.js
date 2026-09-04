import { getDb } from './db.js';

export function rootCauseMoneyBreakdown() {
  const db = getDb();
  const query = `
    WITH latest_decision AS (
      SELECT 
        rd.transaction_id,
        rd.root_cause,
        rd.id as decision_id
      FROM recovery_decisions rd
      WHERE rd.id IN (
        SELECT MAX(id) FROM recovery_decisions GROUP BY transaction_id
      )
    ),
    txn_recovered AS (
      SELECT 
        rd.transaction_id,
        COALESCE(SUM(ra.amount_recovered_inr), 0.0) as recovered_amount
      FROM recovery_decisions rd
      JOIN recovery_actions ra ON ra.decision_id = rd.id
      GROUP BY rd.transaction_id
    )
    SELECT 
      ld.root_cause,
      COUNT(t.id) as total_transactions,
      COALESCE(SUM(t.amount_inr), 0.0) as at_risk_inr,
      COALESCE(SUM(tr.recovered_amount), 0.0) as recovered_inr,
      SUM(CASE WHEN t.status = 'recovered' THEN 1 ELSE 0 END) as recovered_transactions
    FROM transactions t
    JOIN latest_decision ld ON ld.transaction_id = t.id
    LEFT JOIN txn_recovered tr ON tr.transaction_id = t.id
    GROUP BY ld.root_cause
    ORDER BY at_risk_inr DESC
  `;

  const rows = db.prepare(query).all();
  return rows.map((r) => {
    const atRisk = Math.round(Number(r.at_risk_inr) * 100) / 100;
    const recovered = Math.round(Number(r.recovered_inr) * 100) / 100;
    const rate = atRisk > 0 ? Math.round((recovered / atRisk) * 1000) / 10 : 0.0;
    return {
      root_cause: r.root_cause,
      total_transactions: r.total_transactions,
      at_risk_inr: atRisk,
      recovered_inr: recovered,
      recovery_rate_pct: rate,
      recovered_transactions: r.recovered_transactions,
      headline_stat: `₹${recovered.toLocaleString('en-IN')} of ₹${atRisk.toLocaleString('en-IN')} recovered (${rate.toFixed(1)}%) across ${r.total_transactions} transactions`
    };
  });
}

export function headlineMetrics() {
  const db = getDb();

  const mStmt = db.prepare(`
    SELECT 
      SUM(amount_inr) as total_amount,
      (SELECT SUM(amount_inr) FROM transactions WHERE status != 'recovered') as total_at_risk,
      (SELECT SUM(amount_recovered_inr) FROM recovery_actions) as total_recovered,
      COUNT(id) as total_txns,
      SUM(CASE WHEN status = 'recovered' THEN 1 ELSE 0 END) as recovered_txns,
      SUM(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END) as stopped_txns,
      SUM(CASE WHEN status = 'queued_for_approval' THEN 1 ELSE 0 END) as queued_txns,
      SUM(CASE WHEN status = 'nudged' THEN 1 ELSE 0 END) as nudged_txns
    FROM transactions
  `);
  const row = mStmt.get();

  const rStmt = db.prepare(`
    SELECT 
      SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) as retry_failed,
      SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as retry_success
    FROM recovery_actions
  `);
  const retryRow = rStmt.get();

  const totalAmount = row ? row.total_amount || 0.0 : 0.0;
  const totalRecovered = row ? row.total_recovered || 0.0 : 0.0;
  const totalAtRisk = totalAmount; // In a failure batch, entire batch represents at-risk money
  const retryFailed = retryRow ? retryRow.retry_failed || 0 : 0;
  const retrySuccess = retryRow ? retryRow.retry_success || 0 : 0;
  const retryAttempts = retryFailed + retrySuccess;
  const falsePositiveRate = retryAttempts ? (retryFailed / retryAttempts) * 100 : 0.0;
  const recoveryRate = totalAmount ? Math.round((totalRecovered / totalAmount) * 1000) / 10 : 0.0;
  const totalTxns = row ? row.total_txns || 0 : 0;
  const byRootCause = rootCauseMoneyBreakdown();

  const headlineStat = `₹${Math.round(totalRecovered).toLocaleString('en-IN')} of ₹${Math.round(totalAmount).toLocaleString('en-IN')} at-risk recovered (${recoveryRate.toFixed(1)}%) across ${totalTxns} transactions`;

  return {
    headline_stat: headlineStat,
    total_amount_inr: Math.round(totalAmount * 100) / 100,
    total_at_risk_inr: Math.round(totalAtRisk * 100) / 100,
    total_recovered_inr: Math.round(totalRecovered * 100) / 100,
    recovery_rate_pct: recoveryRate,
    total_transactions: totalTxns,
    recovered_transactions: row ? row.recovered_txns || 0 : 0,
    stopped_by_design_transactions: row ? row.stopped_txns || 0 : 0,
    queued_for_approval_transactions: row ? row.queued_txns || 0 : 0,
    nudged_transactions: row ? row.nudged_txns || 0 : 0,
    retry_attempts: retryAttempts,
    false_positive_retry_rate_pct: Math.round(falsePositiveRate * 10) / 10,
    by_root_cause: byRootCause,
  };
}

export function rootCauseBreakdown() {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT root_cause, COUNT(id) as count
    FROM recovery_decisions
    GROUP BY root_cause
    ORDER BY count DESC
  `);
  const rows = stmt.all();
  return rows.reduce((acc, row) => {
    acc[row.root_cause] = row.count;
    return acc;
  }, {});
}

export function tierBreakdown() {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT tier, COUNT(id) as count
    FROM recovery_decisions
    GROUP BY tier
    ORDER BY count DESC
  `);
  const rows = stmt.all();
  return rows.reduce((acc, row) => {
    acc[row.tier] = row.count;
    return acc;
  }, {});
}

export function bankHealthLeaderboard() {
  const db = getDb();
  const banks = ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK'];
  const result = [];

  for (const bank of banks) {
    const totalStmt = db.prepare(`SELECT COUNT(id) as total FROM transactions WHERE bank = ?`).get(bank);
    const failedStmt = db.prepare(`
      SELECT COUNT(fe.id) as failed 
      FROM failure_events fe
      JOIN transactions t ON fe.transaction_id = t.id
      WHERE t.bank = ? AND fe.error_code = 'GATEWAY_ERROR'
    `).get(bank);

    const total = totalStmt ? totalStmt.total || 0 : 0;
    const failed = failedStmt ? failedStmt.failed || 0 : 0;
    const successCount = Math.max(0, total - failed);
    const healthPct = total > 0 ? Math.round((successCount / total) * 100) : 95;
    const isOutage = failed >= 5;

    result.push({
      bank,
      total,
      health_pct: healthPct,
      status: isOutage ? 'outage' : healthPct < 75 ? 'degraded' : 'healthy'
    });
  }

  return result.sort((a, b) => b.health_pct - a.health_pct);
}

export function notRecoveredAmount() {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT 
      rd.root_cause, 
      SUM(t.amount_inr) as amount_inr, 
      COUNT(t.id) as count
    FROM recovery_decisions rd
    JOIN transactions t ON rd.transaction_id = t.id
    WHERE rd.tier = 'stop'
    GROUP BY rd.root_cause
    ORDER BY amount_inr DESC
  `);
  const rows = stmt.all();
  return rows.map((r) => ({
    root_cause: r.root_cause,
    amount_inr: Math.round(r.amount_inr * 100) / 100,
    count: r.count,
  }));
}

export function fullAuditLog(limit = 200) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT 
      t.order_id,
      t.customer_id,
      t.amount_inr,
      t.bank,
      rd.id as decision_id,
      rd.root_cause,
      rd.confidence,
      rd.tier,
      rd.action_chosen as action,
      rd.reasoning,
      rd.queue_reason,
      rd.bank_outage_flagged,
      ra.outcome,
      ra.amount_recovered_inr,
      rd.decided_at
    FROM recovery_decisions rd
    JOIN transactions t ON rd.transaction_id = t.id
    JOIN recovery_actions ra ON ra.decision_id = rd.id
    ORDER BY rd.decided_at DESC, ra.executed_at DESC
  `);
  const rows = stmt.all();

  const seenDecisions = new Set();
  const result = [];
  for (const row of rows) {
    if (seenDecisions.has(row.decision_id)) continue;
    seenDecisions.add(row.decision_id);
    
    // Compute Churn Risk
    let churnRisk = 'Low';
    if (row.amount_inr > 5000 || row.root_cause === 'dead_card') {
      churnRisk = 'High';
    } else if (row.amount_inr > 2000 || row.confidence < 0.60) {
      churnRisk = 'Medium';
    }

    result.push({
      ...row,
      churn_risk: churnRisk
    });
    if (result.length >= limit) break;
  }
  return result;
}

export function exportAuditLogCsv() {
  const logs = fullAuditLog(1000);
  const headers = ['Order ID', 'Customer ID', 'Amount (INR)', 'Bank', 'Root Cause', 'Confidence (%)', 'Escalation Tier', 'Action', 'Outcome', 'Queue Reason', 'Amount Recovered (INR)', 'Churn Risk', 'Decided At', 'Reasoning'];
  const csvRows = [headers.join(',')];

  for (const log of logs) {
    const row = [
      `"${log.order_id || ''}"`,
      `"${log.customer_id || ''}"`,
      log.amount_inr || 0,
      `"${log.bank || ''}"`,
      `"${log.root_cause || ''}"`,
      Math.round((log.confidence || 0) * 100),
      `"${log.tier || ''}"`,
      `"${log.action || ''}"`,
      `"${log.outcome || ''}"`,
      `"${(log.queue_reason || '').replace(/"/g, '""')}"`,
      log.amount_recovered_inr || 0,
      `"${log.churn_risk || ''}"`,
      `"${log.decided_at || ''}"`,
      `"${(log.reasoning || '').replace(/"/g, '""')}"`
    ];
    csvRows.push(row.join(','));
  }

  return csvRows.join('\n');
}
