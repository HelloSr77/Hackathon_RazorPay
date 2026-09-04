import React from 'react';
import { 
  Search, 
  X, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  ShieldAlert, 
  MessageSquare 
} from 'lucide-react';

export default function ApprovalsPage({
  approvals,
  filteredApprovals,
  searchQuery,
  setSearchQuery,
  selectedApprovals,
  setSelectedApprovals,
  onBulkApprove,
  onBulkReject,
  onApprove,
  onReject,
  notes,
  setNotes,
  onOpenNudgeModal
}) {
  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h3 className="panel-title">Merchant Approval Queue</h3>
          <p className="panel-desc">
            Transactions flagged as recoverable but requiring explicit human authorization.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Search Bar for Merchant Approval Queue */}
          <div style={{ position: 'relative', minWidth: '280px' }}>
            <Search size={16} color="var(--text-sub)" style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)' }} />
            <input 
              type="text" 
              className="input-field" 
              placeholder="Search by cust_id or order_id..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '2.25rem', paddingRight: searchQuery ? '2.25rem' : '0.75rem' }}
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-sub)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                title="Clear Search"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {approvals.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button 
                className="btn btn-secondary" 
                style={{ fontSize: '0.8rem' }}
                onClick={() => {
                  if (selectedApprovals.length === filteredApprovals.length && filteredApprovals.length > 0) {
                    setSelectedApprovals([]);
                  } else {
                    setSelectedApprovals(filteredApprovals.map(a => a.decision_id));
                  }
                }}
              >
                {selectedApprovals.length === filteredApprovals.length && filteredApprovals.length > 0 ? 'Deselect All' : 'Select All'}
              </button>

              <button 
                className="btn btn-success" 
                style={{ fontSize: '0.8rem' }}
                disabled={selectedApprovals.length === 0}
                onClick={onBulkApprove}
              >
                <CheckCircle size={14} /> Bulk Approve ({selectedApprovals.length})
              </button>

              <button 
                className="btn btn-danger" 
                style={{ fontSize: '0.8rem' }}
                disabled={selectedApprovals.length === 0}
                onClick={onBulkReject}
              >
                <XCircle size={14} /> Bulk Reject ({selectedApprovals.length})
              </button>
            </div>
          )}
        </div>
      </div>

      {approvals.length === 0 ? (
        <div className="empty-state">
          <CheckCircle size={40} color="#10b981" style={{ marginBottom: '0.75rem' }} />
          <p style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-main)' }}>No transactions currently awaiting approval.</p>
          <p style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>All pending decisions are resolved.</p>
        </div>
      ) : filteredApprovals.length === 0 ? (
        <div className="empty-state">
          <AlertCircle size={40} color="#f59e0b" style={{ marginBottom: '0.75rem' }} />
          <p style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-main)' }}>No approval requests found matching "{searchQuery}"</p>
          <p style={{ fontSize: '0.85rem', marginTop: '0.25rem', marginBottom: '1rem' }}>Try searching with a different Customer ID or Order ID.</p>
          <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => setSearchQuery('')}>
            Clear Search
          </button>
        </div>
      ) : (
        <div className="approval-list">
          {filteredApprovals.map((item) => (
            <div key={item.decision_id} className="approval-card" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
              <input 
                type="checkbox" 
                style={{ marginTop: '0.4rem', cursor: 'pointer', width: '18px', height: '18px' }}
                checked={selectedApprovals.includes(item.decision_id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedApprovals([...selectedApprovals, item.decision_id]);
                  } else {
                    setSelectedApprovals(selectedApprovals.filter(id => id !== item.decision_id));
                  }
                }}
              />
              <div style={{ flex: 1 }}>
                <div className="approval-title">
                  {item.order_id} — <span style={{ color: '#0066ff' }}>₹{item.amount_inr?.toLocaleString()}</span> 
                  <span className="badge tag">{item.method} ({item.bank || 'Direct Bank'})</span>
                </div>
                <div className="approval-sub">Customer ID: {item.customer_id}</div>
                
                <div className="approval-meta">
                  <div>Root Cause: <strong style={{ color: '#0066ff' }}>{item.root_cause}</strong></div>
                  <div>Confidence: <strong style={{ color: '#10b981' }}>{Math.round(item.confidence * 100)}%</strong></div>
                  <div>Churn Risk: <span style={{ color: item.amount_inr > 5000 ? '#ef4444' : '#f59e0b', fontWeight: 700 }}>{item.amount_inr > 5000 ? 'HIGH CHURN RISK' : 'MEDIUM CHURN RISK'}</span></div>
                </div>

                {/* Explicit Queue Reason Callout */}
                <div className="queue-reason-callout">
                  <ShieldAlert size={16} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <span><strong>Queue Reason:</strong> {item.queue_reason || 'Dual-authorization guardrail: High amount or borderline confidence requires merchant review.'}</span>
                </div>

                <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: 'var(--text-main)', background: 'var(--reasoning-bg)', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid var(--reasoning-border)' }}>
                  <strong>Agent Reasoning:</strong> {item.reasoning}
                </p>
              </div>

              <div className="approval-actions">
                <button 
                  className="btn btn-success" 
                  onClick={() => onApprove(item.decision_id)}
                >
                  <CheckCircle size={16} /> Approve Retry
                </button>

                <button 
                  className="btn btn-secondary"
                  style={{ fontSize: '0.8rem' }}
                  onClick={() => onOpenNudgeModal(item)}
                >
                  <MessageSquare size={14} /> Preview AI Nudge
                </button>

                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="Rejection reason (optional)"
                  value={notes[item.decision_id] || ''}
                  onChange={(e) => setNotes({ ...notes, [item.decision_id]: e.target.value })}
                />

                <button 
                  className="btn btn-danger" 
                  onClick={() => onReject(item.decision_id)}
                >
                  <XCircle size={16} /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
