import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { LogRecord } from '../types';

interface Props {
  initialTraceId?: string | null;
  onSelectTrace?: (traceId: string) => void;
}

export const LogSearch: React.FC<Props> = ({ initialTraceId, onSelectTrace }) => {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [traceIdFilter, setTraceIdFilter] = useState<string>(initialTraceId || '');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [queryFilter, setQueryFilter] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listLogs({
        trace_id: traceIdFilter || undefined,
        severity: severityFilter || undefined,
        query: queryFilter || undefined,
      });
      setLogs(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to search logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialTraceId) {
      setTraceIdFilter(initialTraceId);
    }
  }, [initialTraceId]);

  useEffect(() => {
    loadLogs();
  }, [severityFilter, api.getTenantId()]);

  return (
    <div className="logs-view">
      {/* Search & Filter Bar */}
      <div className="filter-bar glass-panel" style={{ padding: '1rem 1.5rem' }}>
        <div className="filter-inputs">
          <input
            type="text"
            className="form-input"
            style={{ width: '260px' }}
            placeholder="Search message text..."
            value={queryFilter}
            onChange={(e) => setQueryFilter(e.target.value)}
          />
          <input
            type="text"
            className="form-input"
            style={{ width: '220px' }}
            placeholder="Filter by Trace ID..."
            value={traceIdFilter}
            onChange={(e) => setTraceIdFilter(e.target.value)}
          />
          <select
            className="form-select"
            style={{ width: '140px' }}
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
          >
            <option value="">All Severities</option>
            <option value="DEBUG">DEBUG</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
            <option value="FATAL">FATAL</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={loadLogs}>
            Search Logs
          </button>
          {traceIdFilter && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setTraceIdFilter('');
                setTimeout(loadLogs, 0);
              }}
            >
              Clear Trace Filter
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert-banner alert-error" style={{ marginTop: '1rem' }}>{error}</div>}

      {/* Structured Logs Table */}
      <div className="glass-panel" style={{ marginTop: '1.5rem' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>Correlated Structured Logs ({logs.length})</span>
          {traceIdFilter && (
            <span style={{ fontSize: '0.8rem', color: 'var(--cyan)' }}>
              Filtered to Trace: <span className="mono">{traceIdFilter}</span>
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Searching telemetry logs...
          </div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📜</div>
            <div className="empty-state-title">No Matching Log Records</div>
            <div className="empty-state-desc">No logs matched your current filters. Adjust your search criteria or time window.</div>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '180px' }}>Timestamp</th>
                  <th style={{ width: '90px' }}>Severity</th>
                  <th>Message</th>
                  <th style={{ width: '180px' }}>Correlated Trace</th>
                  <th style={{ width: '70px', textAlign: 'right' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const isError = log.severity === 'ERROR' || log.severity === 'FATAL';
                  const isWarn = log.severity === 'WARN';

                  return (
                    <React.Fragment key={log.id}>
                      <tr>
                        <td className="mono" style={{ fontSize: '0.8rem' }}>
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td>
                          <span
                            className={`badge badge-${isError ? 'unhealthy' : isWarn ? 'degraded' : 'healthy'}`}
                            style={{ fontSize: '0.7rem' }}
                          >
                            {log.severity}
                          </span>
                        </td>
                        <td style={{ color: isError ? '#fca5a5' : 'var(--text-primary)', wordBreak: 'break-word' }}>
                          {log.message}
                        </td>
                        <td>
                          {log.trace_id ? (
                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                              onClick={() => onSelectTrace && onSelectTrace(log.trace_id!)}
                            >
                              🔍 {log.trace_id.substring(0, 10)}...
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                            onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                          >
                            {isExpanded ? '▲' : '▼'}
                          </button>
                        </td>
                      </tr>

                      {/* Expandable Attributes Drawer */}
                      {isExpanded && (
                        <tr style={{ background: 'rgba(0,0,0,0.35)' }}>
                          <td colSpan={5} style={{ padding: '1rem 1.5rem' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                              Log Record Attributes & Trace Context
                            </div>
                            <pre
                              style={{
                                background: 'rgba(0,0,0,0.5)',
                                padding: '0.75rem',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: '0.75rem',
                                fontFamily: 'var(--font-mono)',
                                overflowX: 'auto',
                              }}
                            >
                              {JSON.stringify(
                                {
                                  id: log.id,
                                  tenant_id: log.tenant_id,
                                  trace_id: log.trace_id,
                                  span_id: log.span_id,
                                  severity: log.severity,
                                  attributes: log.attributes,
                                },
                                null,
                                2
                              )}
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
