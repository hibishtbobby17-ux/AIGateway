'use client';

import React, { useState } from 'react';

interface GatewayGraphicTopologyViewProps {
  gateway: any;
  projects: any[];
  onBack: () => void;
  onSelectProject: (project: any) => void;
  showBanner: (text: string, type: 'success' | 'error' | 'info') => void;
}

export default function GatewayGraphicTopologyView({
  gateway,
  projects,
  onBack,
  onSelectProject,
  showBanner,
}: GatewayGraphicTopologyViewProps) {
  const [selectedNode, setSelectedNode] = useState<any>({
    type: 'gateway',
    name: gateway.name,
    id: gateway.id,
    rps: '412 req/sec',
    latency: '11.4ms',
    errorRate: '0.012%',
    version: gateway.version || 'v1.0.0',
    appliedConfig: `v${gateway.applied_config_version || 147}`,
    status: 'ACTIVE'
  });

  // Bound Projects
  const boundProjects = projects.length > 0 ? projects.slice(0, 3) : [
    { id: 'proj-prod', name: 'Production Gateway', slug: 'production', config_version: 147 },
    { id: 'proj-sup', name: 'Customer Support Bot', slug: 'support', config_version: 12 },
    { id: 'proj-eng', name: 'Internal Data Analysis', slug: 'analytics', config_version: 34 }
  ];

  // Downstreams (MCPs & Agents)
  const downstreamTargets = [
    { id: 'mcp-math', name: 'Mock Math Tools', type: 'mcp', prefix: 'math_', transport: 'HTTP', latency: '8.2ms', toolsCount: 6, status: 'HEALTHY' },
    { id: 'mcp-weather', name: 'Weather Forecast MCP', type: 'mcp', prefix: 'weather_', transport: 'HTTP', latency: '12.4ms', toolsCount: 4, status: 'HEALTHY' },
    { id: 'mcp-postgres', name: 'Enterprise Postgres MCP', type: 'mcp', prefix: 'db_', transport: 'Streamable HTTP', latency: '15.1ms', toolsCount: 18, status: 'HEALTHY' },
    { id: 'agent-research', name: 'Autonomous Research Synthesizer', type: 'agent', prefix: 'agent_res_', transport: 'A2A Task Protocol', latency: '24.6ms', toolsCount: 1, status: 'HEALTHY' },
    { id: 'agent-code', name: 'Code Reviewer Agent', type: 'agent', prefix: 'agent_code_', transport: 'A2A Task Protocol', latency: '21.0ms', toolsCount: 1, status: 'HEALTHY' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Topology Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '14px',
        borderBottom: '1px solid var(--border-subtle)',
        paddingBottom: '18px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button onClick={onBack} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.85rem' }}>
            ← Back to Gateway Fleet
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
                Graphic Topology: {gateway.name}
              </h1>
              <span className="badge badge-emerald">● Online</span>
              <span className="badge badge-indigo">v{gateway.applied_config_version || 147}</span>
            </div>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Interactive visual data flow connecting Ingress Projects, Endpoints, AI Gateway Core, and Downstreams.
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => showBanner('Live topology refreshed from trace telemetry', 'info')}
            className="btn-secondary"
            style={{ fontSize: '0.82rem', height: '36px' }}
          >
            🔄 Refresh Graph
          </button>
        </div>
      </div>

      {/* Main Canvas + Right Inspector Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 340px',
        gap: '20px',
        minHeight: '620px'
      }}>
        {/* Visual Topology Diagram Canvas */}
        <div className="glass-panel" style={{
          padding: '24px',
          background: 'radial-gradient(ellipse at 50% 50%, rgba(79, 70, 229, 0.04) 0%, var(--bg-surface) 100%)',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Canvas Title & Legends */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Configured vs. Observed Live Topology
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4f46e5' }}></span> Project Ingress
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#0ea5e9' }}></span> AI Gateway
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></span> Downstream Target
              </span>
            </div>
          </div>

          {/* Topology Columns Container */}
          <div style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '260px 1fr 280px',
            alignItems: 'center',
            gap: '24px',
            position: 'relative'
          }}>
            {/* COLUMN 1: Projects & Ingress Endpoints */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', zIndex: 10 }}>
              <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                1. Bound Projects & Ingress
              </div>

              {boundProjects.map((p, idx) => (
                <div
                  key={p.id || idx}
                  onClick={() => setSelectedNode({
                    type: 'project',
                    name: p.name,
                    slug: p.slug,
                    id: p.id,
                    endpoint: `/p/${p.slug}/mcp`,
                    auth: 'OAuth 2.1 (PKCE)',
                    tls: 'TLS 1.3 Strict',
                    volume: '142 req/sec',
                    latency: '10.8ms',
                    rawProject: p
                  })}
                  style={{
                    background: selectedNode.name === p.name ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                    border: selectedNode.name === p.name ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px',
                    boxShadow: 'var(--card-shadow)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <strong style={{ fontSize: '0.88rem', color: 'var(--text-main)' }}>{p.name}</strong>
                    <span className="badge badge-emerald" style={{ fontSize: '0.65rem' }}>Active</span>
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--primary-text)', marginBottom: '6px' }}>
                    POST /p/{p.slug}/mcp
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <span className="badge badge-indigo" style={{ fontSize: '0.62rem' }}>TLS 1.3</span>
                    <span className="badge badge-cyan" style={{ fontSize: '0.62rem' }}>PKCE</span>
                  </div>
                </div>
              ))}
            </div>

            {/* COLUMN 2: Center AI Gateway Node */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              padding: '0 10px'
            }}>
              <div
                onClick={() => setSelectedNode({
                  type: 'gateway',
                  name: gateway.name,
                  id: gateway.id,
                  rps: '412 req/sec',
                  latency: '11.4ms',
                  errorRate: '0.012%',
                  version: gateway.version || 'v1.0.0',
                  appliedConfig: `v${gateway.applied_config_version || 147}`,
                  status: 'ACTIVE'
                })}
                style={{
                  width: '210px',
                  background: 'var(--bg-surface)',
                  border: selectedNode.type === 'gateway' ? '3px solid var(--primary)' : '2px solid #0ea5e9',
                  borderRadius: 'var(--radius-lg)',
                  padding: '20px',
                  boxShadow: '0 10px 30px rgba(79, 70, 229, 0.15)',
                  cursor: 'pointer',
                  textAlign: 'center',
                  position: 'relative'
                }}
              >
                {/* Pulsing indicator */}
                <div style={{
                  position: 'absolute',
                  top: '-8px',
                  right: '-8px',
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: '#10b981',
                  border: '2px solid #fff',
                  boxShadow: '0 0 10px #10b981'
                }}></div>

                <div style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'linear-gradient(135deg, #4f46e5, #0ea5e9)',
                  color: '#fff',
                  fontSize: '1.4rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px auto',
                  boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)'
                }}>
                  ⚡
                </div>

                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '2px' }}>
                  {gateway.name}
                </h3>
                <span className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '10px' }}>
                  AI Gateway Core
                </span>

                <div style={{
                  background: 'var(--bg-surface-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 10px',
                  fontSize: '0.74rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '6px'
                }}>
                  <span style={{ color: 'var(--text-muted)' }}>Throughput:</span>
                  <strong style={{ color: 'var(--primary-text)' }}>412 RPS</strong>
                </div>

                <div style={{
                  background: 'var(--bg-surface-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 10px',
                  fontSize: '0.74rem',
                  display: 'flex',
                  justifyContent: 'space-between'
                }}>
                  <span style={{ color: 'var(--text-muted)' }}>P95 Latency:</span>
                  <strong style={{ color: '#059669' }}>14.2ms</strong>
                </div>
              </div>
            </div>

            {/* COLUMN 3: Downstream MCPs & Autonomous AI Agents */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', zIndex: 10 }}>
              <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                2. Downstream MCPs & AI Agents ({downstreamTargets.length})
              </div>

              {downstreamTargets.map((d) => (
                <div
                  key={d.id}
                  onClick={() => setSelectedNode({
                    type: d.type === 'agent' ? 'agent' : 'mcp',
                    name: d.name,
                    id: d.id,
                    prefix: d.prefix,
                    transport: d.transport,
                    latency: d.latency,
                    toolsCount: d.toolsCount,
                    status: d.status
                  })}
                  style={{
                    background: selectedNode.name === d.name ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                    border: selectedNode.name === d.name ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 14px',
                    boxShadow: 'var(--card-shadow)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '1rem' }}>{d.type === 'agent' ? '🤖' : '🔌'}</span>
                      <strong style={{ fontSize: '0.84rem', color: 'var(--text-main)' }}>{d.name}</strong>
                    </div>
                    <span className="badge badge-emerald" style={{ fontSize: '0.62rem' }}>{d.latency}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                    <code className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--primary-text)' }}>
                      {d.prefix}*
                    </code>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {d.transport}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Node Inspector Panel */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span className="badge badge-indigo" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>
                {selectedNode.type} Details
              </span>
              <span className="badge badge-emerald">HEALTHY</span>
            </div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)' }}>
              {selectedNode.name}
            </h3>
            <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {selectedNode.id || selectedNode.slug}
            </span>
          </div>

          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {selectedNode.type === 'project' && (
              <>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Ingress Route:</span>
                  <strong className="font-mono" style={{ fontSize: '0.82rem', color: 'var(--primary-text)' }}>{selectedNode.endpoint}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Authentication:</span>
                  <strong style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>{selectedNode.auth}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Endpoint TLS:</span>
                  <strong style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>{selectedNode.tls}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Observed Volume:</span>
                  <strong style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>{selectedNode.volume}</strong>
                </div>

                <button
                  onClick={() => onSelectProject(selectedNode.rawProject)}
                  className="btn-primary"
                  style={{ width: '100%', marginTop: '10px', fontSize: '0.82rem' }}
                >
                  Configure This Project →
                </button>
              </>
            )}

            {selectedNode.type === 'gateway' && (
              <>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Throughput:</span>
                  <strong style={{ fontSize: '0.9rem', color: 'var(--primary-text)' }}>{selectedNode.rps}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>P95 Latency:</span>
                  <strong style={{ fontSize: '0.9rem', color: '#059669' }}>{selectedNode.latency}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Error Rate:</span>
                  <strong style={{ fontSize: '0.9rem', color: '#059669' }}>{selectedNode.errorRate}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Applied Config:</span>
                  <strong className="badge badge-indigo">{selectedNode.appliedConfig}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Runtime Engine:</span>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>Go Headless MCP Gateway (port 8080)</span>
                </div>
              </>
            )}

            {(selectedNode.type === 'mcp' || selectedNode.type === 'agent') && (
              <>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Namespace:</span>
                  <code className="font-mono" style={{ color: 'var(--primary-text)' }}>{selectedNode.prefix}*</code>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Transport Protocol:</span>
                  <strong style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>{selectedNode.transport}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Observed Latency:</span>
                  <strong style={{ fontSize: '0.82rem', color: '#059669' }}>{selectedNode.latency}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Exposed Capabilities:</span>
                  <strong style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>{selectedNode.toolsCount} Tool(s) / Actions</strong>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
