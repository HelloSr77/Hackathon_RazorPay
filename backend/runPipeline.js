import { getDb } from './db.js';
import { generateSyntheticBatch } from './syntheticData.js';
import { runBatch } from './recoveryEngine.js';
import { headlineMetrics, rootCauseBreakdown, tierBreakdown, notRecoveredAmount } from './audit.js';

async function main() {
  const args = process.argv.slice(2);
  const noGenerate = args.includes('--no-generate');
  let n = 150;
  const nIdx = args.indexOf('--n');
  if (nIdx !== -1 && args[nIdx + 1]) {
    n = parseInt(args[nIdx + 1], 10);
  }

  const db = getDb();
  const countRow = db.prepare(`SELECT COUNT(id) as count FROM transactions`).get();
  const existing = countRow ? countRow.count : 0;

  if (!noGenerate && existing === 0) {
    console.log(`No existing transactions found. Generating ${n} synthetic transactions...\n`);
    generateSyntheticBatch(n);
  } else if (!noGenerate) {
    console.log(`DB already has ${existing} transactions -- skipping generation. Use --no-generate to suppress this check.\n`);
  }

  console.log('Running recovery pipeline...\n');
  const summary = await runBatch();
  console.log('Batch summary:');
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k}: ${v}`);
  }

  console.log('\nHeadline metrics:');
  for (const [k, v] of Object.entries(headlineMetrics())) {
    console.log(`  ${k}: ${v}`);
  }

  console.log('\nRoot cause breakdown:');
  for (const [k, v] of Object.entries(rootCauseBreakdown())) {
    console.log(`  ${k}: ${v}`);
  }

  console.log('\nEscalation tier breakdown:');
  for (const [k, v] of Object.entries(tierBreakdown())) {
    console.log(`  ${k}: ${v}`);
  }

  console.log('\nDeliberately not recovered (the counterfactual):');
  for (const row of notRecoveredAmount()) {
    console.log(`  ${row.root_cause}: Rs. ${row.amount_inr} across ${row.count} transactions`);
  }
}

main().catch(console.error);
