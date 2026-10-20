import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { AuditEvent } from '../types';

export const AuditView: React.FC = () => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadAudit = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAudit({
        action: actionFilter || undefined,
        outcome: outcomeFilter || undefined,
      });
      setEvents(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load audit events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAudit();
  }, [actionFilter, outcomeFilter, api.getTenantId()]);

  return (
    <div className="audit-view">
      <div className="filter-bar">
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700 }}>
            Security & Administrative Audit Trail
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Immutable chronological record of policy modifications, server registrations, and security-relevant events.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <select
            className="form-select"
            style={{ width: 'auto' }}
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
          >
            <option value="">All Outcomes</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="FAILURE">FAILURE</option>
            <option value="DENIED">DENIED</option>
          </select>
          <button className="btn btn-secondary btn-sm" onClick={loadAudit}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="alert-banner alert-error" style={{ marginTop: '1rem' }}>{error}</div>}

      <div className="glass-panel" style={{ marginTop: '1.5rem' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', fontWeight: 600 }}>
          Recorded Audit Events ({events.length})
        </div>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading audit events...</div>
        ) : events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🔒</div>
            <div className="empty-state-title">No Audit Events Logged</div>
            <div className="empty-state-desc">Administrative changes and policy events will be automatically audited here.</div>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor ID</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Outcome</th>
                  <th>Client IP</th>
                  <th style={{ textAlign: 'right' }}>Payload</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => {
                  const isSuccess = ev.outcome === 'SUCCESS';
                  const isExpanded = expandedId === ev.id;

                  return (
                    <React.Fragment key={ev.id}>
                      <tr>
                        <td className="mono" style={{ fontSize: '0.8rem' }}>
                          {new Date(ev.timestamp).toLocaleString()}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{ev.actor_id}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{ev.actor_type}</div>
                        </td>
                        <td>
                          <span className="code-pill">{ev.action}</span>
                        </td>
                        <td className="mono" style={{ fontSize: '0.8rem' }}>
                          {ev.resource_id ? `${ev.resource_id.substring(0, 12)}...` : '—'}
                        </td>
                        <td>
                          <span className={`badge badge-${isSuccess ? 'healthy' : 'unhealthy'}`}>
                            {ev.outcome}
                          </span>
                        </td>
                        <td className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {ev.client_ip || '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                              onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                            >
                              {isExpanded ? '▲' : '▼'}
                            </button>
                          )}
                        </td>
                      </tr>

                      {isExpanded && ev.metadata && (
                        <tr style={{ background: 'rgba(0,0,0,0.35)' }}>
                          <td colSpan={7} style={{ padding: '1rem 1.5rem' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                              Audit Event Metadata
                            </div>
                            <pre style={{ background: 'rgba(0,0,0,0.5)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                              {JSON.stringify(ev.metadata, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
