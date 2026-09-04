import React from 'react';
import { Send, CheckCircle } from 'lucide-react';

export default function SimulatorPage({
  simulator,
  setSimulator,
  onSimulate,
  simulating,
  simResult
}) {
  return (
    <div className="panel">
      <h3 className="panel-title">Real-Time Payment Failure & Recovery Simulator</h3>
      <p className="panel-desc">
        Inject synthetic payment gateway failures directly into the autonomous recovery pipeline to observe real-time root-cause classification, regulatory guardrail validation, and multi-model execution.
      </p>

      <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
        <div>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            Gateway Error Response
          </label>
          <select 
            className="input-field" 
            value={simulator.errorCode}
            onChange={(e) => setSimulator({ ...simulator, errorCode: e.target.value })}
          >
            <option value="GATEWAY_ERROR">GATEWAY_ERROR — Downstream Switch / Network Timeout (HTTP 504)</option>
            <option value="authentication_failed">authentication_failed — 3DS / OTP Verification Abandoned</option>
            <option value="insufficient_funds">insufficient_funds — Issuer Decline (Insufficient Available Balance)</option>
            <option value="card_declined">card_declined — Instrument Blocked / Velocity Limit Exceeded</option>
            <option value="payment_cancelled">payment_cancelled — Customer Aborted Checkout Session</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            Issuing Bank Switch
          </label>
          <select 
            className="input-field" 
            value={simulator.bank}
            onChange={(e) => setSimulator({ ...simulator, bank: e.target.value })}
          >
            <option value="HDFC">HDFC Bank (Primary Core Switch)</option>
            <option value="ICICI">ICICI Bank (Payment Network Switch)</option>
            <option value="SBI">State Bank of India (Issuer Switch)</option>
            <option value="AXIS">Axis Bank (Core Switch)</option>
            <option value="KOTAK">Kotak Mahindra Bank (Core Switch)</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            Payment Method
          </label>
          <select 
            className="input-field" 
            value={simulator.method}
            onChange={(e) => setSimulator({ ...simulator, method: e.target.value })}
          >
            <option value="card">Credit / Debit Card (Card Network)</option>
            <option value="upi">UPI — Unified Payments Interface (Instant VPA)</option>
            <option value="netbanking">Net Banking (Direct Issuer Gateway)</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            Transaction Amount (₹)
          </label>
          <input 
            type="number" 
            className="input-field" 
            value={simulator.amountInr}
            onChange={(e) => setSimulator({ ...simulator, amountInr: e.target.value })}
            placeholder="e.g. 100, 1000, 5000, 50000"
          />
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            Instrument History & Decline Velocity
          </label>
          <select 
            className="input-field" 
            value={simulator.priorFailures}
            onChange={(e) => setSimulator({ ...simulator, priorFailures: Number(e.target.value) })}
          >
            <option value={0}>0 Prior Declines (Fresh Card Instrument — Maximum Trust)</option>
            <option value={1}>1 Prior Decline (Single Historical Failure — Retry Permitted)</option>
            <option value={2}>2 Prior Declines (Repeat Decline Velocity — Safety Boundary)</option>
            <option value={3}>3 Prior Declines (Terminal Velocity Cap — Guardrail Halt)</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            Regulatory Compliance Window
          </label>
          <select 
            className="input-field" 
            value={simulator.isBusinessHours ?? 1}
            onChange={(e) => setSimulator({ ...simulator, isBusinessHours: Number(e.target.value) })}
          >
            <option value={1}>Active Business Hours (09:00 - 21:00 IST) — Omnichannel Recovery Active</option>
            <option value={0}>Quiet Hours (21:00 - 09:00 IST) — TRAI / RBI DND Window Enforced</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            Cognitive Engine & Fault-Tolerance Mode
          </label>
          <select 
            className="input-field" 
            value={simulator.llmProvider || 'groq'}
            onChange={(e) => setSimulator({ ...simulator, llmProvider: e.target.value })}
          >
            <option value="groq">Groq Cloud (Ultra-Fast Llama / Compound Mini) — Active LLM</option>
            <option value="gemini">Gemini 1.5 Flash — Active Cognitive Reasoner</option>
            <option value="rule">⚠️ Simulate LLM Outage (429 Rate Limit / Down) ➔ Failover to Rule-Based Classifier</option>
          </select>
        </div>
      </div>

      <button 
        className="btn btn-primary" 
        onClick={onSimulate}
        disabled={simulating}
      >
        <Send size={16} />
        {simulating ? 'Evaluating Autonomous Recovery Pipeline...' : 'Simulate Payment Failure'}
      </button>

      {/* Simulation Output Card */}
      {simResult && (
        <div style={{ marginTop: '2rem', padding: '1.25rem', borderRadius: '0.75rem', border: '1px solid #0066ff', background: 'var(--bg-card-sub)' }}>
          <h4 style={{ color: '#0066ff', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CheckCircle size={18} /> Live AI Agent Decision Log
          </h4>
          <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            <strong>Order ID:</strong> {simResult.orderId}
          </p>
          <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            <strong>Cognitive Engine:</strong>{' '}
            <span className="badge" style={{
              background: (simResult.llmProvider?.includes('Rule') || simResult.decision?.llm_provider?.includes('Rule') || simResult.decision?.reasoning?.includes('Heuristic') || simulator.llmProvider === 'rule')
                ? '#ffaa0022' : '#00cc6622',
              color: (simResult.llmProvider?.includes('Rule') || simResult.decision?.llm_provider?.includes('Rule') || simResult.decision?.reasoning?.includes('Heuristic') || simulator.llmProvider === 'rule')
                ? '#ffaa00' : '#00cc66',
              fontWeight: 600,
              border: `1px solid ${(simResult.llmProvider?.includes('Rule') || simResult.decision?.llm_provider?.includes('Rule') || simResult.decision?.reasoning?.includes('Heuristic') || simulator.llmProvider === 'rule')
                ? '#ffaa0055' : '#00cc6655'}`
            }}>
              {(simulator.llmProvider === 'rule' || simResult.llmProvider?.includes('Rule') || simResult.decision?.llm_provider?.includes('Rule'))
                ? 'Heuristic Rule-Based Classifier'
                : (simResult.llmProvider || simResult.decision?.llm_provider || 'Groq Cloud LLM')}
            </span>
            {(simulator.llmProvider === 'rule' || simResult.llmProvider?.includes('Rule') || simResult.decision?.llm_provider?.includes('Rule')) && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#ffaa00', fontWeight: 700, padding: '2px 6px', background: '#ffaa0015', borderRadius: '4px', border: '1px solid #ffaa0033' }}>
                🛡️ Failover Active: Zero-Dep ISO Engine
              </span>
            )}
          </p>
          <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            <strong>Classified Root Cause:</strong> <span className="badge tag">{simResult.decision?.root_cause}</span>
          </p>
          <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            <strong>Escalation Tier:</strong> <span className={`badge ${simResult.decision?.tier}`}>{simResult.decision?.tier?.toUpperCase()}</span>
          </p>
          <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            <strong>Action Chosen:</strong> {simResult.decision?.action_chosen} ({simResult.result?.outcome})
          </p>
          {simResult.recoveryProbability !== null && simResult.recoveryProbability !== undefined && (
            <div style={{ margin: '0.75rem 0', padding: '0.75rem', borderRadius: '0.5rem', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>ML Recovery Probability:</span>
                <span className="badge" style={{
                  background: simResult.recoveryProbability >= 0.70 ? '#00cc6622' : (simResult.recoveryProbability >= 0.40 ? '#ffaa0022' : '#ff444422'),
                  color: simResult.recoveryProbability >= 0.70 ? '#00cc66' : (simResult.recoveryProbability >= 0.40 ? '#ffaa00' : '#ff4444'),
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  border: `1px solid ${simResult.recoveryProbability >= 0.70 ? '#00cc6655' : (simResult.recoveryProbability >= 0.40 ? '#ffaa0055' : '#ff444455')}`
                }}>
                  {(simResult.recoveryProbability * 100).toFixed(1)}%
                </span>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-sub)', marginTop: '0.4rem', marginBottom: 0 }}>
                {simResult.recoveryProbability >= 0.70
                  ? 'Optimal Recovery Conditions: Downstream telemetry confirms transient switch latency under the ₹2,000 threshold during active business hours.'
                  : (simResult.recoveryProbability >= 0.40
                      ? 'Supervised Recovery Opportunity: Moderate likelihood of settlement; routed to merchant approval queue for dual authorization.'
                      : 'Protected Risk Safeguard: Non-retriable failure pattern or card decline limit reached; autonomous retries halted to prevent issuer penalties.')
                }
              </p>
            </div>
          )}
          <p style={{ fontSize: '0.85rem', color: 'var(--text-sub)', marginTop: '0.5rem' }}>
            <strong>Agent Reasoning:</strong> {simResult.decision?.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}
