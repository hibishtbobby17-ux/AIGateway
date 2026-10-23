import React, { useState, useEffect } from 'react';
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
  const [isServicesModalOpen, setIsServicesModalOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState(api.getToken());

  // Listen for Escape key to close dialogs (WCAG 2.2 AA)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAuthModalOpen(false);
        setIsServicesModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
    { id: 'sso', label: 'SSO & Identity', icon: '🔑' },
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

          {/* Services Hub Modal Trigger */}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setIsServicesModalOpen(true)}
            title="Inspect unified cluster services, ports, and telemetry tools"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <span>⚡</span>
            <span>Services Hub</span>
          </button>

          {/* Health Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', color: 'var(--success)' }}>
            <span className="pulse-dot" />
            <span style={{ fontWeight: 600 }}>ONLINE</span>
          </div>
        </div>
      </header>

      {/* Primary Tab Navigation */}
      <nav className="tabs-container" role="tablist" aria-label="Management Console Navigation">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              className={`tab-btn ${isActive ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              <span aria-hidden="true">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Auth Modal */}
      {isAuthModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsAuthModalOpen(false)}>
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="auth-modal-title" className="modal-title" style={{ fontSize: '1.1rem', margin: 0 }}>
                Administrative Bearer Credentials
              </h2>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-label="Close credentials dialog"
                onClick={() => setIsAuthModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveToken}>
              <div className="modal-body">
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Inject an authorization bearer token (JWT or API Key) into management requests for role verification.
                </p>
                <div className="form-group">
                  <label htmlFor="nav-bearer-token" className="form-label">
                    Bearer Token
                  </label>
                  <input
                    id="nav-bearer-token"
                    type="password"
                    className="form-input"
                    placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    autoComplete="off"
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

      {/* Cluster Infrastructure & Services Modal */}
      {isServicesModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsServicesModalOpen(false)}>
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="services-hub-title"
            style={{ maxWidth: '820px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <span style={{ fontSize: '1.4rem' }} aria-hidden="true">⚡</span>
                <div>
                  <h2 id="services-hub-title" className="modal-title" style={{ fontSize: '1.1rem', margin: 0 }}>
                    Unified Cluster Infrastructure &amp; Services
                  </h2>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Single-pane directory of all containerized runtime services, telemetry endpoints, and stores
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-label="Close services dialog"
                onClick={() => setIsServicesModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1rem', maxHeight: '580px', overflowY: 'auto' }}>
              {/* Service 1: Console */}
              <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid var(--border-glow)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>🖥️</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Management Console</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>http://localhost:8081</div>
                    </div>
                  </div>
                  <span className="badge badge-healthy">Active View</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
                  Admin API, self-service IdP SSO, MCP server registry, RBAC policy simulation, and unified telemetry.
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <span>Port: <strong>8081</strong></span>
                  <span style={{ color: 'var(--success)' }}>● Embedded UI</span>
                </div>
              </div>

              {/* Service 2: Gateway */}
              <div className="glass-panel" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>⚡</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>AI Gateway Core Runtime</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>http://localhost:8080</div>
                    </div>
                  </div>
                  <span className="badge badge-healthy">Online</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
                  High-throughput MCP tool execution, A2A agent routing, rate limiting, and automated OAuth token issuance.
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Port: <strong>8080</strong></span>
                  <a
                    href="http://localhost:8080/healthz"
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', textDecoration: 'none' }}
                  >
                    Check /healthz ↗
                  </a>
                </div>
              </div>

              {/* Service 3: Jaeger */}
              <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid rgba(6, 182, 212, 0.3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>🌐</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--cyan)' }}>Jaeger Distributed Tracing</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>http://localhost:16686</div>
                    </div>
                  </div>
                  <span className="badge badge-healthy">Online</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
                  Full OpenTelemetry tracing collector, distributed waterfalls, latency charts, and service dependency maps.
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Port: <strong>16686</strong> (OTLP :4318)</span>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                      onClick={() => {
                        setIsServicesModalOpen(false);
                        onTabChange('traces');
                      }}
                    >
                      Embed in Traces
                    </button>
                    <a
                      href="http://localhost:16686"
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', textDecoration: 'none' }}
                    >
                      Pop Out ↗
                    </a>
                  </div>
                </div>
              </div>

              {/* Service 4: Prometheus */}
              <div className="glass-panel" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>📊</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Prometheus Metrics</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>http://localhost:9090</div>
                    </div>
                  </div>
                  <span className="badge badge-healthy">Scraping</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
                  Time-series metrics engine scraping gateway latency histograms, requests/sec, error counters, and token budgets.
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Port: <strong>9090</strong></span>
                  <a
                    href="http://localhost:9090"
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', textDecoration: 'none' }}
                  >
                    Open Prometheus ↗
                  </a>
                </div>
              </div>

              {/* Service 5: ClickHouse */}
              <div className="glass-panel" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>⚡</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>ClickHouse OLAP Database</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>http://localhost:8123</div>
                    </div>
                  </div>
                  <span className="badge badge-healthy">Healthy</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
                  High-speed columnar storage for millions of invocation logs, traces, Gantt span hierarchies, and KPI metrics.
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Ports: <strong>8123</strong> (HTTP) / <strong>9000</strong> (TCP)</span>
                  <span style={{ color: 'var(--text-muted)' }}>Native Cluster</span>
                </div>
              </div>

              {/* Service 6: Postgres */}
              <div className="glass-panel" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>🗄️</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>PostgreSQL Datastore</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>localhost:5432</div>
                    </div>
                  </div>
                  <span className="badge badge-healthy">Healthy</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
                  ACID metadata store for multi-tenant isolation, user accounts, SSO providers, RBAC rules, and encrypted credentials.
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Port: <strong>5432</strong></span>
                  <span style={{ color: 'var(--text-muted)' }}>DB: gateway_dev</span>
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                All 6 services running in local Docker Compose mesh with zero port conflicts
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => setIsServicesModalOpen(false)}>
                Close Hub
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
