import React from 'react';
import { Settings } from 'lucide-react';

export default function SettingsPage({
  settings,
  setSettings,
  onSaveSettings,
  optOutCustomerId,
  setOptOutCustomerId,
  onToggleOptOut
}) {
  return (
    <div className="panel">
      <h3 className="panel-title">Merchant Guardrail Settings</h3>
      <p className="panel-desc">Customize runtime escalation thresholds and safety limits enforced by the revenue recovery agent.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem', maxWidth: '600px' }}>
        <div>
          <label style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            <span>Auto-Recovery Amount Cap (INR)</span>
            <span style={{ color: '#0066ff', fontWeight: 700 }}>₹{settings.AUTO_RECOVER_MAX_AMOUNT_INR}</span>
          </label>
          <input 
            type="range" 
            min="500" 
            max="10000" 
            step="250"
            value={settings.AUTO_RECOVER_MAX_AMOUNT_INR}
            onChange={(e) => setSettings({ ...settings, AUTO_RECOVER_MAX_AMOUNT_INR: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-sub)' }}>Transactions above this amount require human merchant approval.</span>
        </div>

        <div>
          <label style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            <span>Auto-Recovery Min Confidence Threshold</span>
            <span style={{ color: '#10b981', fontWeight: 700 }}>{Math.round(settings.AUTO_RECOVER_MIN_CONFIDENCE * 100)}%</span>
          </label>
          <input 
            type="range" 
            min="0.50" 
            max="0.95" 
            step="0.05"
            value={settings.AUTO_RECOVER_MIN_CONFIDENCE}
            onChange={(e) => setSettings({ ...settings, AUTO_RECOVER_MIN_CONFIDENCE: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-sub)' }}>Minimum AI confidence required to auto-retry without queuing.</span>
        </div>

        <div>
          <label style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            <span>Queue Minimum Confidence Threshold</span>
            <span style={{ color: '#f59e0b', fontWeight: 700 }}>{Math.round(settings.QUEUE_MIN_CONFIDENCE * 100)}%</span>
          </label>
          <input 
            type="range" 
            min="0.20" 
            max="0.60" 
            step="0.05"
            value={settings.QUEUE_MIN_CONFIDENCE}
            onChange={(e) => setSettings({ ...settings, QUEUE_MIN_CONFIDENCE: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-sub)' }}>Decisions below this confidence are immediately stopped.</span>
        </div>

        {/* LLM Provider Configuration Card */}
        <div style={{ background: 'var(--bg-card-sub)', padding: '1rem 1.25rem', borderRadius: '0.65rem', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Active LLM Provider</span>
            <span className="badge tag" style={{ textTransform: 'uppercase', fontWeight: 800, color: '#0066ff' }}>
              {settings.LLM_PROVIDER || 'Rule Engine'}
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-sub)', margin: 0 }}>
            Configured via provider-agnostic <code style={{ color: 'var(--text-main)' }}>LLM_PROVIDER</code> and <code style={{ color: 'var(--text-main)' }}>LLM_API_KEY</code> environment variables. Eliminates prefix sniffing.
          </p>
        </div>

        {/* Compliance Guardrails: DND Time Window */}
        <div style={{ background: 'var(--bg-card-sub)', padding: '1.25rem', borderRadius: '0.65rem', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.925rem' }}>Do-Not-Disturb (DND) Time Window</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-sub)' }}>TRAI regulatory compliance — pauses automated WhatsApp/SMS nudges during night hours</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={settings.DND_ENABLED} 
                onChange={(e) => setSettings({ ...settings, DND_ENABLED: e.target.checked })}
                style={{ width: '18px', height: '18px' }}
              />
              <span style={{ fontWeight: 700, fontSize: '0.85rem', color: settings.DND_ENABLED ? '#10b981' : 'var(--text-sub)' }}>
                {settings.DND_ENABLED ? 'ACTIVE' : 'OFF'}
              </span>
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-sub)', marginBottom: '0.25rem' }}>
                Start Quiet Hours
              </label>
              <select 
                className="input-field" 
                value={settings.DND_START_HOUR}
                onChange={(e) => setSettings({ ...settings, DND_START_HOUR: Number(e.target.value) })}
              >
                <option value={20}>8:00 PM (20:00)</option>
                <option value={21}>9:00 PM (21:00) — Recommended</option>
                <option value={22}>10:00 PM (22:00)</option>
                <option value={23}>11:00 PM (23:00)</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-sub)', marginBottom: '0.25rem' }}>
                End Quiet Hours
              </label>
              <select 
                className="input-field" 
                value={settings.DND_END_HOUR}
                onChange={(e) => setSettings({ ...settings, DND_END_HOUR: Number(e.target.value) })}
              >
                <option value={8}>8:00 AM (08:00)</option>
                <option value={9}>9:00 AM (09:00) — Recommended</option>
                <option value={10}>10:00 AM (10:00)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Customer Opt-Out / Consent Management */}
        <div style={{ background: 'var(--bg-card-sub)', padding: '1.25rem', borderRadius: '0.65rem', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.925rem' }}>Customer Communication Consent Management</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-sub)' }}>Enforce opt-out preferences across WhatsApp/SMS nudges to protect brand reputation</div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input 
              type="text" 
              className="input-field" 
              placeholder="Enter Customer ID (e.g. cust_123)..."
              value={optOutCustomerId}
              onChange={(e) => setOptOutCustomerId(e.target.value)}
              style={{ flex: 1, minWidth: '180px' }}
            />
            <button 
              className="btn btn-danger" 
              style={{ fontSize: '0.8rem' }}
              onClick={() => onToggleOptOut(optOutCustomerId, true)}
            >
              Opt Out Customer
            </button>
            <button 
              className="btn btn-secondary" 
              style={{ fontSize: '0.8rem' }}
              onClick={() => onToggleOptOut(optOutCustomerId, false)}
            >
              Restore Consent
            </button>
          </div>
        </div>

        <button 
          className="btn btn-primary" 
          onClick={() => onSaveSettings(settings)}
        >
          <Settings size={16} /> Save Guardrail Settings
        </button>
      </div>
    </div>
  );
}
