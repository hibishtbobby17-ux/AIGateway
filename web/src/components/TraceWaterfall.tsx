import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { TraceSummary, TraceDetail, Span } from '../types';

interface Props {
  initialTraceId?: string | null;
  onViewLogs?: (traceId: string) => void;
}

export const TraceWaterfall: React.FC<Props> = ({ initialTraceId, onViewLogs }) => {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(initialTraceId || null);
  const [traceDetail, setTraceDetail] = useState<TraceDetail | null>(null);
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);

  const [filterTraceId, setFilterTraceId] = useState('');
  const [filterName, setFilterName] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTraces = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listTraces({
        trace_id: filterTraceId || undefined,
        name: filterName || undefined,
        status_code: filterStatus || undefined,
      });
      setTraces(data || []);
      if (!selectedTraceId && data && data.length > 0) {
        setSelectedTraceId(data[0].trace_id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to search traces');
    } finally {
      setLoading(false);
    }
  };

  const loadTraceDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const detail = await api.getTrace(id);
      setTraceDetail(detail);
      if (detail?.spans && detail.spans.length > 0) {
        setSelectedSpan(detail.spans[0]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch trace spans');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    loadTraces();
  }, [filterStatus, api.getTenantId()]);

  useEffect(() => {
    if (initialTraceId) {
      setSelectedTraceId(initialTraceId);
      loadTraceDetail(initialTraceId);
    }
  }, [initialTraceId]);

  useEffect(() => {
    if (selectedTraceId) {
      loadTraceDetail(selectedTraceId);
    }
  }, [selectedTraceId]);

  // Compute hierarchy and relative Gantt offsets
  let minStart = 0;
  let maxEnd = 0;
  let totalDurationMs = 1;

  if (traceDetail?.spans && traceDetail.spans.length > 0) {
    minStart = new Date(traceDetail.spans[0].start_time).getTime();
    maxEnd = new Date(traceDetail.spans[0].end_time).getTime();

    traceDetail.spans.forEach((s) => {
      const st = new Date(s.start_time).getTime();
      const et = new Date(s.end_time).getTime();
      if (st < minStart) minStart = st;
      if (et > maxEnd) maxEnd = et;
    });

    totalDurationMs = Math.max(1, maxEnd - minStart);
  }

  return (
    <div className="traces-view">
      {/* Search & Filter Bar */}
      <div className="filter-bar glass-panel" style={{ padding: '1rem 1.5rem' }}>
        <div className="filter-inputs">
          <input
            type="text"
            className="form-input"
            style={{ width: '220px' }}
            placeholder="Search by Trace ID..."
            value={filterTraceId}
            onChange={(e) => setFilterTraceId(e.target.value)}
          />
          <input
            type="text"
            className="form-input"
            style={{ width: '180px' }}
            placeholder="Filter by span name..."
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
          />
          <select
            className="form-select"
            style={{ width: '130px' }}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="OK">OK</option>
            <option value="ERROR">ERROR</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={loadTraces}>
            Filter Traces
          </button>
        </div>
      </div>

      {error && <div className="alert-banner alert-error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
        {/* Left: Traces Search List */}
        <div className="glass-panel" style={{ maxHeight: '720px', overflowY: 'auto' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', fontWeight: 600 }}>
            Recent Traces ({traces.length})
          </div>

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading traces...
            </div>
          ) : traces.length === 0 ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              No traces found matching criteria.
            </div>
          ) : (
            <div>
              {traces.map((t) => {
                const isSelected = selectedTraceId === t.trace_id;
                const isErr = t.status_code === 'ERROR';

                return (
                  <div
                    key={t.trace_id}
                    onClick={() => setSelectedTraceId(t.trace_id)}
                    style={{
                      padding: '0.85rem 1.25rem',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                      borderLeft: isSelected ? '3px solid var(--primary)' : '3px solid transparent',
                      transition: 'all var(--transition-fast)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem', color: isErr ? 'var(--danger)' : 'var(--text-primary)' }}>
                        {t.root_span_name}
                      </span>
                      <span className={`badge badge-${isErr ? 'unhealthy' : 'healthy'}`}>
                        {t.status_code}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      <span className="mono">{t.trace_id.substring(0, 16)}...</span>
                      <span>{t.duration_ms.toFixed(1)} ms ({t.span_count} spans)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Detailed Trace Waterfall & Timeline */}
        <div className="glass-panel" style={{ padding: '1.5rem', maxHeight: '720px', overflowY: 'auto' }}>
          {detailLoading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading waterfall timeline...
            </div>
          ) : !traceDetail || traceDetail.spans.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-title">Select a Trace</div>
              <div className="empty-state-desc">Select any trace from the left panel to inspect its waterfall Gantt chart and span hierarchy.</div>
            </div>
          ) : (
            <div>
              {/* Waterfall Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Selected Trace</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--cyan)' }}>
                    {traceDetail.trace_id}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => onViewLogs && onViewLogs(traceDetail.trace_id)}
                  >
                    📜 View Correlated Logs
                  </button>
                </div>
              </div>

              {/* Gantt Timeline Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 80px', gap: '1rem', padding: '0.4rem 1rem', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-subtle)', marginBottom: '0.5rem' }}>
                <div>Span Name / Kind</div>
                <div>Timeline (0 - {totalDurationMs} ms)</div>
                <div style={{ textAlign: 'right' }}>Duration</div>
              </div>

              {/* Waterfall Spans */}
              <div className="waterfall-container">
                {traceDetail.spans.map((span) => {
                  const sTime = new Date(span.start_time).getTime();
                  const offsetMs = Math.max(0, sTime - minStart);
                  const leftPercent = Math.min(100, Math.max(0, (offsetMs / totalDurationMs) * 100));
                  const widthPercent = Math.min(100 - leftPercent, Math.max(1.5, (span.duration_ms / totalDurationMs) * 100));
                  const isErr = span.status_code === 'ERROR';
                  const isSelected = selectedSpan?.span_id === span.span_id;
                  const indent = span.parent_span_id ? '1.5rem' : '0rem';

                  return (
                    <div
                      key={span.span_id}
                      className="waterfall-row"
                      style={{
                        borderColor: isSelected ? 'var(--primary)' : 'transparent',
                        background: isSelected ? 'rgba(99, 102, 241, 0.1)' : undefined,
                      }}
                      onClick={() => setSelectedSpan(span)}
                    >
                      {/* Span Name with Indent */}
                      <div style={{ paddingLeft: indent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.85rem', color: isErr ? 'var(--danger)' : 'var(--text-primary)' }}>
                          {span.name}
                        </span>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {span.kind} • <span className="mono">{span.span_id.substring(0, 8)}</span>
                        </div>
                      </div>

                      {/* Gantt Bar */}
                      <div className="waterfall-bar-track">
                        <div
                          className={`waterfall-bar-fill ${isErr ? 'error' : ''}`}
                          style={{
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                          }}
                        />
                      </div>

                      {/* Duration */}
                      <div style={{ textAlign: 'right', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                        {span.duration_ms.toFixed(1)}ms
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Selected Span Attribute Inspector */}
              {selectedSpan && (
                <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: 'rgba(0,0,0,0.25)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                      Span Attributes: <span className="code-pill">{selectedSpan.name}</span>
                    </div>
                    <span className={`badge badge-${selectedSpan.status_code === 'ERROR' ? 'unhealthy' : 'healthy'}`}>
                      {selectedSpan.status_code}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem', fontSize: '0.8rem' }}>
                    <div><span style={{ color: 'var(--text-muted)' }}>Span ID:</span> <span className="mono">{selectedSpan.span_id}</span></div>
                    <div><span style={{ color: 'var(--text-muted)' }}>Parent Span ID:</span> <span className="mono">{selectedSpan.parent_span_id || 'root'}</span></div>
                    <div><span style={{ color: 'var(--text-muted)' }}>Duration:</span> {selectedSpan.duration_ms.toFixed(2)} ms</div>
                    <div><span style={{ color: 'var(--text-muted)' }}>Started:</span> {new Date(selectedSpan.start_time).toLocaleTimeString()}</div>
                  </div>

                  {selectedSpan.attributes && Object.keys(selectedSpan.attributes).length > 0 && (
                    <pre style={{ background: 'rgba(0,0,0,0.4)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', overflowX: 'auto' }}>
                      {JSON.stringify(selectedSpan.attributes, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
