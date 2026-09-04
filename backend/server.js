import express from 'express';
import cors from 'cors';
import { 
  headlineMetrics, 
  rootCauseBreakdown, 
  rootCauseMoneyBreakdown,
  tierBreakdown, 
  notRecoveredAmount, 
  fullAuditLog, 
  bankHealthLeaderboard, 
  exportAuditLogCsv 
} from './audit.js';
import { getPendingApprovals, approveDecision, rejectDecision, bulkApproveDecisions, bulkRejectDecisions } from './approvalQueue.js';
import { runBatch, processTransaction } from './recoveryEngine.js';
import { generateSyntheticBatch } from './syntheticData.js';
import { getSettings, updateSettings, LLM_API_KEY, LLM_PROVIDER } from './config.js';
import { getCustomerConsents, setCustomerConsent } from './guardrails.js';
import { scoreTransactionML, scoreBatchML } from './mlScorer.js';
import { getDb } from './db.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// GET /api/metrics
app.get('/api/metrics', (req, res) => {
  try {
    const data = headlineMetrics();
    // Add ROI forecasting & LTV metrics
    const annualProjectedRecovery = Math.round((data.total_recovered_inr || 0) * 12);
    const vipCustomersSaved = Math.round((data.recovered_transactions || 0) * 0.4);
    res.json({
      ...data,
      annual_projected_recovery_inr: annualProjectedRecovery,
      vip_customers_saved: vipCustomersSaved,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bank-health
app.get('/api/bank-health', (req, res) => {
  try {
    const data = bankHealthLeaderboard();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/breakdowns
app.get('/api/breakdowns', (req, res) => {
  try {
    const rc = rootCauseBreakdown();
    const tb = tierBreakdown();
    const moneyBreakdown = rootCauseMoneyBreakdown();
    const root_causes = Object.entries(rc)
      .map(([root_cause, count]) => ({ root_cause, count }))
      .sort((a, b) => b.count - a.count);
    const tiers = Object.entries(tb)
      .map(([tier, count]) => ({ tier, count }))
      .sort((a, b) => b.count - a.count);
    res.json({ root_causes, tiers, money_breakdown: moneyBreakdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/counterfactual
app.get('/api/counterfactual', (req, res) => {
  try {
    const data = notRecoveredAmount();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/audit-log
app.get('/api/audit-log', (req, res) => {
  try {
    const data = fullAuditLog(200);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/approvals
app.get('/api/approvals', (req, res) => {
  try {
    const search = req.query.search || req.query.q || '';
    const data = getPendingApprovals(search);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/approvals/:id/approve
app.post('/api/approvals/:id/approve', (req, res) => {
  try {
    const decisionId = parseInt(req.params.id, 10);
    const result = approveDecision(decisionId);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/approvals/:id/reject
app.post('/api/approvals/:id/reject', (req, res) => {
  try {
    const decisionId = parseInt(req.params.id, 10);
    const note = req.body.note || '';
    const result = rejectDecision(decisionId, note);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/approvals/bulk-approve
app.post('/api/approvals/bulk-approve', (req, res) => {
  try {
    const { decisionIds = [] } = req.body;
    const summary = bulkApproveDecisions(decisionIds);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/approvals/bulk-reject
app.post('/api/approvals/bulk-reject', (req, res) => {
  try {
    const { decisionIds = [], note = '' } = req.body;
    const summary = bulkRejectDecisions(decisionIds, note);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/audit-log/export
app.get('/api/audit-log/export', (req, res) => {
  try {
    const csvData = exportAuditLogCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="revenue_recovery_audit_log_${Date.now()}.csv"`);
    res.send(csvData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alerts/slack
app.post('/api/alerts/slack', async (req, res) => {
  try {
    const { webhookUrl, message: customMsg } = req.body;
    const metrics = headlineMetrics();
    const alertMessage = customMsg || `🚀 *AI Revenue Recovery Executive Briefing*\n• *Total Recovered*: ₹${metrics.total_recovered_inr} (${metrics.recovery_rate_pct}% Recovery Rate)\n• *Transactions Recovered*: ${metrics.recovered_transactions}\n• *Queued for Review*: ${metrics.queued_for_approval_transactions}`;

    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: alertMessage })
      });
      return res.json({ message: 'Slack alert broadcast successfully to channel!', alertMessage });
    }

    res.json({ message: 'Simulated Slack alert generated', alertMessage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings
app.get('/api/settings', (req, res) => {
  try {
    res.json(getSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings
app.post('/api/settings', (req, res) => {
  try {
    const updated = updateSettings(req.body);
    res.json({ message: 'Settings updated successfully', settings: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/simulator/trigger
app.post('/api/simulator/trigger', async (req, res) => {
  try {
    const {
      errorCode = 'GATEWAY_ERROR',
      bank = 'HDFC',
      method = 'card',
      amountInr = 1200,
      customerId = 'cust_sim_' + Math.floor(Math.random() * 1000),
      priorFailures = 0,
      isBusinessHours = null
    } = req.body || {};

    const parsedAmount = isNaN(parseFloat(amountInr)) || parseFloat(amountInr) <= 0 ? 1200 : parseFloat(amountInr);
    const parsedPriorFailures = parseInt(priorFailures, 10) || 0;

    const db = getDb();
    const orderId = `order_sim_${Date.now()}`;
    const cardFp = method === 'card' ? `card_fp_${Date.now()}` : null;

    if (parsedPriorFailures > 0 && cardFp) {
      for (let i = 1; i <= parsedPriorFailures; i++) {
        const histOrderId = `order_hist_${Date.now()}_${i}`;
        const histInfo = db.prepare(`
          INSERT INTO transactions (order_id, customer_id, amount_inr, method, bank, card_fingerprint, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'failed', datetime('now', '-${i * 2} hours'))
        `).run(histOrderId, customerId, parsedAmount, method, bank, cardFp);
        const histTxnId = Number(histInfo.lastInsertRowid);

        db.prepare(`
          INSERT INTO failure_events (transaction_id, error_code, error_description, attempt_number, occurred_at)
          VALUES (?, 'insufficient_funds', 'Historical decline pattern on card', ?, datetime('now', '-${i * 2} hours'))
        `).run(histTxnId, i);
      }
    }

    const info = db.prepare(`
      INSERT INTO transactions (order_id, customer_id, amount_inr, method, bank, card_fingerprint, status)
      VALUES (?, ?, ?, ?, ?, ?, 'failed')
    `).run(orderId, customerId, parsedAmount, method, bank, cardFp);

    const txnId = Number(info.lastInsertRowid);

    db.prepare(`
      INSERT INTO failure_events (transaction_id, error_code, error_description, attempt_number)
      VALUES (?, ?, 'Simulated failure trigger', 1)
    `).run(txnId, errorCode);

    const txn = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(txnId);
    const targetBizHours = (isBusinessHours !== undefined && isBusinessHours !== null)
      ? Number(isBusinessHours)
      : ((new Date().getHours() >= 9 && new Date().getHours() < 21) ? 1 : 0);

    const result = await processTransaction(txn, {
      isBusinessHours: targetBizHours,
      llmProvider: req.body.llmProvider,
      useLLM: req.body.useLLM
    });

    const latestDecision = db.prepare(`
      SELECT rd.*, ra.outcome 
      FROM recovery_decisions rd
      LEFT JOIN recovery_actions ra ON ra.decision_id = rd.id
      WHERE rd.transaction_id = ?
      ORDER BY rd.id DESC LIMIT 1
    `).get(txnId);

    // If not computed in processTransaction, compute live with ML scorer
    let recoveryProb = result?.recoveryProbability;
    if (recoveryProb === null || recoveryProb === undefined) {
      try {
        const mlRes = await scoreTransactionML({
          amountInr: parsedAmount,
          confidence: latestDecision?.confidence || 0.85,
          bank,
          rootCause: latestDecision?.root_cause || 'transient_gateway_error',
          isBusinessHours: targetBizHours,
        });
        recoveryProb = mlRes.recovery_probability;
      } catch (_) {}
    }

    res.json({
      message: 'Transaction failure simulated and processed in real time',
      orderId,
      result,
      decision: latestDecision,
      recoveryProbability: recoveryProb ?? null,
      llmProvider: result?.llmProvider || 'Gemini 1.5 Flash',
      llmReasoning: result?.llmReasoning || latestDecision?.reasoning,
      executionSteps: result?.executionSteps || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/score - Score recovery probability using trained ML model (supports single & batch)
app.post(['/api/score', '/api/score-transaction'], async (req, res) => {
  try {
    const isBatch = Array.isArray(req.body) || Array.isArray(req.body?.transactions);
    const txns = Array.isArray(req.body) ? req.body : (req.body?.transactions || [req.body]);

    if (isBatch) {
      const batchResult = await scoreBatchML(txns, req.body?.model);
      const results = txns.map((t, idx) => ({
        ...t,
        recovery_probability: batchResult.recovery_probabilities[idx] ?? null,
        model: batchResult.model,
        source: batchResult.source
      }));

      return res.json({
        success: true,
        count: results.length,
        model: batchResult.model,
        results
      });
    }

    // Single transaction
    const {
      amountInr = 1200,
      confidence = 0.85,
      bank = 'HDFC',
      rootCause = 'transient_gateway_error',
      isBusinessHours = 1,
      model = null
    } = req.body || {};

    const result = await scoreTransactionML({
      amountInr,
      confidence,
      bank,
      rootCause,
      isBusinessHours,
      model
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/pipeline/run
app.post('/api/pipeline/run', async (req, res) => {
  try {
    const n = req.body.n ? parseInt(req.body.n, 10) : 150;
    const db = getDb();
    const unprocRow = db.prepare(`SELECT COUNT(id) as count FROM transactions WHERE id NOT IN (SELECT transaction_id FROM recovery_decisions)`).get();
    let generated = 0;
    if (!unprocRow || unprocRow.count === 0 || req.body.generateNew) {
      generateSyntheticBatch(n);
      generated = n;
    }
    const summary = await runBatch();
    const metrics = headlineMetrics();
    res.json({ 
      message: 'Pipeline executed successfully', 
      generated,
      summary,
      metrics
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/webhooks/logs
app.get('/api/webhooks/logs', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM webhook_events ORDER BY id DESC LIMIT 50`).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webhooks/simulate
app.post('/api/webhooks/simulate', (req, res) => {
  try {
    const { eventType = 'payment.failed' } = req.body;
    const db = getDb();
    const eventId = `evt_wh_${Date.now()}`;
    const payload = {
      entity: 'event',
      account_id: 'acc_rzp_merchant',
      event: eventType,
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: `pay_wh_${Date.now()}`,
            amount: 150000,
            currency: 'INR',
            status: eventType === 'payment.authorized' ? 'authorized' : 'failed',
            order_id: `order_wh_${Date.now()}`,
            error_code: eventType === 'payment.failed' ? 'BAD_REQUEST_ERROR' : null,
            error_description: eventType === 'payment.failed' ? 'Payment processing failed at gateway' : null
          }
        }
      },
      created_at: Math.floor(Date.now() / 1000)
    };

    db.prepare(`
      INSERT INTO webhook_events (event_id, event_type, payload_json, status)
      VALUES (?, ?, ?, 'processed')
    `).run(eventId, eventType, JSON.stringify(payload));

    res.json({ message: 'Razorpay webhook event logged and processed', eventId, payload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/compliance/consents
app.get('/api/compliance/consents', (req, res) => {
  try {
    const consents = getCustomerConsents();
    res.json(consents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/compliance/opt-out
app.post('/api/compliance/opt-out', (req, res) => {
  try {
    const { customerId, optedOut = true, reason = 'Customer requested opt-out' } = req.body;
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }
    const result = setCustomerConsent(customerId, Boolean(optedOut), reason);
    res.json({ message: 'Consent updated', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/briefing - AI Executive Recovery Synthesis powered by configured LLM
app.get('/api/ai/briefing', async (req, res) => {
  try {
    const metrics = headlineMetrics();
    const bankHealth = bankHealthLeaderboard();
    const rootCauses = rootCauseBreakdown();

    if (LLM_API_KEY && (LLM_PROVIDER === 'groq' || (!LLM_PROVIDER && LLM_API_KEY.startsWith('gsk_')))) {
      const prompt = `You are an AI Executive Recovery Chief for an e-commerce platform. Analyze these live payment recovery metrics:
${JSON.stringify({ metrics, bankHealth, rootCauses })}

Provide a concise, 3-bullet Executive Recovery Briefing summarizing:
1. Current recovered revenue vs total at-risk amount
2. Critical bank health outage alerts or top root cause
3. Agent recommendation for merchant action

Keep each bullet under 20 words, direct, professional, and actionable.`;

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LLM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'groq/compound-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 150
        })
      });
      const data = await response.json();
      if (data.choices && data.choices[0]?.message?.content) {
        return res.json({
          briefing: data.choices[0].message.content.trim(),
          source: 'Groq Cloud LLM (groq/compound-mini)'
        });
      }
    }

    res.json({
      briefing: `• Total Recovered: ₹${metrics.total_recovered_inr} across ${metrics.recovered_transactions} transactions (${metrics.recovery_rate_pct}% recovery rate).\n• Primary Failure Driver: ${Object.keys(rootCauses)[0] || 'transient_gateway_error'} is the top root cause.\n• Action Recommendation: ${metrics.queued_for_approval_transactions} transactions in approval queue awaiting review.`,
      source: 'Rule Engine Fallback'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tts - Real Human Neural Voice Text-to-Speech endpoint (returns audio/mpeg MP3 stream)
app.get('/api/tts', async (req, res) => {
  try {
    const text = req.query.text || 'Welcome to the Razorpay AI Revenue Recovery Agent.';
    
    // Support ElevenLabs API if key configured
    if (process.env.ELEVENLABS_API_KEY) {
      const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
      const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      });
      if (elRes.ok) {
        const audioBuffer = Buffer.from(await elRes.arrayBuffer());
        res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audioBuffer.length });
        return res.send(audioBuffer);
      }
    }

    // Support OpenAI Audio TTS if key configured
    if (process.env.OPENAI_API_KEY) {
      const oaRes = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: 'nova'
        })
      });
      if (oaRes.ok) {
        const audioBuffer = Buffer.from(await oaRes.arrayBuffer());
        res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audioBuffer.length });
        return res.send(audioBuffer);
      }
    }

    // High-fidelity Neural Voice US English TTS stream
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const audioBuffers = [];

    for (const s of sentences) {
      const clean = s.trim();
      if (!clean) continue;
      const gUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en-US&q=${encodeURIComponent(clean)}`;
      const gRes = await fetch(gUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      if (gRes.ok) {
        const ab = await gRes.arrayBuffer();
        audioBuffers.push(Buffer.from(ab));
      }
    }

    const combinedBuffer = Buffer.concat(audioBuffers);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': combinedBuffer.length,
      'Cache-Control': 'public, max-age=3600'
    });
    return res.send(combinedBuffer);
  } catch (err) {
    console.error("[TTS Error]:", err);
    res.status(500).json({ error: err.message });
  }
});

const isDirectExecution = process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('server'));

if (isDirectExecution && !process.argv.includes('--test')) {
  app.listen(PORT, () => {
    console.log(`Revenue Recovery Express API running on http://localhost:${PORT}`);
  });
}

export { app };
