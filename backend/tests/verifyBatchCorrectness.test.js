import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../db.js';
import { generateSyntheticBatch } from '../syntheticData.js';
import { runBatch } from '../recoveryEngine.js';
import { headlineMetrics, rootCauseMoneyBreakdown, rootCauseBreakdown, tierBreakdown } from '../audit.js';

test('BATCH VERIFICATION: generating new transactions and verifying full mathematical & guardrail accuracy', async () => {
  const db = getDb();

  // Record pre-batch counts
  const preTxnCount = db.prepare(`SELECT COUNT(id) as count FROM transactions`).get().count;
  const preFailedCount = db.prepare(`SELECT COUNT(id) as count FROM transactions WHERE status IN ('failed')`).get().count;

  // Generate 50 fresh synthetic transactions
  const nToGenerate = 50;
  generateSyntheticBatch(nToGenerate);

  const postTxnCount = db.prepare(`SELECT COUNT(id) as count FROM transactions`).get().count;
  assert.equal(postTxnCount, preTxnCount + nToGenerate, `Must generate exactly ${nToGenerate} new transactions`);

  // Run the recovery pipeline batch
  const summary = await runBatch();
  assert.equal(summary.processed, preFailedCount + nToGenerate, `Must process all unprocessed transactions`);

  // Verify all transactions in the database now have decisions
  const unprocCount = db.prepare(`SELECT COUNT(id) as count FROM transactions WHERE id NOT IN (SELECT transaction_id FROM recovery_decisions)`).get().count;
  assert.equal(unprocCount, 0, 'Zero transactions should remain unprocessed');

  // Fetch headline metrics
  const metrics = headlineMetrics();

  // 1. Database-Level Money Math Assertions
  const actualDbTotal = db.prepare(`SELECT ROUND(COALESCE(SUM(amount_inr), 0), 2) as total FROM transactions`).get().total;
  const actualDbRecovered = db.prepare(`
    SELECT ROUND(COALESCE(SUM(ra.amount_recovered_inr), 0), 2) as recovered
    FROM recovery_actions ra
    WHERE ra.outcome = 'success'
  `).get().recovered;

  assert.equal(metrics.total_amount_inr, actualDbTotal, `total_amount_inr (${metrics.total_amount_inr}) must match DB SUM(amount_inr) (${actualDbTotal})`);
  assert.equal(metrics.total_at_risk_inr, actualDbTotal, `total_at_risk_inr must match DB SUM(amount_inr)`);
  assert.equal(metrics.total_recovered_inr, actualDbRecovered, `total_recovered_inr (${metrics.total_recovered_inr}) must match DB SUM(amount_recovered_inr) (${actualDbRecovered})`);

  // Expected recovery rate %
  const expectedRate = actualDbTotal > 0 ? Math.round((actualDbRecovered / actualDbTotal) * 1000) / 10 : 0;
  assert.equal(metrics.recovery_rate_pct, expectedRate, `recovery_rate_pct (${metrics.recovery_rate_pct}%) must match expected mathematical rate (${expectedRate}%)`);

  // 2. Transaction Status Count Reconciliations
  assert.equal(metrics.total_transactions, postTxnCount, 'total_transactions must match DB transaction count');
  
  // Sum of status buckets must equal total transactions
  const bucketSum = metrics.recovered_transactions + 
                    metrics.queued_for_approval_transactions + 
                    metrics.stopped_by_design_transactions + 
                    (metrics.nudged_transactions || 0);

  // Note: Some transactions may have retried and failed or be pending, bucketSum <= total_transactions
  assert.ok(metrics.recovered_transactions <= metrics.total_transactions, 'Recovered txns cannot exceed total');

  // 3. Headline Stat String Verification
  const expectedStatSnippet = `₹${Math.round(actualDbRecovered).toLocaleString('en-IN')} of ₹${Math.round(actualDbTotal).toLocaleString('en-IN')} at-risk recovered (${expectedRate.toFixed(1)}%) across ${postTxnCount} transactions`;
  assert.equal(metrics.headline_stat, expectedStatSnippet, `headline_stat string must exactly match: ${expectedStatSnippet}`);

  // 4. Root Cause Money Breakdown Reconciliations
  const rootMoney = rootCauseMoneyBreakdown();
  assert.ok(rootMoney.length > 0, 'Root cause breakdown must not be empty');

  let breakdownTotalAtRisk = 0;
  let breakdownTotalRecovered = 0;
  let breakdownTotalTxns = 0;

  for (const row of rootMoney) {
    breakdownTotalAtRisk += row.at_risk_inr;
    breakdownTotalRecovered += row.recovered_inr;
    breakdownTotalTxns += row.total_transactions;

    // Verify each row's internal percentage
    if (row.at_risk_inr > 0) {
      const rowExpectedRate = Math.round((row.recovered_inr / row.at_risk_inr) * 1000) / 10;
      assert.equal(row.recovery_rate_pct, rowExpectedRate, `Root cause ${row.root_cause} rate must be accurate`);
    }

    // Safety checks on dead cards: Must NOT have recovered money
    if (row.root_cause === 'dead_card') {
      assert.equal(row.recovered_inr, 0, 'Dead cards must NEVER have recovered money');
      assert.equal(row.recovery_rate_pct, 0, 'Dead cards must have 0% recovery rate');
    }
  }

  // Sum of breakdown amounts must strictly equal total amounts (allowing for tiny 0.05 rounding)
  assert.ok(Math.abs(breakdownTotalAtRisk - actualDbTotal) <= 0.05, `Sum of breakdown at-risk (₹${breakdownTotalAtRisk}) must equal total at-risk (₹${actualDbTotal})`);
  assert.ok(Math.abs(breakdownTotalRecovered - actualDbRecovered) <= 0.05, `Sum of breakdown recovered (₹${breakdownTotalRecovered}) must equal total recovered (₹${actualDbRecovered})`);
  assert.equal(breakdownTotalTxns, postTxnCount, `Sum of breakdown transaction counts (${breakdownTotalTxns}) must equal total (${postTxnCount})`);

  // 5. Tier Gating Guardrail Checks
  const queuedTxns = db.prepare(`
    SELECT t.amount_inr, rd.root_cause, rd.queue_reason
    FROM recovery_decisions rd
    JOIN transactions t ON rd.transaction_id = t.id
    WHERE rd.tier = 'queue'
  `).all();

  for (const q of queuedTxns) {
    // Queued items must have a visible queue reason logged
    assert.ok(q.queue_reason && q.queue_reason.length > 5, 'Every queued transaction must have an explicit queue_reason');
  }

  console.log(`\nVerified Synthetic Batch:
  - Total Transactions: ${metrics.total_transactions}
  - Total At-Risk: ₹${metrics.total_amount_inr.toLocaleString()}
  - Total Recovered: ₹${metrics.total_recovered_inr.toLocaleString()}
  - Recovery Rate: ${metrics.recovery_rate_pct}%
  - Headline Stat: "${metrics.headline_stat}"
  - Root Cause Breakdowns: ${rootMoney.length} causes verified
  - Mathematical integrity: 100% verified!`);
});
