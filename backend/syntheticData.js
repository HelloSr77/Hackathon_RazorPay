import { getDb } from './db.js';

const BANKS = ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK'];
const METHODS = ['card', 'upi', 'netbanking'];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

export function generateSyntheticBatch(n = 150) {
  const db = getDb();
  
  const insertTxn = db.prepare(`
    INSERT INTO transactions (order_id, customer_id, amount_inr, method, bank, card_fingerprint, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'failed', datetime('now', ?))
  `);

  const insertFailure = db.prepare(`
    INSERT INTO failure_events (transaction_id, error_code, error_description, attempt_number, occurred_at)
    VALUES (?, ?, ?, ?, datetime('now', ?))
  `);

  db.exec('BEGIN');
  let countCreated = 0;

  // 1. Seed Bank Outage (HDFC bank outage clustering)
  const outageBank = 'HDFC';
  for (let i = 0; i < 6; i++) {
    const orderId = `order_outage_${Date.now()}_${i}`;
    const custId = `cust_outage_${i}`;
    const amount = Math.round(randomFloat(500, 3000) * 100) / 100;
    const minutesAgo = `-${Math.floor(Math.random() * 8)} minutes`;
    
    const info = insertTxn.run(orderId, custId, amount, 'card', outageBank, `card_outage_${i}`, minutesAgo);
    const txnId = Number(info.lastInsertRowid);

    insertFailure.run(txnId, 'GATEWAY_ERROR', 'Gateway timeout on issuing bank', 1, minutesAgo);
    countCreated++;
  }

  // 2. Seed Dead Card (3 repeat failures on same card)
  const deadCardFingerprint = `card_dead_${Date.now()}`;
  const deadCustId = `cust_dead_repeat`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const orderId = `order_deadcard_${Date.now()}_${attempt}`;
    const amount = Math.round(randomFloat(200, 1500) * 100) / 100;
    const hoursAgo = `-${(4 - attempt) * 2} hours`;

    const info = insertTxn.run(orderId, deadCustId, amount, 'card', 'ICICI', deadCardFingerprint, hoursAgo);
    const txnId = Number(info.lastInsertRowid);

    const errCode = attempt === 3 ? 'card_declined' : 'insufficient_funds';
    insertFailure.run(txnId, errCode, 'Card declined by issuing bank', attempt, hoursAgo);
    countCreated++;
  }

  // 3. Populate remaining random mix
  const errorPool = [
    { code: 'GATEWAY_ERROR', desc: 'Gateway timeout / network issue', weight: 40 },
    { code: 'insufficient_funds', desc: 'Insufficient balance in account', weight: 25 },
    { code: 'authentication_failed', desc: '3DS authentication failed / OTP dropped', weight: 20 },
    { code: 'payment_cancelled', desc: 'Payment cancelled by customer', weight: 15 },
  ];

  while (countCreated < n) {
    const r = Math.random() * 100;
    let selected = errorPool[0];
    let cumulative = 0;
    for (const item of errorPool) {
      cumulative += item.weight;
      if (r <= cumulative) {
        selected = item;
        break;
      }
    }

    const orderId = `order_syn_${Date.now()}_${countCreated}`;
    const custId = `cust_${Math.floor(Math.random() * 500)}`;
    const amount = Math.round(randomFloat(100, 10000) * 100) / 100;
    const method = randomChoice(METHODS);
    const bank = randomChoice(BANKS);
    const cardFingerprint = method === 'card' ? `card_fp_${Math.floor(Math.random() * 200)}` : null;
    const hoursAgo = `-${Math.floor(Math.random() * 48)} hours`;

    const info = insertTxn.run(orderId, custId, amount, method, bank, cardFingerprint, hoursAgo);
    const txnId = Number(info.lastInsertRowid);

    insertFailure.run(txnId, selected.code, selected.desc, 1, hoursAgo);
    countCreated++;
  }

  db.exec('COMMIT');
  return countCreated;
}
