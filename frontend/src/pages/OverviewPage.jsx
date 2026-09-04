import React from 'react';
import { 
  Sparkles, 
  ShieldCheck, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  Activity, 
  DollarSign, 
  Users 
} from 'lucide-react';

export default function OverviewPage({
  metrics,
  bankHealth,
  breakdowns,
  counterfactual
}) {
  if (!metrics) {
    return <div className="empty-state">Loading Razorpay recovery engine metrics...</div>;
  }

  return (
    <div>
      {/* HEADLINE METRIC: Single Clear Batch Recovery Stat Hero Banner */}
      <div className="headline-hero-banner">
        <div className="headline-hero-top">
          <div className="headline-hero-tag">
            <Sparkles size={16} /> MEASURED BATCH RECOVERY STAT
          </div>
          <div className="headline-hero-mode">
            <ShieldCheck size={16} color="#10b981" /> Code Guardrails Enforced
          </div>
        </div>

        <div className="headline-hero-main">
          <div className="headline-hero-stat">
            {metrics.headline_stat || `₹${metrics.total_recovered_inr?.toLocaleString()} of ₹${metrics.total_amount_inr?.toLocaleString()} at-risk recovered (${metrics.recovery_rate_pct}%) across ${metrics.total_transactions} transactions`}
          </div>
          <div className="headline-hero-sub">
            Autonomous revenue recovery measured across the current degraded transaction batch. Dual authorization and compliance guardrails active.
          </div>
        </div>

        {/* Visual Recovery Progress Bar */}
        <div className="headline-progress-container">
          <div className="headline-progress-header">
            <span>Batch Money Recovery Rate</span>
            <span className="headline-progress-pct">{metrics.recovery_rate_pct}% Recovered</span>
          </div>
          <div className="headline-progress-track">
            <div 
              className="headline-progress-fill" 
              style={{ width: `${Math.min(100, Math.max(0, metrics.recovery_rate_pct || 0))}%` }}
            ></div>
          </div>
        </div>

        {/* Sub-Stat Badges */}
        <div className="headline-stat-pills">
          <div className="stat-pill recovered">
            <CheckCircle size={15} />
            <span><strong>₹{metrics.total_recovered_inr?.toLocaleString()}</strong> Recovered ({metrics.recovered_transactions} txns)</span>
          </div>
          <div className="stat-pill at-risk">
            <AlertCircle size={15} />
            <span><strong>₹{Math.max(0, (metrics.total_amount_inr || 0) - (metrics.total_recovered_inr || 0)).toLocaleString()}</strong> Unrecovered / At Risk</span>
          </div>
          <div className="stat-pill queued">
            <Clock size={15} />
            <span><strong>{metrics.queued_for_approval_transactions}</strong> Queued for Review</span>
          </div>
          <div className="stat-pill stopped">
            <ShieldCheck size={15} />
            <span><strong>{metrics.stopped_by_design_transactions}</strong> Suppressed by Safety Guardrails</span>
          </div>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-header">
            <span>Total At Risk</span>
            <AlertCircle size={18} color="var(--text-sub)" />
          </div>
          <div className="metric-value">₹{metrics.total_amount_inr?.toLocaleString()}</div>
          <div className="metric-sub" style={{ color: 'var(--text-sub)' }}> Across {metrics.total_transactions} transactions</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>Total Recovered</span>
            <CheckCircle size={18} color="#10b981" />
          </div>
          <div className="metric-value" style={{ color: '#10b981' }}>₹{metrics.total_recovered_inr?.toLocaleString()}</div>
          <div className="metric-sub">{metrics.recovery_rate_pct}% recovery rate</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>Annual Projected ROI</span>
            <Sparkles size={18} color="#0066ff" />
          </div>
          <div className="metric-value" style={{ color: '#0066ff' }}>
            ₹{metrics.annual_projected_recovery_inr?.toLocaleString()}
          </div>
          <div className="metric-sub" style={{ color: '#0066ff' }}>12-month projected forecast</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>VIP Customers Retained</span>
            <Users size={18} color="#8b5cf6" />
          </div>
          <div className="metric-value" style={{ color: '#8b5cf6' }}>
            {metrics.vip_customers_saved} Customers
          </div>
          <div className="metric-sub" style={{ color: '#8b5cf6' }}>LTV protected from drop-off</div>
        </div>
      </div>

      {/* Bank Gateway Health Leaderboard */}
      <div className="panel" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <Activity size={20} color="#0066ff" />
          <h3 className="panel-title" style={{ margin: 0 }}>Bank Gateway Health Leaderboard</h3>
        </div>
        <p className="panel-desc">Real-time status and failure rate analytics across major issuing banks</p>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
          {bankHealth.map(b => (
            <div key={b.bank} style={{ background: 'var(--bg-card-sub)', padding: '1rem', borderRadius: '0.6rem', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{b.bank}</span>
                <span style={{ 
                  height: '10px', 
                  width: '10px', 
                  borderRadius: '9999px', 
                  background: b.status === 'healthy' ? '#10b981' : b.status === 'degraded' ? '#f59e0b' : '#ef4444' 
                }}></span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: b.status === 'healthy' ? '#10b981' : b.status === 'degraded' ? '#f59e0b' : '#ef4444' }}>
                {b.health_pct}% Health
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-sub)' }}>
                {b.status === 'outage' ? 'Outage Flagged!' : `${b.total} Total Gateway Txns`}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Breakdown Grid */}
      <div className="grid-2">
        {/* Root Cause Panel */}
        <div className="panel">
          <h3 className="panel-title">Root Cause Breakdown</h3>
          <p className="panel-desc">Classified failure causes across all degraded transactions</p>
          <div className="bar-list">
            {breakdowns?.root_causes?.map((item, idx) => {
              const maxCount = breakdowns.root_causes[0]?.count || 1;
              const pct = (item.count / maxCount) * 100;
              const colors = ['blue', 'emerald', 'amber', 'purple'];
              return (
                <div key={item.root_cause} className="bar-item">
                  <div className="bar-label">
                    <span>{item.root_cause}</span>
                    <span style={{ fontWeight: 700 }}>{item.count}</span>
                  </div>
                  <div className="bar-track">
                    <div className={`bar-fill ${colors[idx % colors.length]}`} style={{ width: `${pct}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Escalation Tier Panel */}
        <div className="panel">
          <h3 className="panel-title">Escalation Tier Breakdown</h3>
          <p className="panel-desc">Gated decision tiers enforced by strict code guardrails</p>
          <div className="bar-list">
            {breakdowns?.tiers?.map((item) => {
              const maxCount = Math.max(...breakdowns.tiers.map(t => t.count)) || 1;
              const pct = (item.count / maxCount) * 100;
              const colorClass = item.tier === 'auto' ? 'emerald' : item.tier === 'queue' ? 'amber' : 'purple';
              return (
                <div key={item.tier} className="bar-item">
                  <div className="bar-label">
                    <span className={`badge ${item.tier}`}>{item.tier.toUpperCase()} TIER</span>
                    <span style={{ fontWeight: 700 }}>{item.count} txns</span>
                  </div>
                  <div className="bar-track">
                    <div className={`bar-fill ${colorClass}`} style={{ width: `${pct}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Measured Money Recovered by Root Cause */}
      <div className="panel" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <DollarSign size={20} color="#10b981" />
            <h3 className="panel-title" style={{ margin: 0 }}>Measured Money Recovered by Root Cause</h3>
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-sub)', fontWeight: 600 }}>Batch Financial Reconciliation</span>
        </div>
        <p className="panel-desc">Exact breakdown of measured money recovered versus total at-risk capital for each root cause diagnosis.</p>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Root Cause</th>
                <th>Total At Risk (₹)</th>
                <th>Money Recovered (₹)</th>
                <th>Recovery Rate (%)</th>
                <th>Txns (Recovered / Total)</th>
                <th>Measured Recovery Status</th>
              </tr>
            </thead>
            <tbody>
              {(metrics.by_root_cause || breakdowns?.money_breakdown || []).map((item) => (
                <tr key={item.root_cause}>
                  <td>
                    <span className="badge tag">{item.root_cause}</span>
                  </td>
                  <td style={{ fontWeight: 600 }}>₹{item.at_risk_inr?.toLocaleString()}</td>
                  <td style={{ fontWeight: 700, color: item.recovered_inr > 0 ? '#10b981' : 'var(--text-sub)' }}>
                    ₹{item.recovered_inr?.toLocaleString()}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <div style={{ width: '80px', height: '8px', background: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div 
                          style={{ 
                            width: `${Math.min(100, item.recovery_rate_pct)}%`, 
                            height: '100%', 
                            background: item.recovery_rate_pct > 50 ? '#10b981' : item.recovery_rate_pct > 0 ? '#0066ff' : 'transparent' 
                          }} 
                        />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{item.recovery_rate_pct}%</span>
                    </div>
                  </td>
                  <td>{item.recovered_transactions} / {item.total_transactions}</td>
                  <td>
                    {item.recovered_inr > 0 ? (
                      <span className="badge auto">₹{item.recovered_inr.toLocaleString()} RECOVERED</span>
                    ) : item.root_cause === 'dead_card' || item.root_cause === 'bank_outage' ? (
                      <span className="badge stop">SUPPRESSED BY DESIGN</span>
                    ) : (
                      <span className="badge queue">QUEUED / PENDING</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Counterfactual Panel */}
      <div className="panel">
        <h3 className="panel-title">The Counterfactual: Money Deliberately Not Recovered</h3>
        <p className="panel-desc">Proves safety guardrails work — transactions the agent deliberately suppressed to protect customer experience</p>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Root Cause</th>
                <th>Amount Saved / Not Retried</th>
                <th>Transaction Count</th>
              </tr>
            </thead>
            <tbody>
              {counterfactual.map((row) => (
                <tr key={row.root_cause}>
                  <td><span className="badge tag">{row.root_cause}</span></td>
                  <td style={{ fontWeight: 700, color: '#ef4444' }}>₹{row.amount_inr?.toLocaleString()}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
