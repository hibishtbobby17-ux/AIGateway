import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { SSOProvider, SSODiscoveryResult } from '../types';

interface Preset {
  name: string;
  id: string;
  icon: string;
  issuerUrl: string;
  clientIdPlaceholder: string;
  defaultClaims: Record<string, string>;
}

const PRESETS: Preset[] = [
  {
    name: 'Okta',
    id: 'okta',
    icon: '🔵',
    issuerUrl: 'https://dev-12345.okta.com',
    clientIdPlaceholder: '0oa12345abcdef67890',
    defaultClaims: { 'okta_admins': 'platform-admin', 'okta_developers': 'tenant-admin' },
  },
  {
    name: 'Microsoft Entra ID',
    id: 'entra-id',
    icon: '🔷',
    issuerUrl: 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0',
    clientIdPlaceholder: '9f8e7d6c-5b4a-3210-fedc-ba9876543210',
    defaultClaims: { 'EntraGlobalAdmins': 'platform-admin', 'CloudArchitects': 'tenant-admin' },
  },
  {
    name: 'Auth0',
    id: 'auth0',
    icon: '🛡️',
    issuerUrl: 'https://acme-prod.us.auth0.com',
    clientIdPlaceholder: 'K9j8H7g6F5e4D3c2B1a0',
    defaultClaims: { 'admin': 'platform-admin', 'operator': 'tenant-admin' },
  },
  {
    name: 'Google Workspace',
    id: 'google',
    icon: '🌐',
    issuerUrl: 'https://accounts.google.com',
    clientIdPlaceholder: '1234567890-abcdef.apps.googleusercontent.com',
    defaultClaims: { 'admins@company.com': 'platform-admin' },
  },
  {
    name: 'Keycloak / Generic OIDC',
    id: 'keycloak',
    icon: '🔑',
    issuerUrl: 'https://auth.internal.company.com/realms/master',
    clientIdPlaceholder: 'ai-gateway-client',
    defaultClaims: { 'realm-admin': 'platform-admin', 'gw-operator': 'tenant-admin' },
  },
];

