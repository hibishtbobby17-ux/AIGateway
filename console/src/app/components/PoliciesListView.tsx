'use client';

import React, { useState } from 'react';

interface PolicyItem {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  associatedGateway: string;
  action: 'ALLOW' | 'DENY' | 'RATE_LIMIT';
  rateLimit: string;
  status: 'active' | 'draft';
  lastUpdated: string;
}

interface PoliciesListViewProps {
  onNavigateToPolicyEditor: () => void;
  showBanner: (text: string, type: 'success' | 'error' | 'info') => void;
}

export default function PoliciesListView({
  onNavigateToPolicyEditor,
  showBanner,
}: PoliciesListViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [policies, setPolicies] = useState<PolicyItem[]>([
    {
      id: 'pol-01',
      name: 'Enforce Production Tool Restrictions',
      description: 'Restrict sensitive database mutations and enforce token bucket rate limits',
      endpoint: '/p/production/mcp/tools/*',
      associatedGateway: 'gateway-default-01',
      action: 'RATE_LIMIT',
      rateLimit: '1200 req/min (Burst 150)',
      status: 'active',
      lastUpdated: '10 mins ago'
    },
    {
      id: 'pol-02',
      name: 'Deny Raw SQL Dropping & Schema Alteration',
      description: 'Block all db_drop_table, db_alter_table for autonomous agent callers',
      endpoint: '/p/production/mcp/tools/db_*',
      associatedGateway: 'All Active Gateways',
      action: 'DENY',
      rateLimit: 'N/A (Strict Block)',
      status: 'active',
      lastUpdated: '2 hours ago'
    },
    {
      id: 'pol-03',
      name: 'Permit Read-only Research Tools',
      description: 'Allow unrestricted tool invocation for search, weather, and math queries',
      endpoint: '/p/support/mcp/tools/*',
      associatedGateway: 'gateway-default-01',
      action: 'ALLOW',
      rateLimit: '3000 req/min',
      status: 'active',
      lastUpdated: 'Yesterday'
    },
    {
      id: 'pol-04',
      name: 'Staging Environment Test Policy',
      description: 'Simulated rate limits for QA testing and load characterization',
      endpoint: '/p/staging/mcp/*',
      associatedGateway: 'gateway-us-east',
      action: 'RATE_LIMIT',
      rateLimit: '600 req/min',
      status: 'draft',
      lastUpdated: '3 days ago'
    }
  ]);

  const filtered = policies.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.endpoint.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.associatedGateway.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDelete = (id: string, name: string) => {
    setPolicies(policies.filter(p => p.id !== id));
    showBanner(`Deleted policy "${name}"`, 'info');
  };

  const handleToggle = (id: string) => {
    setPolicies(policies.map(p => p.id === id ? {
      ...p,
      status: p.status === 'active' ? 'draft' : 'active'
    } : p));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.025em' }}>
              Configured Policies & Endpoint Bindings
            </h1>
            <span className="badge badge-emerald">Submenu: Policies</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '4px' }}>
            Inventory of all security policies, their associated project endpoints, and enforcement AI gateways.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={onNavigateToPolicyEditor}
            className="btn-primary"
            style={{ height: '38px', padding: '0 16px' }}
          >
            + Create New Policy
          </button>
        </div>
      </div>

      {/* Search & Filter Strip */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ minWidth: '320px' }}>
          <input
            type="text"
            className="input-field"
            placeholder="Search policies by name, endpoint, or gateway..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ height: '36px', fontSize: '0.84rem' }}
          />
        </div>

        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Showing <strong>{filtered.length}</strong> active & draft policies
        </span>
      </div>

      {/* Policies Table */}
      <div className="glass-panel" style={{ padding: '0', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface-subtle)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '14px 18px' }}>Policy Name & ID</th>
                <th style={{ padding: '14px 18px' }}>Associated Endpoint</th>
                <th style={{ padding: '14px 18px' }}>Associated AI Gateway</th>
                <th style={{ padding: '14px 18px' }}>Action & Effect</th>
                <th style={{ padding: '14px 18px' }}>Enforced Rate Limit</th>
                <th style={{ padding: '14px 18px' }}>Status</th>
                <th style={{ padding: '14px 18px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((policy) => (
                <tr key={policy.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {/* Name */}
                  <td style={{ padding: '16px 18px' }}>
                    <strong style={{ color: 'var(--text-main)', display: 'block', fontSize: '0.9rem' }}>
                      {policy.name}
                    </strong>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      {policy.description}
                    </span>
                  </td>

                  {/* Associated Endpoint */}
                  <td style={{ padding: '16px 18px' }}>
                    <code className="font-mono" style={{ background: 'var(--primary-subtle)', color: 'var(--primary-text)', fontSize: '0.78rem' }}>
                      {policy.endpoint}
                    </code>
                  </td>

                  {/* Associated AI Gateway */}
                  <td style={{ padding: '16px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>⚡</span>
                      <strong style={{ color: 'var(--text-main)', fontSize: '0.82rem' }}>
                        {policy.associatedGateway}
                      </strong>
                    </div>
                  </td>

                  {/* Action */}
                  <td style={{ padding: '16px 18px' }}>
                    <span className={`badge ${
                      policy.action === 'ALLOW' ? 'badge-emerald' : policy.action === 'DENY' ? 'badge-rose' : 'badge-amber'
                    }`} style={{ fontSize: '0.72rem', fontWeight: 700 }}>
                      {policy.action}
                    </span>
                  </td>

                  {/* Rate Limit */}
                  <td style={{ padding: '16px 18px', fontSize: '0.8rem', color: 'var(--text-main)' }}>
                    {policy.rateLimit}
                  </td>

                  {/* Status */}
                  <td style={{ padding: '16px 18px' }}>
                    <span className={`badge ${policy.status === 'active' ? 'badge-emerald' : 'badge-cyan'}`}>
                      {policy.status === 'active' ? '● Enforced' : '○ Draft'}
                    </span>
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '16px 18px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                      <button
                        onClick={onNavigateToPolicyEditor}
                        className="btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggle(policy.id)}
                        className="btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                      >
                        {policy.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => handleDelete(policy.id, policy.name)}
                        className="btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '0.75rem', color: 'var(--danger)' }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
