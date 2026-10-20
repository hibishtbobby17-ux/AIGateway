import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { MCPServer } from '../types';

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createMCPServer({
        name,
        namespace_prefix: namespacePrefix || name,
        transport_type: transportType,
        endpoint_url: endpointUrl || undefined,
        command: command || undefined,
        timeout_ms: timeoutMs,
        concurrency_limit: concurrencyLimit,
      });
      setIsModalOpen(false);
      // Reset form
      setName('');
      setNamespacePrefix('');
      setEndpointUrl('');
      setCommand('');
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

  return (
    <div className="mcp-servers-view">
      <div className="filter-bar">
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700 }}>
            Upstream MCP Server Registry
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Register, aggregate, and inspect tools from distributed Model Context Protocol servers.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={loadServers}>
            Refresh
          </button>
          <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
            + Register MCP Server
          </button>
        </div>
      </div>

      {error && <div className="alert-banner alert-error" style={{ marginTop: '1rem' }}>{error}</div>}

      <div className="glass-panel" style={{ marginTop: '1.5rem' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading registered MCP servers...
          </div>
        ) : servers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">⚡</div>
            <div className="empty-state-title">No MCP Servers Configured</div>
            <div className="empty-state-desc">
              Connect external MCP tool providers (GitHub, PostgreSQL, Slack, Brave Search) behind the unified gateway endpoint.
            </div>
            <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
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
                      <td style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.endpoint_url || s.command || '—'}
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

      {/* Registration Modal */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Register Upstream MCP Server</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setIsModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Server Name (Slug)</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="e.g. github, postgres, brave-search"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Namespace Prefix</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. github (defaults to server name)"
                    value={namespacePrefix}
                    onChange={(e) => setNamespacePrefix(e.target.value)}
                  />
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
                      placeholder="http://localhost:8081/sse"
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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
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
                <button type="submit" className="btn btn-primary" disabled={submitting}>
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
