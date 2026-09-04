import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb, initDb } from '../db.js';

test('webhook events can be logged and retrieved', () => {
  const db = getDb();
  initDb(db);

  const eventId = `evt_test_${Date.now()}`;
  const payload = { event: 'payment.failed', amount: 120000 };

  db.prepare(`
    INSERT INTO webhook_events (event_id, event_type, payload_json, status)
    VALUES (?, 'payment.failed', ?, 'processed')
  `).run(eventId, JSON.stringify(payload));

  const event = db.prepare(`SELECT * FROM webhook_events WHERE event_id = ?`).get(eventId);
  assert.ok(event);
  assert.equal(event.event_type, 'payment.failed');
  assert.equal(event.status, 'processed');
});
