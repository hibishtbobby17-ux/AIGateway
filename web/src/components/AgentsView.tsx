import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Agent } from '../types';

export const AgentsView: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [healthResults, setHealthResults] = useState<Record<string, any>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [inspectCard, setInspectCard] = useState<any | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [description, setDescription] = useState('');
  const [capabilities, setCapabilities] = useState('planning, code-generation, analysis');
  const [submitting, setSubmitting] = useState(false);

  const loadAgents = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listAgents();
      setAgents(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to list agents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgents();
  }, [api.getTenantId()]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const caps = capabilities
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);

      await api.createAgent({
        name,
        endpoint_url: endpointUrl,
        agent_card: {
          name,
          description,
          version: '1.0.0',
          protocol_version: 'a2a/v1',
          capabilities: caps.length > 0 ? caps : ['general'],
        },
      });
      setIsModalOpen(false);
      setName('');
      setEndpointUrl('');
      setDescription('');
      await loadAgents();
    } catch (err: any) {
      setError(err.message || 'Failed to register agent');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestHealth = async (id: string) => {
    setHealthResults((prev) => ({ ...prev, [id]: { checking: true } }));
    try {
      const res = await api.testAgentHealth(id);
      setHealthResults((prev) => ({ ...prev, [id]: res }));
      await loadAgents();
    } catch (err: any) {
      setHealthResults((prev) => ({
        ...prev,
        [id]: { health: 'UNHEALTHY', message: err.message, latency_ms: 0 },
      }));
    }
  };

  const handleDelete = async (id: string, agentName: string) => {
    if (!window.confirm(`Are you sure you want to delete autonomous agent "${agentName}"?`)) {
      return;
    }
    try {
      await api.deleteAgent(id);
      await loadAgents();
    } catch (err: any) {
      setError(err.message || 'Failed to delete agent');
    }
  };

  return (
    <div className="agents-view">
      <div className="filter-bar">
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700 }}>
            Autonomous A2A Agent Registry
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Discover, route tasks, and stream lifecycle state across autonomous agents using the A2A protocol.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={loadAgents}>
            Refresh
          </button>
          <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
            + Register Agent
          </button>
        </div>
      </div>

      {error && <div className="alert-banner alert-error" style={{ marginTop: '1rem' }}>{error}</div>}

      <div className="glass-panel" style={{ marginTop: '1.5rem' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading registered agents...
          </div>
        ) : agents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🤖</div>
            <div className="empty-state-title">No Agents Configured</div>
            <div className="empty-state-desc">
              Register autonomous agents that expose Agent Cards and handle asynchronous tasks with live SSE event streaming.
            </div>
            <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
              + Register First Agent
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agent Name</th>
                  <th>Capabilities</th>
                  <th>Endpoint URL</th>
                  <th>Status</th>
                  <th>Connection Check</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const probe = healthResults[a.id];

                  return (
                    <tr key={a.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {a.agent_card?.description || 'Autonomous worker agent'}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', maxWidth: '240px' }}>
                          {a.agent_card?.capabilities?.map((cap) => (
                            <span key={cap} className="code-pill" style={{ fontSize: '0.7rem' }}>
                              {cap}
                            </span>
                          )) || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </div>
                      </td>
                      <td className="mono" style={{ fontSize: '0.8rem', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.endpoint_url}
                      </td>
                      <td>
                        <span className={`badge badge-${a.health_status.toLowerCase()}`}>
                          <span className="pulse-dot" /> {a.health_status}
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
                            onClick={() => handleTestHealth(a.id)}
                            disabled={probe?.checking}
                          >
                            Probe
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setInspectCard(a.agent_card)}
                          >
                            Card
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDelete(a.id, a.name)}
                          >
                            Delete
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
              <div className="modal-title">Register Autonomous Agent</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setIsModalOpen(false)}>✕</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Agent Name</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="e.g. research-agent, coding-agent"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Endpoint URL</label>
                  <input
                    type="url"
                    required
                    className="form-input"
                    placeholder="http://localhost:8082"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Agent Card Description</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Performs multi-step analysis and autonomous execution"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Capabilities (comma separated)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="planning, analysis, code-review"
                    value={capabilities}
                    onChange={(e) => setCapabilities(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Registering...' : 'Register Agent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inspect Card Modal */}
      {inspectCard && (
        <div className="modal-backdrop" onClick={() => setInspectCard(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Agent Card Specification (ADR-0003)</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setInspectCard(null)}>✕</button>
            </div>
            <div className="modal-body">
              <pre style={{ background: 'rgba(0,0,0,0.5)', padding: '1rem', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', overflowX: 'auto' }}>
                {JSON.stringify(inspectCard, null, 2)}
              </pre>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setInspectCard(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
