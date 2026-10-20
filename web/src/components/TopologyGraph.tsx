import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { ConfiguredTopology, ObservedTopology, TopologyNode, TopologyEdge } from '../types';

interface Props {
  onSelectTrace?: (traceId: string) => void;
  onNavigateTab?: (tab: string) => void;
}

export const TopologyGraph: React.FC<Props> = ({ onSelectTrace, onNavigateTab }) => {
  const [viewMode, setViewMode] = useState<'configured' | 'observed'>('configured');
  const [duration, setDuration] = useState<string>('1h');
  const [configuredData, setConfiguredData] = useState<ConfiguredTopology | null>(null);
  const [observedData, setObservedData] = useState<ObservedTopology | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<TopologyEdge | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (viewMode === 'configured') {
        const data = await api.getConfiguredTopology();
        setConfiguredData(data);
      } else {
        const data = await api.getObservedTopology(duration);
        setObservedData(data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load topology');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [viewMode, duration, api.getTenantId()]);

  const nodes = viewMode === 'configured' ? configuredData?.nodes || [] : observedData?.nodes || [];
  const edges = viewMode === 'configured' ? configuredData?.edges || [] : observedData?.edges || [];

  // Compute Layout Coordinates for Visual Nodes
  const gatewayNode = nodes.find((n) => n.id === 'gateway') || {
    id: 'gateway',
    label: 'AI Gateway',
    type: 'gateway',
    status: 'HEALTHY',
    call_count: 0,
    error_count: 0,
    avg_latency_ms: 0,
  };

  const clientNodes = nodes.filter((n) => n.type === 'client');
  const mcpNodes = nodes.filter((n) => n.type === 'mcp_server');
  const agentNodes = nodes.filter((n) => n.type === 'agent');
  const otherNodes = nodes.filter(
    (n) => n.type !== 'gateway' && n.type !== 'client' && n.type !== 'mcp_server' && n.type !== 'agent'
  );

  const nodePositions: Record<string, { x: number; y: number }> = {};
  nodePositions['gateway'] = { x: 480, y: 280 };

  // Distribute Clients along the top
  clientNodes.forEach((node, i) => {
    const total = clientNodes.length;
    const x = 480 - ((total - 1) * 160) / 2 + i * 160;
    nodePositions[node.id] = { x, y: 70 };
  });

  // Distribute MCP Servers on the left
  mcpNodes.forEach((node, i) => {
    const total = mcpNodes.length;
    const y = 280 - ((total - 1) * 90) / 2 + i * 90;
    nodePositions[node.id] = { x: 140, y };
  });

  // Distribute Agents on the right
  agentNodes.forEach((node, i) => {
    const total = agentNodes.length;
    const y = 280 - ((total - 1) * 90) / 2 + i * 90;
    nodePositions[node.id] = { x: 820, y };
  });

  // Distribute Other Services along the bottom
  otherNodes.forEach((node, i) => {
    const total = otherNodes.length;
    const x = 480 - ((total - 1) * 160) / 2 + i * 160;
    nodePositions[node.id] = { x, y: 490 };
  });

  return (
    <div className="topology-view">
      {/* View Switcher & Duration Filter Bar */}
      <div className="filter-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            className={`btn ${viewMode === 'configured' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setViewMode('configured');
              setSelectedNode(null);
              setSelectedEdge(null);
            }}
          >
            Configured Topology
          </button>
          <button
            className={`btn ${viewMode === 'observed' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setViewMode('observed');
              setSelectedNode(null);
              setSelectedEdge(null);
            }}
          >
            Observed Interactions (Telemetry)
          </button>
        </div>

        {viewMode === 'observed' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Time Window:</span>
            <select
              className="form-select"
              style={{ width: 'auto', padding: '0.4rem 0.8rem' }}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            >
              <option value="15m">Last 15 minutes</option>
              <option value="1h">Last 1 hour</option>
              <option value="6h">Last 6 hours</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
            </select>
          </div>
        )}

        <button className="btn btn-secondary btn-sm" onClick={loadData}>
          Refresh Graph
        </button>
      </div>

      {/* Info Callout */}
      <div
        style={{
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          padding: '0.75rem 1.25rem',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.25rem',
          fontSize: '0.85rem',
          color: 'var(--text-secondary)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          {viewMode === 'configured' ? (
            <span>
              Showing static registered MCP servers, autonomous agents, and upstream routing configuration.
            </span>
          ) : (
            <span>
              Showing actual runtime interactions aggregated from OpenTelemetry traces for tenant{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{api.getTenantId()}</strong>.
              {observedData && (
                <span style={{ marginLeft: '1rem', color: 'var(--cyan)' }}>
                  Total Observed Calls: <strong>{observedData.total_calls}</strong> | Errors:{' '}
                  <strong>{observedData.total_errors}</strong>
                </span>
              )}
            </span>
          )}
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Click any node or edge to inspect</span>
      </div>

      {loading ? (
        <div className="glass-panel empty-state">
          <div className="pulse-dot" style={{ width: 14, height: 14, marginBottom: '1rem' }} />
          <p>Rendering interaction graph...</p>
        </div>
      ) : error ? (
        <div className="alert-banner alert-error">{error}</div>
      ) : nodes.length <= 1 && edges.length === 0 ? (
        <div className="glass-panel empty-state">
          <div className="empty-state-icon">🌐</div>
          <div className="empty-state-title">No Upstream Targets Registered</div>
          <div className="empty-state-desc">
            No MCP servers or A2A autonomous agents have been configured for this tenant yet. Register a server or agent to generate the topology graph.
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="btn btn-primary" onClick={() => onNavigateTab && onNavigateTab('mcp')}>
              + Register MCP Server
            </button>
            <button className="btn btn-secondary" onClick={() => onNavigateTab && onNavigateTab('agents')}>
              + Register Agent
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: (selectedNode || selectedEdge) ? '1fr 340px' : '1fr', gap: '1.5rem' }}>
          {/* Main SVG Graph Canvas */}
          <div className="glass-panel topology-canvas">
            <svg width="100%" height="100%" viewBox="0 0 960 580" style={{ overflow: 'visible' }}>
              <defs>
                <linearGradient id="edgeGradConfigured" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.8" />
                </linearGradient>
                <linearGradient id="edgeGradObservedOk" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.9" />
                </linearGradient>
                <linearGradient id="edgeGradObservedErr" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#fb7185" stopOpacity="0.9" />
                </linearGradient>
                <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Render Edges */}
              {edges.map((edge) => {
                const srcPos = nodePositions[edge.source] || nodePositions['gateway'];
                const tgtPos = nodePositions[edge.target] || nodePositions['gateway'];
                const isSelected = selectedEdge?.id === edge.id;
                const hasErrors = edge.error_count > 0;

                // Curved bezier path
                const dx = tgtPos.x - srcPos.x;
                const dy = tgtPos.y - srcPos.y;
                const cx1 = srcPos.x + dx * 0.5;
                const cy1 = srcPos.y;
                const cx2 = srcPos.x + dx * 0.5;
                const cy2 = tgtPos.y;
                const pathD = `M ${srcPos.x} ${srcPos.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${tgtPos.x} ${tgtPos.y}`;

                const strokeWidth = viewMode === 'observed' ? Math.min(8, Math.max(2, Math.log2(edge.call_count + 1) * 2)) : 2.5;
                const strokeColor = viewMode === 'configured' 
                  ? 'url(#edgeGradConfigured)' 
                  : hasErrors 
                    ? 'url(#edgeGradObservedErr)' 
                    : 'url(#edgeGradObservedOk)';

                const midX = (srcPos.x + tgtPos.x) / 2;
                const midY = (srcPos.y + tgtPos.y) / 2;

                return (
                  <g key={edge.id} style={{ cursor: 'pointer' }} onClick={() => { setSelectedEdge(edge); setSelectedNode(null); }}>
                    <path
                      d={pathD}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray={viewMode === 'observed' ? '6 3' : 'none'}
                      filter={isSelected ? 'url(#glow)' : 'none'}
                      opacity={isSelected ? 1 : 0.75}
                    />

                    {/* Edge Badge / Call Count */}
                    {viewMode === 'observed' && edge.call_count > 0 && (
                      <g transform={`translate(${midX}, ${midY})`}>
                        <rect
                          x="-28"
                          y="-11"
                          width="56"
                          height="22"
                          rx="11"
                          fill={hasErrors ? '#f43f5e' : '#1e293b'}
                          stroke={hasErrors ? '#fda4af' : 'rgba(255,255,255,0.2)'}
                          strokeWidth="1"
                        />
                        <text
                          x="0"
                          y="4"
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize="10"
                          fontWeight="700"
                          fontFamily="var(--font-mono)"
                        >
                          {edge.call_count} req
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Render Nodes */}
              {nodes.map((node) => {
                const pos = nodePositions[node.id] || { x: 480, y: 280 };
                const isSelected = selectedNode?.id === node.id;
                const isGateway = node.id === 'gateway';

                let fillGradient = isGateway
                  ? 'linear-gradient(135deg, #6366f1, #06b6d4)'
                  : node.type === 'mcp_server'
                    ? 'linear-gradient(135deg, #0ea5e9, #2563eb)'
                    : node.type === 'agent'
                      ? 'linear-gradient(135deg, #8b5cf6, #6366f1)'
                      : 'linear-gradient(135deg, #10b981, #059669)';

                let strokeColor = node.status === 'HEALTHY'
                  ? '#10b981'
                  : node.status === 'DEGRADED'
                    ? '#f59e0b'
                    : node.status === 'UNHEALTHY'
                      ? '#f43f5e'
                      : '#64748b';

                return (
                  <g
                    key={node.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => { setSelectedNode(node); setSelectedEdge(null); }}
                  >
                    {/* Node Aura / Glow */}
                    <circle
                      r={isGateway ? 42 : 32}
                      fill={isGateway ? 'rgba(99, 102, 241, 0.2)' : 'rgba(15, 23, 42, 0.6)'}
                      stroke={isSelected ? '#38bdf8' : strokeColor}
                      strokeWidth={isSelected ? 3 : 2}
                      filter={isSelected ? 'url(#glow)' : 'none'}
                    />

                    {/* Central Icon */}
                    <circle
                      r={isGateway ? 30 : 22}
                      fill={isGateway ? '#6366f1' : '#1e293b'}
                    />
                    <text
                      x="0"
                      y={isGateway ? 6 : 4}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize={isGateway ? 16 : 12}
                      fontWeight="bold"
                    >
                      {isGateway ? 'GW' : node.type === 'mcp_server' ? 'MCP' : node.type === 'agent' ? 'A2A' : 'CLI'}
                    </text>

                    {/* Node Label Below */}
                    <text
                      x="0"
                      y={isGateway ? 58 : 46}
                      textAnchor="middle"
                      fill="#f8fafc"
                      fontSize="12"
                      fontWeight="600"
                      fontFamily="var(--font-sans)"
                    >
                      {node.label}
                    </text>

                    {/* Type Tag */}
                    <text
                      x="0"
                      y={isGateway ? 72 : 60}
                      textAnchor="middle"
                      fill="var(--text-muted)"
                      fontSize="10"
                      fontFamily="var(--font-sans)"
                    >
                      {node.type}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Side Drawer: Node or Edge Inspector */}
          {(selectedNode || selectedEdge) && (
            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                  {selectedNode ? 'Node Details' : 'Interaction Details'}
                </h3>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setSelectedNode(null); setSelectedEdge(null); }}
                >
                  ✕
                </button>
              </div>

              {selectedNode && (
                <>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Label & ID</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.2rem' }}>{selectedNode.label}</div>
                    <div className="code-pill" style={{ marginTop: '0.35rem', display: 'inline-block' }}>{selectedNode.id}</div>
                  </div>

                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Status</div>
                    <div style={{ marginTop: '0.35rem' }}>
                      <span className={`badge badge-${selectedNode.status.toLowerCase()}`}>
                        <span className="pulse-dot" /> {selectedNode.status}
                      </span>
                    </div>
                  </div>

                  {selectedNode.metadata && Object.keys(selectedNode.metadata).length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                        Metadata & Configuration
                      </div>
                      <pre
                        style={{
                          background: 'rgba(0,0,0,0.3)',
                          padding: '0.75rem',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.75rem',
                          fontFamily: 'var(--font-mono)',
                          maxHeight: '180px',
                          overflowY: 'auto',
                        }}
                      >
                        {JSON.stringify(selectedNode.metadata, null, 2)}
                      </pre>
                    </div>
                  )}

                  {viewMode === 'observed' && (
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Traffic Volume</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '0.2rem', color: 'var(--cyan)' }}>
                        {selectedNode.call_count} calls
                      </div>
                      {selectedNode.error_count > 0 && (
                        <div style={{ fontSize: '0.85rem', color: 'var(--danger)', marginTop: '0.2rem' }}>
                          {selectedNode.error_count} errors ({((selectedNode.error_count / selectedNode.call_count) * 100).toFixed(1)}%)
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: 'auto' }}>
                    {selectedNode.type === 'mcp_server' && (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => onNavigateTab && onNavigateTab('mcp')}
                      >
                        Manage MCP Server →
                      </button>
                    )}
                    {selectedNode.type === 'agent' && (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => onNavigateTab && onNavigateTab('agents')}
                      >
                        Manage A2A Agent →
                      </button>
                    )}
                  </div>
                </>
              )}

              {selectedEdge && (
                <>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Route Path</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: '0.35rem', color: 'var(--text-primary)' }}>
                      {selectedEdge.source} → {selectedEdge.target}
                    </div>
                    <div style={{ marginTop: '0.35rem' }}>
                      <span className="code-pill">Protocol: {selectedEdge.protocol.toUpperCase()}</span>
                    </div>
                  </div>

                  {viewMode === 'observed' && (
                    <>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Calls & Latency</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '0.2rem' }}>
                          {selectedEdge.call_count} calls
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                          Avg Duration: <strong>{selectedEdge.avg_latency_ms.toFixed(2)} ms</strong>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          p95 Latency: <strong>{selectedEdge.p95_latency_ms.toFixed(2)} ms</strong>
                        </div>
                      </div>

                      {selectedEdge.sample_trace_ids && selectedEdge.sample_trace_ids.length > 0 && (
                        <div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                            Associated Traces
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            {selectedEdge.sample_trace_ids.map((tid) => (
                              <button
                                key={tid}
                                className="btn btn-secondary btn-sm"
                                style={{ justifyContent: 'flex-start', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}
                                onClick={() => onSelectTrace && onSelectTrace(tid)}
                              >
                                View Waterfall: {tid.substring(0, 16)}...
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
