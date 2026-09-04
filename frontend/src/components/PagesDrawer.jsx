import React from 'react';
import { X } from 'lucide-react';

export default function PagesDrawer({
  isOpen,
  onClose,
  pages,
  activeTab,
  onSelectTab
}) {
  if (!isOpen) return null;

  return (
    <div className="pages-drawer-overlay" onClick={onClose}>
      <div className="pages-drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="pages-drawer-header">
          <span className="pages-drawer-title">Navigation Pages</span>
          <button 
            className="pages-drawer-close-btn" 
            onClick={onClose}
            title="Close Menu"
            aria-label="Close Menu"
          >
            <X size={20} />
          </button>
        </div>

        <div className="pages-drawer-list">
          {pages.map((p) => (
            <button
              key={p.id}
              className={`pages-drawer-item ${activeTab === p.id ? 'active' : ''}`}
              onClick={() => {
                onSelectTab(p.id);
                onClose();
              }}
            >
              <span>{p.label}</span>
              {p.id === 'approvals' && p.badgeCount > 0 && (
                <span 
                  className="badge-count" 
                  style={{ 
                    background: activeTab === p.id ? '#ffffff' : '#ef4444', 
                    color: activeTab === p.id ? '#ef4444' : '#ffffff' 
                  }}
                >
                  {p.badgeCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
