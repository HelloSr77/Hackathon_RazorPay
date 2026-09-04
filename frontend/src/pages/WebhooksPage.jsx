import React from 'react';
import { Code } from 'lucide-react';

export default function WebhooksPage({
  webhooks,
  onSimulateWebhook
}) {
  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h3 className="panel-title">Razorpay Webhook Event Inspector</h3>
          <p className="panel-desc">Real-time incoming webhook payload logs and event listener verification</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={() => onSimulateWebhook('payment.failed')}>
            <Code size={15} /> Trigger payment.failed Webhook
          </button>
          <button className="btn btn-primary" onClick={() => onSimulateWebhook('payment.authorized')}>
            <Code size={15} /> Trigger payment.authorized Webhook
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {webhooks.length === 0 ? (
          <div className="empty-state">No webhook events logged yet. Click above to simulate an event.</div>
        ) : (
          webhooks.map((wh) => {
            let parsedJson = null;
            try {
              parsedJson = typeof wh.payload_json === 'string' ? JSON.parse(wh.payload_json) : wh.payload_json;
            } catch (e) {
              parsedJson = wh.payload_json;
            }

            return (
              <div key={wh.id} style={{ background: 'var(--bg-card-sub)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                  <span style={{ fontWeight: 700, color: '#0066ff' }}>{wh.event_type}</span>
                  <span style={{ color: 'var(--text-sub)' }}>ID: {wh.event_id} | Received: {wh.received_at}</span>
                </div>
                <pre style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '0.375rem', fontSize: '0.8rem', color: 'var(--text-main)', overflowX: 'auto' }}>
                  {JSON.stringify(parsedJson, null, 2)}
                </pre>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
