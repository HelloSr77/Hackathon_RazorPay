import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb, initDb } from '../db.js';
import { bankHealthLeaderboard } from '../audit.js';

test('bank health leaderboard returns entries for all major banks', () => {
  const db = getDb();
  initDb(db);

  const leaderboard = bankHealthLeaderboard();
  assert.ok(Array.isArray(leaderboard));
  assert.ok(leaderboard.length >= 5);

  const bankNames = leaderboard.map(b => b.bank);
  assert.ok(bankNames.includes('HDFC'));
  assert.ok(bankNames.includes('ICICI'));
  assert.ok(bankNames.includes('SBI'));
  assert.ok(bankNames.includes('AXIS'));
  assert.ok(bankNames.includes('KOTAK'));
});
