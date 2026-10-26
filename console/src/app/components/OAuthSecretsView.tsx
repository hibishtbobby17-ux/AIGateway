'use client';

import React, { useState } from 'react';

interface OAuthSecretsViewProps {
  projects: any[];
  showBanner: (text: string, type: 'success' | 'error' | 'info') => void;
}

export default function OAuthSecretsView({ projects, showBanner }: OAuthSecretsViewProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id || '');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
    showBanner('Copied to clipboard!', 'success');
  };

  const selectedProj = projects.find((p) => p.id === selectedProjectId) || projects[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span style={{ fontSize: '1.8rem' }}>🔑</span>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              OAuth 2.1 &amp; Secrets Management
            </h2>
            <span className="badge badge-indigo" style={{ fontSize: '0.72rem' }}>
              AES-256-GCM Encrypted
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
            Configure confidential client credentials, automated token rotation, and identity provider federations.
          </p>
        </div>
      </div>

      {/* Project Selector Bar */}
      {projects.length > 0 && (
        <div className="glass-panel" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Scope Project:
          </span>
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="input-field"
            style={{ minWidth: '240px', padding: '8px 12px', fontSize: '0.88rem' }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (/p/{p.slug})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Secret Keys & Identity Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
        {/* Project Client Credentials */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>🛡️</span>
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                Virtual MCP Client Secret
              </h4>
            </div>
            <span className="badge badge-emerald">ACTIVE</span>
          </div>

          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
            Used by external AI clients (Claude Desktop, Cursor) when accessing authenticated project endpoints.
          </p>

          <div style={{ background: 'var(--bg-surface-subtle)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <code style={{ fontSize: '0.82rem', color: 'var(--primary-text)', fontWeight: 600 }}>
              gw_live_sec_••••••••••••••••3a8f
            </code>
            <button
              onClick={() => copyToClipboard('gw_live_sec_e839201ab48f2190cd923a8f', 'client-sec')}
              className="btn-secondary"
              style={{ fontSize: '0.72rem', padding: '3px 8px' }}
            >
              {copiedKey === 'client-sec' ? '✓' : '📋 Copy'}
            </button>
          </div>
        </div>

        {/* Upstream Token Cache */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>🔄</span>
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                Upstream Token Cache
              </h4>
            </div>
            <span className="badge badge-cyan">SYNCED</span>
          </div>

          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
            OAuth 2.0 access &amp; refresh tokens cached in memory and PostgreSQL with automatic proactive refresh.
          </p>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-dim)', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px' }}>
            <span>Cache Status:</span>
            <strong style={{ color: 'var(--accent-emerald)' }}>Active &amp; Valid</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
