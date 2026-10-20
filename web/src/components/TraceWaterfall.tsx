import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { TraceSummary, TraceDetail, Span } from '../types';

interface Props {
  initialTraceId?: string | null;
  onViewLogs?: (traceId: string) => void;
}

export const TraceWaterfall: React.FC<Props> = ({ initialTraceId, onViewLogs }) => {
  const [viewMode, setViewMode] = useState<'waterfall' | 'jaeger'>('waterfall');
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

  // Jaeger Embedded View State
  const [jaegerUrl, setJaegerUrl] = useState<string>('http://localhost:16686/search?service=ai-gateway');
  const [urlInput, setUrlInput] = useState<string>('http://localhost:16686/search?service=ai-gateway');
  const [iframeKey, setIframeKey] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

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

  const handleOpenInJaeger = (traceId?: string) => {
    const target = traceId
      ? `http://localhost:16686/trace/${traceId}`
      : 'http://localhost:16686/search?service=ai-gateway';
    setJaegerUrl(target);
    setUrlInput(target);
    setIframeKey((prev) => prev + 1);
    setViewMode('jaeger');
  };

  const handleNavigateJaeger = (url: string) => {
    setJaegerUrl(url);
    setUrlInput(url);
    setIframeKey((prev) => prev + 1);
  };

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
      {/* Top Header & View Mode Switcher */}
      <div className="filter-bar glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ display: 'flex', background: 'rgba(15, 23, 42, 0.7)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <button
              className={`btn btn-sm ${viewMode === 'waterfall' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('waterfall')}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '6px' }}
            >
              <span>📊</span>
              <span>Native Waterfall</span>
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'jaeger' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleOpenInJaeger(selectedTraceId || undefined)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '6px' }}
            >
              <span>🌐</span>
              <span>Embedded Jaeger UI</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
            <span>Jaeger UI: <a href="http://localhost:16686" target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>:16686</a></span>
          </div>
        </div>

        {viewMode === 'waterfall' ? (
          <div className="filter-inputs" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="text"
              className="form-input"
              style={{ width: '200px' }}
              placeholder="Search by Trace ID..."
              value={filterTraceId}
              onChange={(e) => setFilterTraceId(e.target.value)}
            />
            <input
              type="text"
              className="form-input"
              style={{ width: '160px' }}
              placeholder="Filter by span name..."
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
            />
            <select
              className="form-select"
              style={{ width: '120px' }}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="OK">OK</option>
              <option value="ERROR">ERROR</option>
            </select>
            <button className="btn btn-primary btn-sm" onClick={loadTraces}>
              Filter
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleNavigateJaeger('http://localhost:16686/search?service=ai-gateway')}
            >
              🔍 Gateway Traces
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleNavigateJaeger('http://localhost:16686/dependencies')}
            >
              🕸️ Dependencies
            </button>
            {selectedTraceId && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleNavigateJaeger(`http://localhost:16686/trace/${selectedTraceId}`)}
              >
                ⚡ Trace {selectedTraceId.substring(0, 8)}...
              </button>
            )}
            <a
              href={jaegerUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
              title="Open current view in new browser tab"
              style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <span>↗</span>
              <span>Pop Out</span>
            </a>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIframeKey((prev) => prev + 1)}
              title="Reload Jaeger Frame"
            >
              ↻
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert-banner alert-error" style={{ marginTop: '1rem' }}>{error}</div>}

      {/* VIEW MODE: EMBEDDED JAEGER LIVE UI */}
      {viewMode === 'jaeger' ? (
        <div
          className="glass-panel"
          style={{
            marginTop: '1.25rem',
            padding: '1rem',
            position: isFullscreen ? 'fixed' : 'relative',
            top: isFullscreen ? 0 : undefined,
            left: isFullscreen ? 0 : undefined,
            width: isFullscreen ? '100vw' : '100%',
            height: isFullscreen ? '100vh' : 'calc(100vh - 210px)',
            minHeight: '680px',
            zIndex: isFullscreen ? 99999 : 1,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Top Address & Actions Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Target:</span>
              <input
                type="text"
                className="form-input"
                style={{ flex: 1, padding: '0.35rem 0.75rem', fontSize: '0.825rem', fontFamily: 'var(--font-mono)' }}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setJaegerUrl(urlInput);
                    setIframeKey((prev) => prev + 1);
                  }
                }}
              />
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setJaegerUrl(urlInput);
                  setIframeKey((prev) => prev + 1);
                }}
              >
                Go
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setIsFullscreen(!isFullscreen)}
                title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? '🗗 Exit Fullscreen' : '⛶ Fullscreen'}
              </button>
            </div>
          </div>

          {/* Embedded Jaeger Frame */}
          <iframe
            key={iframeKey}
            src={jaegerUrl}
            title="Jaeger Distributed Tracing Console"
            style={{
              width: '100%',
              flex: 1,
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              background: '#0e1422',
            }}
          />
        </div>
      ) : (
        /* VIEW MODE: NATIVE WATERFALL & SPANS */
        <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: '1.5rem', marginTop: '1.25rem' }}>
          {/* Left: Traces Search List */}
          <div className="glass-panel" style={{ maxHeight: '720px', overflowY: 'auto' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Recent Traces ({traces.length})</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ClickHouse OLAP</span>
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenInJaeger(t.trace_id);
                            }}
                            title="Inspect in live Jaeger UI"
                          >
                            🌐 Jaeger
                          </button>
                          <span className={`badge badge-${isErr ? 'unhealthy' : 'healthy'}`}>
                            {t.status_code}
                          </span>
                        </div>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Selected Trace</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--cyan)' }}>
                      {traceDetail.trace_id}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleOpenInJaeger(traceDetail.trace_id)}
                      title="Inspect this trace in embedded Jaeger UI"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <span>🌐</span>
                      <span>Open in Jaeger</span>
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => onViewLogs && onViewLogs(traceDetail.trace_id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <span>📜</span>
                      <span>Correlated Logs</span>
                    </button>
                  </div>
                </div>

                {/* Gantt Timeline Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 80px', gap: '1rem', padding: '0.4rem 1rem', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-subtle)', marginBottom: '0.5rem' }}>
                  <span>Span Name &amp; Hierarchy</span>
                  <span>Timeline Gantt (Relative: {totalDurationMs.toFixed(1)}ms)</span>
                  <span style={{ textAlign: 'right' }}>Duration</span>
                </div>

                {/* Spans List & Gantt Bars */}
                <div className="waterfall-container">
                  {traceDetail.spans.map((span) => {
                    const isSelected = selectedSpan?.span_id === span.span_id;
                    const isErr = span.status_code === 'ERROR';

                    const start = new Date(span.start_time).getTime();
                    const end = new Date(span.end_time).getTime();

                    const leftPercent = Math.max(0, Math.min(100, ((start - minStart) / totalDurationMs) * 100));
                    const widthPercent = Math.max(0.5, Math.min(100 - leftPercent, (span.duration_ms / totalDurationMs) * 100));

                    const depth = span.parent_span_id ? 1 : 0;
                    const indent = `${depth * 1.5}rem`;

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
      )}
    </div>
  );
};

export default TraceWaterfall;
