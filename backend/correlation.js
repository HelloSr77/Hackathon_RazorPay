import { getDb } from './db.js';
import { BANK_OUTAGE_FAILURE_THRESHOLD, BANK_OUTAGE_WINDOW_MINUTES } from './config.js';

export function checkBankOutage(bank, referenceTime = new Date()) {
  if (!bank) {
    return { isOutage: false, failureCount: 0 };
  }

  const db = getDb();
  const windowStart = new Date(referenceTime.getTime() - BANK_OUTAGE_WINDOW_MINUTES * 60 * 1000);

  const stmt = db.prepare(`
    SELECT COUNT(fe.id) as count
    FROM failure_events fe
    JOIN transactions t ON fe.transaction_id = t.id
    WHERE t.bank = ?
      AND fe.error_code = 'GATEWAY_ERROR'
      AND datetime(fe.occurred_at) >= datetime(?)
      AND datetime(fe.occurred_at) <= datetime(?)
  `);

  const row = stmt.get(bank, windowStart.toISOString(), referenceTime.toISOString());
  const count = row ? row.count : 0;
  const isOutage = count >= BANK_OUTAGE_FAILURE_THRESHOLD;

  return { isOutage, failureCount: count };
}