export const SSOConfigView: React.FC = () => {
  const [providers, setProviders] = useState<SSOProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formId, setFormId] = useState('');
  const [formIssuer, setFormIssuer] = useState('');
  const [formClientId, setFormClientId] = useState('');
  const [formClientSecret, setFormClientSecret] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [formClaims, setFormClaims] = useState<Array<{ key: string; role: string }>>([
    { key: 'okta-admins', role: 'platform-admin' },
  ]);

  // Test Discovery State
  const [discoveryTesting, setDiscoveryTesting] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<SSODiscoveryResult | null>(null);

  // Simulation State
  const [simulatingProviderId, setSimulatingProviderId] = useState<string | null>(null);
  const [simulationResult, setSimulationResult] = useState<string | null>(null);

  const fetchProviders = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.listSSOProviders();
      setProviders(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load identity providers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const openNewModal = (preset?: Preset) => {
    setEditingId(null);
    setDiscoveryResult(null);
    if (preset) {
      setFormName(preset.name);
      setFormId(preset.id);
      setFormIssuer(preset.issuerUrl);
      setFormClientId('');
      setFormClientSecret('');
      setFormActive(true);
      setFormClaims(
        Object.entries(preset.defaultClaims).map(([k, v]) => ({ key: k, role: v }))
      );
    } else {
      setFormName('');
      setFormId('');
      setFormIssuer('');
      setFormClientId('');
      setFormClientSecret('');
      setFormActive(true);
      setFormClaims([{ key: 'admin-group', role: 'platform-admin' }]);
    }
    setIsModalOpen(true);
  };

  const openEditModal = (provider: SSOProvider) => {
    setEditingId(provider.id);
    setDiscoveryResult(null);
    setFormName(provider.name);
    setFormId(provider.id);
    setFormIssuer(provider.issuer_url);
    setFormClientId(provider.client_id);
    setFormClientSecret(provider.client_secret || '');
    setFormActive(provider.active);
    const claims = Object.entries(provider.claim_mapping || {}).map(([k, v]) => ({
      key: k,
      role: v,
    }));
    setFormClaims(claims.length > 0 ? claims : [{ key: '', role: 'tool-consumer' }]);
    setIsModalOpen(true);
  };

  const handleTestDiscovery = async () => {
    if (!formIssuer.trim()) {
      alert('Please enter an Issuer URL first.');
      return;
    }
    setDiscoveryTesting(true);
    setDiscoveryResult(null);
    try {
      const res = await api.testSSODiscovery(formIssuer.trim());
      setDiscoveryResult(res);
    } catch (err: any) {
      setDiscoveryResult({
        status: 'error',
        message: err.message || 'OIDC discovery request failed',
      });
    } finally {
      setDiscoveryTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const claimMapping: Record<string, string> = {};
    formClaims.forEach((c) => {
      if (c.key.trim()) {
        claimMapping[c.key.trim()] = c.role;
      }
    });

    try {
      await api.saveSSOProvider({
        id: formId.trim() || undefined,
        name: formName.trim(),
        issuer_url: formIssuer.trim(),
        client_id: formClientId.trim(),
        client_secret: formClientSecret.trim() || undefined,
        claim_mapping: claimMapping,
        active: formActive,
      });
      setIsModalOpen(false);
      fetchProviders();
    } catch (err: any) {
      alert('Failed to save SSO provider: ' + err.message);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove ${name}? Users federating via this IdP will no longer be able to log in.`)) {
      return;
    }
    try {
      await api.deleteSSOProvider(id);
      fetchProviders();
    } catch (err: any) {
      alert('Failed to delete provider: ' + err.message);
    }
  };

  const handleSimulateLogin = async (p: SSOProvider) => {
    setSimulatingProviderId(p.id);
    setSimulationResult(null);
    try {
      const firstGroup = Object.keys(p.claim_mapping || {})[0] || 'admin';
      const res = await api.simulateSSOLogin(p.id, `operator@${p.id}.example`, undefined, [firstGroup]);
      setSimulationResult(`Simulation Success: Authenticated as "${res.user.username}" with roles: [${res.user.roles.join(', ')}]. Session cookie set.`);
    } catch (err: any) {
      setSimulationResult(`Simulation Failed: ${err.message}`);
    } finally {
      setSimulatingProviderId(null);
    }
  };

  const addClaimRow = () => {
    setFormClaims([...formClaims, { key: '', role: 'tenant-admin' }]);
  };

  const removeClaimRow = (index: number) => {
    setFormClaims(formClaims.filter((_, i) => i !== index));
  };

  return (
    <div className="view-container">
      {/* View Header */}
      <div className="view-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.25rem 0', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span>🔑</span>
            <span>Single Sign-On (SSO) & External Identity Providers</span>
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>
            Federate the AI Gateway Console and data plane with enterprise OpenID Connect (OIDC) identity providers.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => openNewModal()}>
          <span>+ Register New IdP</span>
        </button>
      </div>

      {simulationResult && (
        <div style={{
          background: simulationResult.startsWith('Simulation Success') ? 'rgba(16, 185, 129, 0.15)' : 'var(--danger-bg)',
          border: `1px solid ${simulationResult.startsWith('Simulation Success') ? 'var(--success)' : 'var(--danger-border)'}`,
          borderRadius: 'var(--radius-md)',
          padding: '0.75rem 1.25rem',
          marginBottom: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.875rem',
          color: simulationResult.startsWith('Simulation Success') ? '#6ee7b7' : '#fca5a5',
        }}>
          <div>{simulationResult}</div>
          <button
            onClick={() => setSimulationResult(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Preset Quick Start Templates */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem', fontWeight: 600 }}>
          Quick-Start Federation Presets
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
        }}>
          {PRESETS.map((preset) => (
            <div
              key={preset.id}
              onClick={() => openNewModal(preset)}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--cyan)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
                e.currentTarget.style.transform = 'none';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>{preset.icon}</span>
                <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{preset.name}</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Pre-configured discovery & claim mappings
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Configured Providers */}
      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ width: '28px', height: '28px', margin: '0 auto 1rem auto' }}></div>
          <div>Loading external identity providers...</div>
        </div>
      ) : error ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--danger)' }}>
          ⚠️ {error}
        </div>
      ) : providers.length === 0 ? (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px dashed var(--border-glow)',
          borderRadius: 'var(--radius-lg)',
          padding: '3rem 2rem',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🛡️</div>
          <h3 style={{ fontSize: '1.2rem', margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>No External IdPs Configured Yet</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', maxWidth: '480px', margin: '0 auto 1.5rem auto' }}>
            Federate your identity infrastructure to allow your organization's engineers and administrators to log into the AI Gateway with corporate credentials.
          </p>
          <button className="btn btn-primary" onClick={() => openNewModal(PRESETS[0])}>
            <span>Configure Okta / Entra ID</span>
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {providers.map((p) => (
            <div
              key={p.id}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: '1.5rem',
                boxShadow: 'var(--shadow-md)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, var(--primary), var(--cyan))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.25rem',
                  }}>
                    🔑
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
                      <code style={{ fontSize: '0.75rem', background: 'var(--bg-surface)', padding: '0.15rem 0.45rem', borderRadius: '4px', color: 'var(--text-muted)' }}>
                        {p.id}
                      </code>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--cyan)', marginTop: '0.2rem' }}>
                      {p.issuer_url}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.25rem 0.65rem',
                    borderRadius: '999px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: p.active ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                    color: p.active ? 'var(--success)' : 'var(--text-muted)',
                    border: `1px solid ${p.active ? 'var(--success)' : 'var(--border-subtle)'}`,
                  }}>
                    <span className="pulse-dot" style={{ background: p.active ? 'var(--success)' : 'var(--text-muted)' }} />
                    <span>{p.active ? 'ACTIVE & FEDERATED' : 'DISABLED'}</span>
                  </span>

                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleSimulateLogin(p)}
                    disabled={simulatingProviderId === p.id}
                    title="Simulate end-to-end token exchange and role mapping"
                  >
                    {simulatingProviderId === p.id ? 'Testing...' : '⚡ Test SSO'}
                  </button>

                  <button className="btn btn-secondary btn-sm" onClick={() => openEditModal(p)}>
                    Edit
                  </button>

                  <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(p.id, p.name)} style={{ color: 'var(--danger)' }}>
                    Delete
                  </button>
                </div>
              </div>

              {/* Provider Details & Claim Mappings Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 2fr',
                gap: '1.5rem',
                background: 'var(--bg-surface)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem',
                border: '1px solid var(--border-subtle)',
              }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Client ID</div>
                  <code style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{p.client_id}</code>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Role Claim Mappings</div>
                  {p.claim_mapping && Object.keys(p.claim_mapping).length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {Object.entries(p.claim_mapping).map(([claim, role]) => (
                        <div
                          key={claim}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-subtle)',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                          }}
                        >
                          <span style={{ color: 'var(--text-muted)' }}>{claim}</span>
                          <span style={{ color: 'var(--cyan)' }}>➔</span>
                          <span style={{ fontWeight: 600, color: 'var(--primary-glow)' }}>{role}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Default role: tool-consumer</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Register / Edit Modal */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                {editingId ? 'Edit External Identity Provider' : 'Register Enterprise Identity Provider'}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setIsModalOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Provider Name</label>
                    <input
                      type="text"
                      required
                      className="form-input"
                      placeholder="e.g. Okta Corporate"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Provider ID (Slug)</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. okta-corp"
                      value={formId}
                      disabled={!!editingId}
                      onChange={(e) => setFormId(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label">Issuer URL (OpenID Discovery Root)</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="url"
                      required
                      className="form-input"
                      style={{ flex: 1 }}
                      placeholder="https://company.okta.com"
                      value={formIssuer}
                      onChange={(e) => setFormIssuer(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleTestDiscovery}
                      disabled={discoveryTesting}
                    >
                      {discoveryTesting ? 'Testing...' : '⚡ Test Discovery'}
                    </button>
                  </div>
                </div>

                {discoveryResult && (
                  <div style={{
                    marginBottom: '1rem',
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.8rem',
                    background: discoveryResult.status === 'ok' ? 'rgba(16, 185, 129, 0.1)' : 'var(--danger-bg)',
                    border: `1px solid ${discoveryResult.status === 'ok' ? 'var(--success)' : 'var(--danger-border)'}`,
                    color: discoveryResult.status === 'ok' ? '#6ee7b7' : '#fca5a5',
                  }}>
                    {discoveryResult.status === 'ok' ? (
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                          ✓ OIDC Discovery Succeeded ({discoveryResult.latency_ms}ms)
                        </div>
                        <div style={{ color: 'var(--text-muted)' }}>
                          Auth: <code>{discoveryResult.configuration?.authorization_endpoint}</code>
                        </div>
                        <div style={{ color: 'var(--text-muted)' }}>
                          Token: <code>{discoveryResult.configuration?.token_endpoint}</code>
                        </div>
                      </div>
                    ) : (
                      <div>⚠️ Discovery Error: {discoveryResult.message}</div>
                    )}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Client ID</label>
                    <input
                      type="text"
                      required
                      className="form-input"
                      placeholder="OAuth2 Client ID"
                      value={formClientId}
                      onChange={(e) => setFormClientId(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Client Secret (Optional)</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="••••••••••••••••"
                      value={formClientSecret}
                      onChange={(e) => setFormClientSecret(e.target.value)}
                    />
                  </div>
                </div>

                {/* Claim Mappings */}
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <label className="form-label" style={{ margin: 0 }}>Claim & Group Mappings</label>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={addClaimRow}>
                      + Add Mapping
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {formClaims.map((claim, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input
                          type="text"
                          className="form-input"
                          style={{ flex: 1, fontSize: '0.85rem' }}
                          placeholder="e.g. okta_group_admins"
                          value={claim.key}
                          onChange={(e) => {
                            const updated = [...formClaims];
                            updated[idx].key = e.target.value;
                            setFormClaims(updated);
                          }}
                        />
                        <span style={{ color: 'var(--text-muted)' }}>➔</span>
                        <select
                          className="form-input"
                          style={{ flex: 1, fontSize: '0.85rem' }}
                          value={claim.role}
                          onChange={(e) => {
                            const updated = [...formClaims];
                            updated[idx].role = e.target.value;
                            setFormClaims(updated);
                          }}
                        >
                          <option value="platform-admin">platform-admin</option>
                          <option value="tenant-admin">tenant-admin</option>
                          <option value="auditor">auditor</option>
                          <option value="agent-operator">agent-operator</option>
                          <option value="tool-consumer">tool-consumer</option>
                        </select>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => removeClaimRow(idx)}
                          style={{ color: 'var(--danger)' }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                  <input
                    type="checkbox"
                    id="active-toggle"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                  />
                  <label htmlFor="active-toggle" style={{ fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                    Enable this Identity Provider on Console Login screen
                  </label>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Provider Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SSOConfigView;
