import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { PolicyRule, DryRunResponse } from '../types';

export const PoliciesView: React.FC = () => {
  const [policies, setPolicies] = useState<PolicyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [ruleName, setRuleName] = useState('');
  const [effect, setEffect] = useState<'ALLOW' | 'DENY'>('ALLOW');
  const [actions, setActions] = useState('mcp:tools:call');
  const [resources, setResources] = useState('*');
  const [roles, setRoles] = useState('tool-consumer');
  const [submitting, setSubmitting] = useState(false);

  // Dry Run Simulator State
  const [drySubject, setDrySubject] = useState('alice');
  const [dryRoles, setDryRoles] = useState('tool-consumer');
  const [dryAction, setDryAction] = useState('mcp:tools:call');
  const [dryResource, setDryResource] = useState('github::create_issue');
  const [dryResult, setDryResult] = useState<DryRunResponse | null>(null);
  const [drySimulating, setDrySimulating] = useState(false);

  const loadPolicies = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listPolicies();
      setPolicies(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to list policies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPolicies();
  }, [api.getTenantId()]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const actList = actions.split(',').map((s) => s.trim()).filter(Boolean);
      const resList = resources.split(',').map((s) => s.trim()).filter(Boolean);
      const roleList = roles.split(',').map((s) => s.trim()).filter(Boolean);

      await api.createPolicy({
        name: ruleName,
        effect,
        actions: actList,
        resources: resList,
        roles: roleList,
      });

      setIsModalOpen(false);
      setRuleName('');
      await loadPolicies();
    } catch (err: any) {
      setError(err.message || 'Failed to create policy rule');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete authorization rule "${name}"?`)) return;
    try {
      await api.deletePolicy(id);
      await loadPolicies();
    } catch (err: any) {
      setError(err.message || 'Failed to delete policy');
    }
  };

  const handleRunSimulation = async (e: React.FormEvent) => {
    e.preventDefault();
    setDrySimulating(true);
    try {
      const roleList = dryRoles.split(',').map((s) => s.trim()).filter(Boolean);
      const res = await api.dryRunPolicy({
        subject: drySubject,
        roles: roleList,
        action: dryAction,
        resource: dryResource,
      });
      setDryResult(res);
    } catch (err: any) {
      setError(err.message || 'Dry-run evaluation failed');
    } finally {
      setDrySimulating(false);
    }
  };

  return (
    <div className="policies-view">
      <div className="filter-bar">
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700 }}>
            Tenant Authorization & RBAC/ABAC Policies
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Fine-grained access control policies evaluated at gateway trust boundaries.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={loadPolicies}>Refresh</button>
          <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>+ Add Policy Rule</button>
        </div>
      </div>

      {error && <div className="alert-banner alert-error" style={{ marginTop: '1rem' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '1.5rem', marginTop: '1.5rem' }}>
        {/* Left: Policy Rules Table */}
        <div className="glass-panel">
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', fontWeight: 600 }}>
            Configured Policy Rules ({policies.length})
          </div>

          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading rules...</div>
          ) : policies.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🛡️</div>
              <div className="empty-state-title">No Policies Defined</div>
              <div className="empty-state-desc">By default, all gateway requests without explicit ALLOW rules are denied.</div>
              <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>+ Add Allow Rule</button>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rule Name</th>
                    <th>Effect</th>
                    <th>Actions</th>
                    <th>Resources</th>
                    <th>Required Roles</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((p) => {
                    const isAllow = p.effect === 'ALLOW';

                    return (
                      <tr key={p.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
                          <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.id}</div>
                        </td>
                        <td>
                          <span className={`badge badge-${isAllow ? 'healthy' : 'unhealthy'}`}>
                            {p.effect}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {p.actions.map((act) => (
                              <span key={act} className="code-pill" style={{ fontSize: '0.7rem' }}>{act}</span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {p.resources.map((res) => (
                              <span key={res} className="code-pill" style={{ fontSize: '0.7rem' }}>{res}</span>
                            ))}
                          </div>
                        </td>
                        <td>
                          {p.roles && p.roles.length > 0 ? p.roles.join(', ') : <span style={{ color: 'var(--text-muted)' }}>Any</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p.id, p.name)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Interactive Dry-Run Simulator */}
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.35rem' }}>
            ⚡ Policy Dry-Run Simulator
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1.25rem' }}>
            Test authorization decisions before rolling out changes to production.
          </p>

          <form onSubmit={handleRunSimulation} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Subject (User / Client)</label>
              <input
                type="text"
                required
                className="form-input"
                value={drySubject}
                onChange={(e) => setDrySubject(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Roles (comma separated)</label>
              <input
                type="text"
                className="form-input"
                value={dryRoles}
                onChange={(e) => setDryRoles(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Action</label>
              <input
                type="text"
                required
                className="form-input"
                value={dryAction}
                onChange={(e) => setDryAction(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Resource URI</label>
              <input
                type="text"
                required
                className="form-input"
                value={dryResource}
                onChange={(e) => setDryResource(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: '0.5rem' }} disabled={drySimulating}>
              {drySimulating ? 'Simulating...' : 'Evaluate Access →'}
            </button>
          </form>

          {/* Simulation Output Card */}
          {dryResult && (
            <div
              style={{
                marginTop: '1.25rem',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
                background: dryResult.decision === 'ALLOW' ? 'var(--success-bg)' : 'var(--danger-bg)',
                border: `1px solid ${dryResult.decision === 'ALLOW' ? 'var(--success-border)' : 'var(--danger-border)'}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '1.1rem', color: dryResult.decision === 'ALLOW' ? 'var(--success)' : 'var(--danger)' }}>
                  {dryResult.decision === 'ALLOW' ? '✓ ACCESS GRANTED' : '✕ ACCESS DENIED'}
                </span>
                <span className={`badge badge-${dryResult.decision === 'ALLOW' ? 'healthy' : 'unhealthy'}`}>
                  {dryResult.decision}
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                {dryResult.evaluation_reason}
              </div>
              {dryResult.matched_rule_name && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                  Matching Rule: <strong>{dryResult.matched_rule_name}</strong> (<span className="mono">{dryResult.matched_rule_id}</span>)
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Policy Rule Modal */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Create Policy Rule</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setIsModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Rule Name</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="Allow Tool Consumers"
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Effect</label>
                  <select className="form-select" value={effect} onChange={(e) => setEffect(e.target.value as any)}>
                    <option value="ALLOW">ALLOW</option>
                    <option value="DENY">DENY</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Actions (comma separated)</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="mcp:tools:call, a2a:tasks:submit"
                    value={actions}
                    onChange={(e) => setActions(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Resources (comma separated, e.g. github::*, *)</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="github::*, postgres::*"
                    value={resources}
                    onChange={(e) => setResources(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Roles (comma separated)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="tool-consumer, developer"
                    value={roles}
                    onChange={(e) => setRoles(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create Policy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
