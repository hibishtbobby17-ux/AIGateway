import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { MCPServer, MCPServerAuthConfig } from '../types';

export const MCPServersView: React.FC = () => {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [healthResults, setHealthResults] = useState<Record<string, any>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [namespacePrefix, setNamespacePrefix] = useState('');
  const [transportType, setTransportType] = useState<'SSE' | 'HTTP_POST' | 'STDIO'>('SSE');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [command, setCommand] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const [concurrencyLimit, setConcurrencyLimit] = useState(50);
  const [submitting, setSubmitting] = useState(false);

  // Authentication Form State
  const [authType, setAuthType] = useState<MCPServerAuthConfig['type']>('NONE');
  const [oauthTokenEndpoint, setOauthTokenEndpoint] = useState('');
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');
  const [oauthScopes, setOauthScopes] = useState('');
  const [oauthAudience, setOauthAudience] = useState('');
  const [staticBearerToken, setStaticBearerToken] = useState('');
  const [basicUsername, setBasicUsername] = useState('');
  const [basicPassword, setBasicPassword] = useState('');
  const [apiKeyHeader, setApiKeyHeader] = useState('X-API-Key');
  const [apiKeyVal, setApiKeyVal] = useState('');

  // OAuth Probe Test State
  const [testingOAuth, setTestingOAuth] = useState(false);
  const [oauthTestResult, setOauthTestResult] = useState<{
    status: string;
    token_sample?: string;
    expires_in?: number;
    latency_ms?: number;
    message?: string;
  } | null>(null);

  const loadServers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listMCPServers();
      setServers(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to list MCP servers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadServers();
  }, [api.getTenantId()]);

  // Accessibility: dismiss modal on Escape key press (WCAG 2.2 AA)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleTestOAuth = async () => {
    if (!oauthTokenEndpoint.trim() || !oauthClientId.trim() || !oauthClientSecret.trim()) {
      alert('Token Endpoint URL, Client ID, and Client Secret are required to test OAuth2.');
      return;
    }

    setTestingOAuth(true);
    setOauthTestResult(null);
    try {
      const res = await api.testMCPOAuth({
        token_endpoint: oauthTokenEndpoint.trim(),
        client_id: oauthClientId.trim(),
        client_secret: oauthClientSecret.trim(),
        scopes: oauthScopes.trim() || undefined,
        audience: oauthAudience.trim() || undefined,
      });
      setOauthTestResult(res);
    } catch (err: any) {
      setOauthTestResult({
        status: 'error',
        message: err.message || 'OAuth token request failed',
      });
    } finally {
      setTestingOAuth(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const authConfig: MCPServerAuthConfig = {
      type: authType,
    };

    if (authType === 'OAUTH2_CLIENT_CREDENTIALS') {
      authConfig.token_endpoint = oauthTokenEndpoint.trim();
      authConfig.client_id = oauthClientId.trim();
      authConfig.client_secret = oauthClientSecret.trim();
      authConfig.scopes = oauthScopes.trim() || undefined;
      authConfig.audience = oauthAudience.trim() || undefined;
    } else if (authType === 'STATIC_BEARER') {
      authConfig.static_token = staticBearerToken.trim();
    } else if (authType === 'BASIC') {
      authConfig.username = basicUsername.trim();
      authConfig.password = basicPassword.trim();
    } else if (authType === 'API_KEY') {
      authConfig.api_key_header = apiKeyHeader.trim();
      authConfig.api_key = apiKeyVal.trim();
    }

    try {
      await api.createMCPServer({
        name,
        namespace_prefix: namespacePrefix || name,
        transport_type: transportType,
        endpoint_url: endpointUrl || undefined,
        command: command || undefined,
        timeout_ms: timeoutMs,
        concurrency_limit: concurrencyLimit,
        auth_config: authConfig,
      });
      setIsModalOpen(false);

      // Reset form
      setName('');
      setNamespacePrefix('');
      setEndpointUrl('');
      setCommand('');
      setAuthType('NONE');
      setOauthTokenEndpoint('');
      setOauthClientId('');
      setOauthClientSecret('');
      setOauthScopes('');
      setOauthAudience('');
      setStaticBearerToken('');
      setBasicUsername('');
      setBasicPassword('');
      setApiKeyVal('');
      setOauthTestResult(null);

      await loadServers();
    } catch (err: any) {
      setError(err.message || 'Failed to register MCP server');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestHealth = async (id: string) => {
    setHealthResults((prev) => ({ ...prev, [id]: { checking: true } }));
    try {
      const res = await api.testMCPHealth(id);
      setHealthResults((prev) => ({ ...prev, [id]: res }));
      await loadServers();
    } catch (err: any) {
      setHealthResults((prev) => ({
        ...prev,
        [id]: { health: 'UNHEALTHY', message: err.message, latency_ms: 0 },
      }));
    }
  };

  const handleDelete = async (id: string, serverName: string) => {
    if (!window.confirm(`Are you sure you want to unregister MCP server "${serverName}"?`)) {
      return;
    }
    try {
      await api.deleteMCPServer(id);
      await loadServers();
    } catch (err: any) {
      setError(err.message || 'Failed to delete MCP server');
    }
  };

  const renderAuthBadge = (authCfg?: MCPServerAuthConfig) => {
    const type = authCfg?.type || 'NONE';
    switch (type) {
      case 'OAUTH2_CLIENT_CREDENTIALS':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            background: 'rgba(99, 102, 241, 0.15)',
            border: '1px solid rgba(99, 102, 241, 0.4)',
            color: '#818cf8',
            fontSize: '0.75rem',
            padding: '0.15rem 0.5rem',
            borderRadius: '4px',
            fontWeight: 600,
          }}>
            <span>⚡</span>
            <span>OAuth2 (M2M)</span>
          </span>
        );
      case 'STATIC_BEARER':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            background: 'rgba(6, 182, 212, 0.15)',
            border: '1px solid rgba(6, 182, 212, 0.4)',
            color: 'var(--cyan)',
            fontSize: '0.75rem',
            padding: '0.15rem 0.5rem',
            borderRadius: '4px',
            fontWeight: 600,
          }}>
            <span>🔒</span>
            <span>Bearer</span>
          </span>
        );
      case 'BASIC':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            background: 'rgba(234, 179, 8, 0.15)',
            border: '1px solid rgba(234, 179, 8, 0.4)',
            color: 'var(--warning)',
            fontSize: '0.75rem',
            padding: '0.15rem 0.5rem',
            borderRadius: '4px',
            fontWeight: 600,
          }}>
            <span>🔑</span>
            <span>Basic</span>
          </span>
        );
      case 'API_KEY':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            background: 'rgba(168, 85, 247, 0.15)',
            border: '1px solid rgba(168, 85, 247, 0.4)',
            color: '#c084fc',
            fontSize: '0.75rem',
            padding: '0.15rem 0.5rem',
            borderRadius: '4px',
            fontWeight: 600,
          }}>
            <span>🏷️</span>
            <span>API Key</span>
          </span>
        );
      default:
        return <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>None</span>;
    }
  };

  return (
    <div className="mcp-servers-view">
      <div className="filter-bar">
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700, margin: '0 0 0.25rem 0' }}>
            Upstream MCP Server Registry
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>
            Manage external Model Context Protocol tool servers with automated OAuth2 token lifecycle management.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
          + Register MCP Server
        </button>
      </div>

      {error && (
        <div style={{
          background: 'var(--danger-bg)',
          border: '1px solid var(--danger-border)',
          borderRadius: 'var(--radius-md)',
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          color: '#fca5a5',
          fontSize: '0.875rem',
        }}>
          ⚠️ {error}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ width: '24px', height: '24px', margin: '0 auto 0.5rem auto' }} />
            Loading upstream MCP servers...
          </div>
        ) : servers.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚡</div>
            <p style={{ fontWeight: 600 }}>No upstream MCP servers registered</p>
            <p style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Connect GitHub, Jira, Postgres, or custom OAuth2-protected Model Context Protocol servers.
            </p>
            <button className="btn btn-secondary btn-sm" onClick={() => setIsModalOpen(true)}>
              + Register First Server
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Server Name</th>
                  <th>Namespace</th>
                  <th>Transport</th>
                  <th>Endpoint / Command</th>
                  <th>Auth Mode</th>
                  <th>Status</th>
                  <th>Latency & Probes</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((s) => {
                  const probe = healthResults[s.id];

                  return (
                    <tr key={s.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</div>
                        <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          ID: {s.id.substring(0, 8)}...
                        </div>
                      </td>
                      <td>
                        <span className="code-pill">{s.namespace_prefix}::</span>
                      </td>
                      <td>
                        <span className="code-pill">{s.transport_type}</span>
                      </td>
                      <td style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.endpoint_url || s.command || '—'}
                      </td>
                      <td>
                        {renderAuthBadge(s.auth_config)}
                      </td>
                      <td>
                        <span className={`badge badge-${s.health_status.toLowerCase()}`}>
                          <span className="pulse-dot" /> {s.health_status}
                        </span>
                      </td>
                      <td>
                        {probe?.checking ? (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Probing...</span>
                        ) : probe ? (
                          <div style={{ fontSize: '0.8rem' }}>
                            <span style={{ color: probe.health === 'HEALTHY' ? 'var(--success)' : 'var(--danger)' }}>
                              {probe.health} ({probe.latency_ms?.toFixed(1)}ms)
                            </span>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{probe.message}</div>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Not tested yet</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleTestHealth(s.id)}
                            disabled={probe?.checking}
                          >
                            Probe Health
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDelete(s.id, s.name)}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Register Server Modal */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mcp-register-title"
            style={{ maxWidth: '640px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="mcp-register-title" className="modal-title" style={{ fontSize: '1.1rem', margin: 0 }}>
                Register Upstream MCP Server
              </h2>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-label="Close registration dialog"
                onClick={() => setIsModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Server Slug Name</label>
                    <input
                      type="text"
                      required
                      className="form-input"
                      placeholder="e.g. github-enterprise"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Namespace Prefix</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. github"
                      value={namespacePrefix}
                      onChange={(e) => setNamespacePrefix(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Transport Type</label>
                  <select
                    className="form-select"
                    value={transportType}
                    onChange={(e) => setTransportType(e.target.value as any)}
                  >
                    <option value="SSE">Server-Sent Events (SSE)</option>
                    <option value="HTTP_POST">Streamlined HTTP Post</option>
                    <option value="STDIO">Local STDIO Command</option>
                  </select>
                </div>

                {transportType !== 'STDIO' ? (
                  <div className="form-group">
                    <label className="form-label">Endpoint URL</label>
                    <input
                      type="url"
                      required
                      className="form-input"
                      placeholder="https://mcp.company.internal/sse"
                      value={endpointUrl}
                      onChange={(e) => setEndpointUrl(e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">Executable Command</label>
                    <input
                      type="text"
                      required
                      className="form-input"
                      placeholder="npx -y @modelcontextprotocol/server-postgres"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                    />
                  </div>
                )}

                {/* Authentication Configuration Section */}
                <div style={{
                  marginTop: '1.25rem',
                  padding: '1rem',
                  background: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '1.1rem' }}>🛡️</span>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                      Upstream Authentication & Authorization
                    </span>
                  </div>

                  <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label className="form-label">Authentication Method</label>
                    <select
                      className="form-select"
                      value={authType}
                      onChange={(e) => setAuthType(e.target.value as any)}
                    >
                      <option value="NONE">None (Public / Internal Network)</option>
                      <option value="OAUTH2_CLIENT_CREDENTIALS">OAuth 2.0 Client Credentials (Automated M2M)</option>
                      <option value="STATIC_BEARER">Static Bearer Token / PAT</option>
                      <option value="BASIC">HTTP Basic Authentication</option>
                      <option value="API_KEY">API Key Header</option>
                    </select>
                  </div>

                  {/* OAuth 2.0 Client Credentials Form */}
                  {authType === 'OAUTH2_CLIENT_CREDENTIALS' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div className="form-group">
                        <label className="form-label">Token Endpoint URL</label>
                        <input
                          type="url"
                          required
                          className="form-input"
                          placeholder="https://auth.company.com/oauth/v2/token"
                          value={oauthTokenEndpoint}
                          onChange={(e) => setOauthTokenEndpoint(e.target.value)}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <div className="form-group">
                          <label className="form-label">Client ID</label>
                          <input
                            type="text"
                            required
                            className="form-input"
                            placeholder="oauth2-client-id"
                            value={oauthClientId}
                            onChange={(e) => setOauthClientId(e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Client Secret</label>
                          <input
                            type="password"
                            required
                            className="form-input"
                            placeholder="••••••••••••••••"
                            value={oauthClientSecret}
                            onChange={(e) => setOauthClientSecret(e.target.value)}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <div className="form-group">
                          <label className="form-label">Scopes (Space-separated)</label>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="tools:read tools:execute"
                            value={oauthScopes}
                            onChange={(e) => setOauthScopes(e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Audience (Optional)</label>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="https://api.upstream.com"
                            value={oauthAudience}
                            onChange={(e) => setOauthAudience(e.target.value)}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={handleTestOAuth}
                          disabled={testingOAuth}
                        >
                          {testingOAuth ? 'Testing Token...' : '⚡ Test OAuth Token'}
                        </button>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Automated background renewal & in-memory caching
                        </span>
                      </div>

                      {oauthTestResult && (
                        <div style={{
                          marginTop: '0.5rem',
                          padding: '0.65rem 0.75rem',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.8rem',
                          background: oauthTestResult.status === 'ok' ? 'rgba(16, 185, 129, 0.15)' : 'var(--danger-bg)',
                          border: `1px solid ${oauthTestResult.status === 'ok' ? 'var(--success)' : 'var(--danger-border)'}`,
                          color: oauthTestResult.status === 'ok' ? '#6ee7b7' : '#fca5a5',
                        }}>
                          {oauthTestResult.status === 'ok' ? (
                            <div>
                              <div style={{ fontWeight: 600 }}>✓ Token Exchange Succeeded ({oauthTestResult.latency_ms}ms)</div>
                              <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                                Token sample: <code>{oauthTestResult.token_sample}</code> (expires in {oauthTestResult.expires_in}s)
                              </div>
                            </div>
                          ) : (
                            <div>⚠️ Token Request Error: {oauthTestResult.message}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Static Bearer Token Form */}
                  {authType === 'STATIC_BEARER' && (
                    <div className="form-group">
                      <label className="form-label">Bearer Token / PAT</label>
                      <input
                        type="password"
                        required
                        className="form-input"
                        placeholder="ghp_1234567890abcdef..."
                        value={staticBearerToken}
                        onChange={(e) => setStaticBearerToken(e.target.value)}
                      />
                    </div>
                  )}

                  {/* HTTP Basic Form */}
                  {authType === 'BASIC' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div className="form-group">
                        <label className="form-label">Username</label>
                        <input
                          type="text"
                          required
                          className="form-input"
                          placeholder="mcp-service-user"
                          value={basicUsername}
                          onChange={(e) => setBasicUsername(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Password</label>
                        <input
                          type="password"
                          required
                          className="form-input"
                          placeholder="••••••••••••"
                          value={basicPassword}
                          onChange={(e) => setBasicPassword(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {/* API Key Form */}
                  {authType === 'API_KEY' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div className="form-group">
                        <label className="form-label">Header Name</label>
                        <input
                          type="text"
                          required
                          className="form-input"
                          placeholder="X-API-Key"
                          value={apiKeyHeader}
                          onChange={(e) => setApiKeyHeader(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">API Key Secret</label>
                        <input
                          type="password"
                          required
                          className="form-input"
                          placeholder="key_live_987654..."
                          value={apiKeyVal}
                          onChange={(e) => setApiKeyVal(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Timeout (ms)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={timeoutMs}
                      onChange={(e) => setTimeoutMs(Number(e.target.value))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Concurrency Bulkhead</label>
                    <input
                      type="number"
                      className="form-input"
                      value={concurrencyLimit}
                      onChange={(e) => setConcurrencyLimit(Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting} aria-busy={submitting}>
                  {submitting ? 'Registering...' : 'Register Server'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MCPServersView;
