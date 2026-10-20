import React, { useState } from 'react';
import { api } from '../api/client';
import { UserProfile } from '../types';

interface Props {
  activeTab: string;
  onTabChange: (tab: string) => void;
  tenantId: string;
  onTenantChange: (tenantId: string) => void;
  currentUser?: UserProfile | null;
  onLogout?: () => void;
}

export const Navbar: React.FC<Props> = ({ activeTab, onTabChange, tenantId, onTenantChange, currentUser, onLogout }) => {
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState(api.getToken());

  const handleSaveToken = (e: React.FormEvent) => {
    e.preventDefault();
    api.setToken(tokenInput);
    setIsAuthModalOpen(false);
  };

  const tabs = [
    { id: 'topology', label: 'Topology Graph', icon: '🌐' },
    { id: 'metrics', label: 'Metrics & KPIs', icon: '📊' },
    { id: 'mcp', label: 'MCP Servers', icon: '⚡' },
    { id: 'agents', label: 'A2A Agents', icon: '🤖' },
    { id: 'traces', label: 'Trace Waterfall', icon: '🔍' },
    { id: 'logs', label: 'Correlated Logs', icon: '📜' },
    { id: 'tasks', label: 'Tasks & Calls', icon: '📋' },
    { id: 'policies', label: 'Policies & RBAC', icon: '🛡️' },
    { id: 'audit', label: 'Security Audit', icon: '🔒' },
  ];

  return (
    <>
      <header className="header-bar">
        <div className="brand-section">
          <div className="brand-logo-icon">
            <span style={{ fontSize: '1.2rem', color: '#fff' }}>⚡</span>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span className="brand-title">AI Gateway Console</span>
              <span className="brand-badge">v1.0.0</span>
            </div>
          </div>
        </div>

        <div className="nav-controls">
          {/* Tenant Context Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-surface)', padding: '0.35rem 0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tenant:</span>
            <select
              style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
              value={tenantId}
              onChange={(e) => onTenantChange(e.target.value)}
            >
              <option value="tenant-1" style={{ background: '#0e1422' }}>tenant-1 (Primary)</option>
              <option value="tenant-2" style={{ background: '#0e1422' }}>tenant-2 (Staging)</option>
              <option value="tenant-enterprise" style={{ background: '#0e1422' }}>tenant-enterprise</option>
            </select>
          </div>

          {/* Logged in User Profile Badge */}
          {currentUser && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              background: 'var(--bg-surface)',
              padding: '0.35rem 0.65rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.8125rem'
            }}>
              <span style={{ color: 'var(--cyan)' }}>👤</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{currentUser.username}</span>
              <span style={{
                background: 'var(--primary-glow)',
                color: '#fff',
                fontSize: '0.7rem',
                padding: '0.1rem 0.4rem',
                borderRadius: '4px',
                fontWeight: 600
              }}>
                {currentUser.roles?.[0] || 'admin'}
              </span>
            </div>
          )}

          {/* Sign Out Button */}
          {onLogout && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={onLogout}
              title="Sign out of Console"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <span>🚪</span>
              <span>Sign Out</span>
            </button>
          )}

          {/* Health Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', color: 'var(--success)' }}>
            <span className="pulse-dot" />
            <span style={{ fontWeight: 600 }}>ONLINE</span>
          </div>
        </div>
      </header>

      {/* Primary Tab Navigation */}
      <nav className="tabs-container">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              className={`tab-btn ${isActive ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Auth Modal */}
      {isAuthModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsAuthModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Administrative Bearer Credentials</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setIsAuthModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveToken}>
              <div className="modal-body">
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Inject an authorization bearer token (JWT or API Key) into management requests for role verification.
                </p>
                <div className="form-group">
                  <label className="form-label">Bearer Token</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setTokenInput('');
                    api.setToken('');
                    setIsAuthModalOpen(false);
                  }}
                >
                  Clear Token
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Credentials
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
