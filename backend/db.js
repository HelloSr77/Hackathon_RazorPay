import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './config.js';

let dbInstance = null;

export function getDb() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH);
    try {
      dbInstance.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`);
    } catch (_) {}
    initDb(dbInstance);
  }
  return dbInstance;
}

export function initDb(db = getDb()) {
  try {
    db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`);
  } catch (_) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      customer_id TEXT NOT NULL,
      amount_inr REAL NOT NULL,
      method TEXT NOT NULL,
      bank TEXT,
      card_fingerprint TEXT,
      status TEXT DEFAULT 'failed',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS failure_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      error_code TEXT NOT NULL,
      error_description TEXT NOT NULL,
      attempt_number INTEGER DEFAULT 1,
      occurred_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    );

    CREATE TABLE IF NOT EXISTS recovery_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      root_cause TEXT NOT NULL,
      confidence REAL NOT NULL,
      tier TEXT NOT NULL,
      action_chosen TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      queue_reason TEXT,
      bank_outage_flagged INTEGER DEFAULT 0,
      decided_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    );

    CREATE TABLE IF NOT EXISTS recovery_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id INTEGER NOT NULL,
      executed_at TEXT DEFAULT (datetime('now')),
      razorpay_response TEXT,
      outcome TEXT NOT NULL,
      amount_recovered_inr REAL DEFAULT 0.0,
      FOREIGN KEY (decision_id) REFERENCES recovery_decisions(id)
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT DEFAULT 'processed',
      received_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customer_consents (
      customer_id TEXT PRIMARY KEY,
      opted_out INTEGER DEFAULT 0,
      channel TEXT DEFAULT 'all',
      reason TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migration: add queue_reason to recovery_decisions if existing table lacks it
  try {
    const tableInfo = db.prepare(`PRAGMA table_info(recovery_decisions)`).all();
    const hasQueueReason = tableInfo.some(col => col.name === 'queue_reason');
    if (!hasQueueReason) {
      db.exec(`ALTER TABLE recovery_decisions ADD COLUMN queue_reason TEXT;`);
    }
  } catch (_) {}
}
