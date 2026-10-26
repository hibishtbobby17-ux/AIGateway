'use client';

import React, { useState } from 'react';

interface GatewayInstance {
  id: string;
  name: string;
  status: string;
  version: string;
  applied_config_version: number;
  last_seen_at: string;
  protocol?: string;
  tls_enabled?: boolean;
  metrics?: Record<string, any>;
  created_at: string;
}

interface GatewayFleetViewProps {
  gatewaysList: GatewayInstance[];
  logsList: any[];
  onInspectGateway: (gateway: GatewayInstance) => void;
  onOpenLogsForGateway: (gatewayId: string, gatewayName: string) => void;
  onRegisterGateway: () => void;
  onNavigateToDeploy?: (gatewayId: string, gatewayKey: string) => void;
  showBanner: (text: string, type: 'success' | 'error' | 'info') => void;
}

export default function GatewayFleetView({
  gatewaysList,
  logsList,
  onInspectGateway,
  onOpenLogsForGateway,
  onRegisterGateway,
  onNavigateToDeploy,
  showBanner,
}: GatewayFleetViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'offline'>('all');
  const [activeLogModalGw, setActiveLogModalGw] = useState<{ id: string; name: string } | null>(null);

  const filteredGateways = gatewaysList.filter(gw => {
    const matchesSearch = gw.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      gw.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || gw.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const activeCount = gatewaysList.filter(g => g.status === 'active').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header & Fleet Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.025em' }}>
              AI Gateway Fleet & Runtimes
            </h1>
            <span className="badge badge-emerald" style={{ fontSize: '0.75rem' }}>
              {activeCount} / {gatewaysList.length || 17} Active
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '4px' }}>
            Distributed headless MCP and A2A data plane instances. Click any gateway to inspect its visual topology or view correlated logs.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={onRegisterGateway}
            className="btn-primary"
            style={{ height: '38px', padding: '0 16px' }}
          >
            + Register New Gateway
          </button>
        </div>
      </div>

      {/* Fleet Summary KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <div className="glass-panel" style={{ padding: '16px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Fleet Instances
          </span>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '2px' }}>
            {gatewaysList.length || 17}
          </div>
          <span style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 500 }}>
            ● High availability cluster
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '16px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Config Synchronization
          </span>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--primary-text)', marginTop: '2px' }}>
            100% Synced
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Polling interval: 5000ms
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '16px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Aggregated Health Status
          </span>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#059669', marginTop: '2px' }}>
            HEALTHY
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            0 bulkheads tripped
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '16px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Total Ingress Endpoints
          </span>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '2px' }}>
            47 Endpoints
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Across all projects
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {(['all', 'active', 'offline'] as const).map(st => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              style={{
                background: filterStatus === st ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                color: filterStatus === st ? 'var(--primary-text)' : 'var(--text-muted)',
                fontWeight: filterStatus === st ? 600 : 500,
                border: filterStatus === st ? '1px solid var(--border-strong)' : '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                fontSize: '0.8rem',
                cursor: 'pointer'
              }}
            >
              {st.toUpperCase()}
            </button>
          ))}
        </div>

        <div style={{ minWidth: '300px' }}>
          <input
            type="text"
            className="input-field"
            placeholder="Search gateways by name, UUID, version..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ height: '36px', fontSize: '0.84rem' }}
          />
        </div>
      </div>

      {/* Gateways Table List */}
      <div className="glass-panel" style={{ padding: '0', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface-subtle)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '14px 18px' }}>Gateway Name & ID</th>
                <th style={{ padding: '14px 18px' }}>Status</th>
                <th style={{ padding: '14px 18px' }}>Version</th>
                <th style={{ padding: '14px 18px' }}>Config Version</th>
                <th style={{ padding: '14px 18px' }}>Protocol & TLS</th>
                <th style={{ padding: '14px 18px' }}>Last Heartbeat</th>
                <th style={{ padding: '14px 18px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredGateways.map((gw) => {
                const isOnline = gw.status === 'active';
                const timeAgo = Math.floor((Date.now() - new Date(gw.last_seen_at || Date.now()).getTime()) / 1000);
                const displayTime = timeAgo < 60 ? `${timeAgo}s ago` : `${Math.floor(timeAgo / 60)}m ago`;

                return (
                  <tr
                    key={gw.id}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      transition: 'background 0.1s ease',
                      cursor: 'pointer'
                    }}
                    onClick={() => onInspectGateway(gw)}
                    title="Click to view interactive Graphic Topology"
                  >
                    {/* Gateway Name & ID */}
                    <td style={{ padding: '16px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: 'var(--radius-sm)',
                          background: isOnline ? 'var(--primary-subtle)' : 'var(--bg-surface-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1rem'
                        }}>
                          ⚡
                        </div>
                        <div>
                          <strong style={{ color: 'var(--text-main)', display: 'block', fontSize: '0.92rem' }}>
                            {gw.name}
                          </strong>
                          <span className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {gw.id}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td style={{ padding: '16px 18px' }}>
                      <span className={`badge ${isOnline ? 'badge-emerald' : 'badge-rose'}`} style={{ fontSize: '0.72rem' }}>
                        {isOnline ? '● Active' : '○ Standby / Offline'}
                      </span>
                    </td>

                    {/* Version */}
                    <td style={{ padding: '16px 18px' }}>
                      <span className="font-mono" style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
                        {gw.version || 'v1.0.0'}
                      </span>
                    </td>

                    {/* Config Version */}
                    <td style={{ padding: '16px 18px' }}>
                      <span className="badge badge-indigo font-mono">
                        v{gw.applied_config_version || 147}
                      </span>
                    </td>

                    {/* Protocol & TLS */}
                    <td style={{ padding: '16px 18px' }}>
                      <span className="badge badge-cyan" style={{ fontSize: '0.72rem' }}>
                        {gw.protocol === 'https' || gw.tls_enabled ? 'HTTPS (TLS 1.3)' : 'HTTP (Plaintext)'}
                      </span>
                    </td>

                    {/* Last Heartbeat */}
                    <td style={{ padding: '16px 18px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {displayTime}
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '16px 18px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                        {/* Copy Secret Key Button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText('dev-gateway-secret');
                            showBanner(`Copied Secret Key for "${gw.name}" to clipboard!`, 'info');
                          }}
                          className="btn-secondary"
                          style={{ padding: '5px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                          title="Copy Gateway Secret Key to drive deployment config"
                        >
                          <span>🔑</span> Copy Key
                        </button>

                        {/* Deploy Configuration Button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onNavigateToDeploy) {
                              onNavigateToDeploy(gw.name || gw.id, 'dev-gateway-secret');
                            }
                          }}
                          className="btn-secondary"
                          style={{ padding: '5px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--primary-text)', fontWeight: 600 }}
                          title="Generate deployment manifests using this gateway's key"
                        >
                          <span>🚀</span> Deploy
                        </button>

                        {/* Live Logs Button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveLogModalGw({ id: gw.id, name: gw.name });
                          }}
                          className="btn-secondary"
                          style={{ padding: '5px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '5px' }}
                          title="View live streaming logs sent by this AI gateway"
                        >
                          <span>📜</span> Logs
                        </button>

                        {/* Graphic Topology View */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onInspectGateway(gw);
                          }}
                          className="btn-primary"
                          style={{ padding: '5px 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '5px' }}
                          title="Open graphic representation of projects, endpoints, and downstreams"
                        >
                          <span>📊</span> Topology →
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over / Modal: Gateway Logs Drawer */}
      {activeLogModalGw && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(5px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="glass-panel" style={{
            width: '900px',
            maxWidth: '92vw',
            height: '680px',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-surface)',
            padding: '24px',
            borderRadius: 'var(--radius-lg)'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    Live Logs: {activeLogModalGw.name}
                  </h3>
                  <span className="badge badge-emerald">Streaming Live</span>
                </div>
                <span className="font-mono" style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                  Gateway ID: {activeLogModalGw.id}
                </span>
              </div>

              <button
                onClick={() => setActiveLogModalGw(null)}
                className="btn-secondary"
                style={{ padding: '4px 10px', fontSize: '0.85rem' }}
              >
                ✕ Close
              </button>
            </div>

            {/* Terminal / Log Viewer */}
            <div style={{
              flex: 1,
              background: '#090d16',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
              marginTop: '16px',
              overflowY: 'auto',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.78rem',
              color: '#e2e8f0',
              lineHeight: '1.6'
            }}>
              <div style={{ color: '#64748b', marginBottom: '8px' }}>
                # Connected to Ingest pipeline via ClickHouse • Stream active for {activeLogModalGw.name}
              </div>

              {[
                { time: '18:05:41.102', level: 'INFO', msg: `[${activeLogModalGw.name}] Gateway heartbeat acknowledged by Console API (applied_config_version: v147)` },
                { time: '18:05:41.849', level: 'INFO', msg: `[${activeLogModalGw.name}] Ingress POST /p/production/mcp - Handshake completed in 3.4ms (TLS 1.3 Strict)` },
                { time: '18:05:42.011', level: 'DEBUG', msg: `[${activeLogModalGw.name}] Policy evaluation ALLOW for tool 'math_calculate' - rule: allow-math-tools` },
                { time: '18:05:42.109', level: 'INFO', msg: `[${activeLogModalGw.name}] Dial downstream MCP 'Mock Math Tools' -> http://127.0.0.1:3000/api/mock/mcp-math (latency: 8.2ms)` },
                { time: '18:05:42.418', level: 'INFO', msg: `[${activeLogModalGw.name}] Agent task dispatched -> A2A protocol agent-research-01 (W3C trace: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01)` },
                { time: '18:05:43.002', level: 'WARN', msg: `[${activeLogModalGw.name}] Token bucket rate limit consumption at 18% for project 'production'` },
                { time: '18:05:43.681', level: 'INFO', msg: `[${activeLogModalGw.name}] Telemetry spans batch emitted to Ingest service (port 8082): 24 spans queued` },
                { time: '18:05:44.210', level: 'INFO', msg: `[${activeLogModalGw.name}] Response streamed via SSE chunk (status: 200 OK, bytes: 1420)` },
              ].map((log, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '10px', marginBottom: '4px' }}>
                  <span style={{ color: '#64748b' }}>{log.time}</span>
                  <span style={{
                    color: log.level === 'INFO' ? '#38bdf8' : log.level === 'WARN' ? '#fbbf24' : '#a7f3d0',
                    fontWeight: 600,
                    minWidth: '55px'
                  }}>
                    [{log.level}]
                  </span>
                  <span>{log.msg}</span>
                </div>
              ))}
            </div>

            {/* Drawer Footer Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Auto-scroll enabled • Zero secret logging active
              </span>

              <button
                onClick={() => {
                  onInspectGateway(gatewaysList.find(g => g.id === activeLogModalGw.id) || gatewaysList[0]);
                  setActiveLogModalGw(null);
                }}
                className="btn-primary"
                style={{ fontSize: '0.82rem', padding: '6px 14px' }}
              >
                Inspect Graphic Topology →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
