import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb, initDb } from '../db.js';
import { generateSyntheticBatch } from '../syntheticData.js';

test('database initializes and required tables exist', () => {
  const db = getDb();
  initDb(db);

  const tablesStmt = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name IN ('transactions', 'failure_events', 'recovery_decisions', 'recovery_actions');
  `);
  const tables = tablesStmt.all().map(t => t.name);

  assert.ok(tables.includes('transactions'));
  assert.ok(tables.includes('failure_events'));
  assert.ok(tables.includes('recovery_decisions'));
  assert.ok(tables.includes('recovery_actions'));
});

test('synthetic batch generator produces correct number of batch items', () => {
  const countCreated = generateSyntheticBatch(25);
  assert.equal(countCreated, 25);
});
