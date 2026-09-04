import React from 'react';
import { Download } from 'lucide-react';

export default function AuditLogPage({
  auditLog,
  filteredLog,
  searchQuery,
  setSearchQuery,
  onExportCsv
}) {
  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h3 className="panel-title">Full Audit Trail</h3>
          <p className="panel-desc">Complete ledger of every decision made by the agent and its verified runtime outcome</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={onExportCsv}>
            <Download size={16} /> Export CSV
          </button>
          <div style={{ width: '280px' }}>
            <input 
              type="text" 
              className="input-field" 
              placeholder="Search order, customer, bank..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Customer</th>
              <th>Amount</th>
              <th>Bank</th>
              <th>Root Cause</th>
              <th>Confidence</th>
              <th>Tier</th>
              <th>Queue / Safety Reason</th>
              <th>Action</th>
              <th>Outcome</th>
              <th>Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {filteredLog.length === 0 ? (
              <tr>
                <td colSpan="11" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-sub)' }}>
                  No audit log entries matching your search.
                </td>
              </tr>
            ) : (
              filteredLog.map((row, idx) => (
                <tr key={idx} style={{ height: '48px' }}>
                  <td style={{ fontWeight: 700, color: '#0066ff', whiteSpace: 'nowrap' }}>{row.order_id}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{row.customer_id}</td>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>₹{row.amount_inr?.toLocaleString()}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{row.bank || '-'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><span className="badge tag">{row.root_cause}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{Math.round(row.confidence * 100)}%</td>
                  <td style={{ whiteSpace: 'nowrap' }}><span className={`badge ${row.tier}`}>{row.tier.toUpperCase()}</span></td>
                  <td style={{ maxWidth: '240px' }}>
                    <div style={{
                      fontSize: '0.78rem',
                      color: row.queue_reason ? '#d97706' : 'var(--text-sub)',
                      fontWeight: row.queue_reason ? 600 : 400,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }} title={row.queue_reason || 'Autonomous execution'}>
                      {row.queue_reason || '-'}
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{row.action}</td>
                  <td style={{ 
                    fontWeight: 700, 
                    whiteSpace: 'nowrap',
                    color: row.outcome === 'success' ? '#10b981' : row.outcome === 'failed' ? '#ef4444' : '#f59e0b' 
                  }}>
                    {row.outcome}
                  </td>
                  <td style={{ maxWidth: '300px' }}>
                    <div style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-sub)',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      lineHeight: '1.35',
                      maxHeight: '2.7em'
                    }} title={row.reasoning}>
                      {row.reasoning}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
