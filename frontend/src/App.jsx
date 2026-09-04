import React, { useState, useEffect } from 'react';
import { Menu, Filter } from 'lucide-react';
import { playRazorpayChime } from './utils/soundbox.js';

// Shared Components
import Navbar from './components/Navbar.jsx';
import PagesDrawer from './components/PagesDrawer.jsx';
import NudgeModal from './components/NudgeModal.jsx';
import Toast from './components/Toast.jsx';

// Dedicated Page Modules
import OverviewPage from './pages/OverviewPage.jsx';
import SimulatorPage from './pages/SimulatorPage.jsx';
import ApprovalsPage from './pages/ApprovalsPage.jsx';
import WebhooksPage from './pages/WebhooksPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import AuditLogPage from './pages/AuditLogPage.jsx';

export default function App() {
  // Navigation & UI State
  const [activeTab, setActiveTab] = useState('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [dateRange, setDateRange] = useState('all');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [runningPipeline, setRunningPipeline] = useState(false);

  // Core Engine Data State
  const [metrics, setMetrics] = useState(null);
  const [breakdowns, setBreakdowns] = useState(null);
  const [bankHealth, setBankHealth] = useState([]);
  const [counterfactual, setCounterfactual] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [webhooks, setWebhooks] = useState([]);

  // Search & Filter State
  const [auditSearchQuery, setAuditSearchQuery] = useState('');
  const [approvalSearchQuery, setApprovalSearchQuery] = useState('');
  const [selectedApprovals, setSelectedApprovals] = useState([]);
  const [notes, setNotes] = useState({});

  // Simulator & Modal State
  const [simulator, setSimulator] = useState({
    errorCode: 'GATEWAY_ERROR',
    bank: 'HDFC',
    method: 'card',
    amountInr: 1250,
    priorFailures: 0,
    isBusinessHours: 1,
  });
  const [simResult, setSimResult] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [nudgeModal, setNudgeModal] = useState({ open: false, item: null, lang: 'en', type: 'whatsapp' });

  // Guardrail Settings & Compliance State
  const [settings, setSettings] = useState({
    AUTO_RECOVER_MAX_AMOUNT_INR: 2000,
    AUTO_RECOVER_MIN_CONFIDENCE: 0.75,
    QUEUE_MIN_CONFIDENCE: 0.40,
    MAX_RETRIES_PER_TRANSACTION: 2,
    DND_ENABLED: true,
    DND_START_HOUR: 21,
    DND_END_HOUR: 9,
    LLM_PROVIDER: '',
    HAS_LLM_KEY: false,
  });
  const [optOutCustomerId, setOptOutCustomerId] = useState('');

  // Synchronize theme attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Auto-dismiss toast notification after 3.5 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  // Fetch all recovery engine metrics and logs
  const fetchData = async () => {
    try {
      setLoading(true);
      const [mRes, bRes, bhRes, cRes, aRes, lRes, sRes, wRes] = await Promise.all([
        fetch('/api/metrics'),
        fetch('/api/breakdowns'),
        fetch('/api/bank-health'),
        fetch('/api/counterfactual'),
        fetch('/api/approvals'),
        fetch('/api/audit-log'),
        fetch('/api/settings'),
        fetch('/api/webhooks/logs')
      ]);

      setMetrics(await mRes.json());
      setBreakdowns(await bRes.json());
      setBankHealth(await bhRes.json());
      setCounterfactual(await cRes.json());
      const appData = await aRes.json();
      setApprovals(Array.isArray(appData) ? appData : []);
      const auditData = await lRes.json();
      setAuditLog(Array.isArray(auditData) ? auditData : []);
      setSettings(await sRes.json());
      const whData = await wRes.json();
      setWebhooks(Array.isArray(whData) ? whData : []);
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Actions
  const handleRunPipeline = async () => {
    try {
      setRunningPipeline(true);
      setMessage(null);
      const res = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ n: 150 })
      });
      const data = await res.json();
      playRazorpayChime();
      setMessage({ type: 'success', text: `Recovery batch processed! ${data.recovered || 0} recovered.` });
      await fetchData();
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to execute recovery pipeline.' });
    } finally {
      setRunningPipeline(false);
    }
  };

  const handleApprove = async (decisionId) => {
    try {
      const res = await fetch(`/api/approvals/${decisionId}/approve`, { method: 'POST' });
      const data = await res.json();
      playRazorpayChime();
      setMessage({ type: 'success', text: `Merchant decision executed: ${data.result}` });
      fetchData();
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to approve retry.' });
    }
  };

  const handleReject = async (decisionId) => {
    try {
      const note = notes[decisionId] || '';
      const res = await fetch(`/api/approvals/${decisionId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note })
      });
      const data = await res.json();
      setMessage({ type: 'success', text: `Merchant decision executed: ${data.result}` });
      fetchData();
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to reject retry.' });
    }
  };

  const handleBulkApprove = async () => {
    try {
      const res = await fetch('/api/approvals/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisionIds: selectedApprovals })
      });
      const data = await res.json();
      playRazorpayChime();
      setMessage({ type: 'success', text: `Batch approved ${data.approved} transactions!` });
      setSelectedApprovals([]);
      fetchData();
    } catch (err) {
      setMessage({ type: 'error', text: 'Bulk approve failed.' });
    }
  };

  const handleBulkReject = async () => {
    try {
      const res = await fetch('/api/approvals/bulk-reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisionIds: selectedApprovals })
      });
      const data = await res.json();
      setMessage({ type: 'success', text: `Batch rejected ${data.rejected} transactions.` });
      setSelectedApprovals([]);
      fetchData();
    } catch (err) {
      setMessage({ type: 'error', text: 'Bulk reject failed.' });
    }
  };

  const handleUpdateSettings = async (newSettings) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
      const data = await res.json();
      setSettings(data.settings);
      setMessage({ type: 'success', text: 'Merchant safety guardrails updated successfully!' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to update settings.' });
    }
  };

  const handleToggleOptOut = async (custId, optedOut) => {
    if (!custId || !custId.trim()) {
      setMessage({ type: 'error', text: 'Please enter a valid Customer ID.' });
      return;
    }
    try {
      const res = await fetch('/api/compliance/opt-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          customerId: custId.trim(), 
          optedOut, 
          reason: optedOut ? 'Merchant manual opt-out' : 'Customer consent reaffirmed' 
        })
      });
      await res.json();
      setMessage({ 
        type: 'success', 
        text: `Consent updated for ${custId.trim()}: ${optedOut ? 'Opted Out of Nudges' : 'Opted In / Subscribed'}` 
      });
      setOptOutCustomerId('');
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to update customer consent.' });
    }
  };

  const handleSimulateFailure = async () => {
    try {
      setSimulating(true);
      setSimResult(null);
      const payload = {
        ...simulator,
        amountInr: parseFloat(simulator.amountInr) || 1200
      };
      const res = await fetch('/api/simulator/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Server responded with an error');
      }
      setSimResult(data);
      playRazorpayChime();
      setMessage({ type: 'success', text: `Live simulation triggered for ${data.orderId}` });
      fetchData();
    } catch (err) {
      console.error("Simulation error:", err);
      setMessage({ type: 'error', text: `Simulation failed: ${err.message}` });
    } finally {
      setSimulating(false);
    }
  };

  const handleSimulateWebhook = async (eventType) => {
    try {
      const res = await fetch('/api/webhooks/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType })
      });
      await res.json();
      setMessage({ type: 'success', text: `Webhook ${eventType} logged successfully!` });
      fetchData();
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to simulate webhook.' });
    }
  };

  const handleExportCSV = () => {
    if (!auditLog.length) return;
    const headers = ["Order ID", "Customer ID", "Amount (INR)", "Bank", "Root Cause", "Confidence", "Tier", "Queue / Safety Reason", "Action", "Outcome", "Reasoning"];
    const rows = auditLog.map(item => [
      item.order_id,
      item.customer_id,
      item.amount_inr,
      item.bank || '',
      item.root_cause,
      item.confidence,
      item.tier,
      `"${(item.queue_reason || '').replace(/"/g, '""')}"`,
      item.action,
      item.outcome,
      `"${(item.reasoning || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `revenue_recovery_audit_log_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered queries
  const filteredLog = auditLog.filter(item => {
    if (!auditSearchQuery) return true;
    const q = auditSearchQuery.toLowerCase();
    return (
      item.order_id?.toLowerCase().includes(q) ||
      item.customer_id?.toLowerCase().includes(q) ||
      item.root_cause?.toLowerCase().includes(q) ||
      item.bank?.toLowerCase().includes(q)
    );
  });

  const filteredApprovals = approvals.filter(item => {
    if (!approvalSearchQuery) return true;
    const q = approvalSearchQuery.trim().toLowerCase();
    return (
      item.order_id?.toLowerCase().includes(q) ||
      item.customer_id?.toLowerCase().includes(q)
    );
  });

  const pages = [
    { id: 'overview', label: 'Overview Dashboard' },
    { id: 'simulator', label: 'Live Simulator' },
    { id: 'approvals', label: 'Merchant Approval Queue', badgeCount: approvals.length },
    { id: 'webhooks', label: 'Webhook Inspector' },
    { id: 'settings', label: 'Guardrail Settings' },
    { id: 'audit', label: 'Full Audit Log' },
  ];

  const activePage = pages.find(p => p.id === activeTab) || pages[0];

  return (
    <div className="app-container">
      {/* Signature Header */}
      <Navbar 
        metrics={metrics}
        bankHealth={bankHealth}
        theme={theme}
        toggleTheme={toggleTheme}
        runningPipeline={runningPipeline}
        onRunPipeline={handleRunPipeline}
      />

      {/* Main Content Area */}
      <main className="main-content">
        {/* Navigation Bar: 3-Bar Menu Trigger, Active Page Title & Date Filter */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <button 
              className="three-bar-nav-btn"
              onClick={() => setMenuOpen(true)}
              title="Open Navigation Menu"
              aria-label="Open Navigation Menu"
            >
              <Menu size={20} />
            </button>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              {activePage.label}
              {activePage.id === 'approvals' && activePage.badgeCount > 0 && (
                <span className="badge-count">{activePage.badgeCount}</span>
              )}
            </h2>
          </div>

          {/* Date Filter Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-card)', padding: '0.4rem 0.8rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
            <Filter size={16} color="var(--text-sub)" />
            <select 
              className="date-filter-select"
              value={dateRange} 
              onChange={(e) => setDateRange(e.target.value)}
            >
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="all">All Time</option>
            </select>
          </div>
        </div>

        {/* Dynamic Page Router */}
        {loading && !metrics ? (
          <div className="empty-state">Loading Razorpay recovery engine metrics...</div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <OverviewPage 
                metrics={metrics}
                bankHealth={bankHealth}
                breakdowns={breakdowns}
                counterfactual={counterfactual}
              />
            )}

            {activeTab === 'simulator' && (
              <SimulatorPage 
                simulator={simulator}
                setSimulator={setSimulator}
                onSimulate={handleSimulateFailure}
                simulating={simulating}
                simResult={simResult}
              />
            )}

            {activeTab === 'approvals' && (
              <ApprovalsPage 
                approvals={approvals}
                filteredApprovals={filteredApprovals}
                searchQuery={approvalSearchQuery}
                setSearchQuery={setApprovalSearchQuery}
                selectedApprovals={selectedApprovals}
                setSelectedApprovals={setSelectedApprovals}
                onBulkApprove={handleBulkApprove}
                onBulkReject={handleBulkReject}
                onApprove={handleApprove}
                onReject={handleReject}
                notes={notes}
                setNotes={setNotes}
                onOpenNudgeModal={(item) => setNudgeModal({ open: true, item, lang: 'en', type: 'whatsapp' })}
              />
            )}

            {activeTab === 'webhooks' && (
              <WebhooksPage 
                webhooks={webhooks}
                onSimulateWebhook={handleSimulateWebhook}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsPage 
                settings={settings}
                setSettings={setSettings}
                onSaveSettings={handleUpdateSettings}
                optOutCustomerId={optOutCustomerId}
                setOptOutCustomerId={setOptOutCustomerId}
                onToggleOptOut={handleToggleOptOut}
              />
            )}

            {activeTab === 'audit' && (
              <AuditLogPage 
                auditLog={auditLog}
                filteredLog={filteredLog}
                searchQuery={auditSearchQuery}
                setSearchQuery={setAuditSearchQuery}
                onExportCsv={handleExportCSV}
              />
            )}
          </>
        )}
      </main>

      {/* Left-Hand Navigation Drawer */}
      <PagesDrawer 
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        pages={pages}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
      />

      {/* Multi-Channel & Multi-Language Customer Nudge Modal */}
      <NudgeModal 
        modalState={{
          ...nudgeModal,
          setType: (type) => setNudgeModal(prev => ({ ...prev, type })),
          setLang: (lang) => setNudgeModal(prev => ({ ...prev, lang }))
        }}
        onClose={() => setNudgeModal({ open: false, item: null, lang: 'en', type: 'whatsapp' })}
        onNudgeSent={(toastMsg) => setMessage(toastMsg)}
      />

      {/* Toast Notification */}
      <Toast message={message} />
    </div>
  );
}
