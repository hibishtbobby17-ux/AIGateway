'use client';

import React, { useState } from 'react';

interface Project {
  id: string;
  org_id?: string;
  name: string;
  slug: string;
  status: string;
  settings: Record<string, any>;
  config_version: number;
  server_count?: number;
  servers?: any[];
  created_at: string;
}

interface DashboardViewProps {
  projects: Project[];
  gatewaysList: any[];
  onSelectProject: (project: Project) => void;
  onCreateProject: () => void;
  onNavigateToTab: (tabId: string) => void;
}

export default function DashboardView({
  projects,
  gatewaysList,
  onSelectProject,
  onCreateProject,
  onNavigateToTab,
}: DashboardViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTimeframe, setSelectedTimeframe] = useState<'24h' | '7d' | '30d'>('24h');

  const activeGatewaysCount = gatewaysList.filter(g => g.status === 'active').length;
  const totalServersCount = projects.reduce((acc, p) => acc + (p.server_count || p.servers?.length || 0), 0);

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.slug.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Page Title & Action Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.025em' }}>
            Operations & Fleet Dashboard
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '4px' }}>
            Unified real-time telemetry, project ingress/egress routes, and multi-gateway fleet orchestration.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Timeframe Selector */}
          <div style={{
            display: 'flex',
            background: 'var(--bg-surface-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '3px'
          }}>
            {(['24h', '7d', '30d'] as const).map(tf => (
              <button
                key={tf}
                onClick={() => setSelectedTimeframe(tf)}
                style={{
                  background: selectedTimeframe === tf ? 'var(--bg-surface)' : 'transparent',
                  color: selectedTimeframe === tf ? 'var(--primary-text)' : 'var(--text-muted)',
                  fontWeight: selectedTimeframe === tf ? 600 : 500,
                  fontSize: '0.8rem',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 10px',
                  cursor: 'pointer',
                  boxShadow: selectedTimeframe === tf ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            onClick={onCreateProject}
            className="btn-primary"
            id="dash-create-project-btn"
            style={{ height: '38px', padding: '0 16px' }}
          >
            <span style={{ fontSize: '1.1rem', marginRight: '4px' }}>+</span> Create Project
          </button>
        </div>
      </div>

      {/* Metric KPI Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: '16px'
      }}>
        {/* Metric 1: Total Invocations */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Total Requests
            </span>
            <span style={{ fontSize: '1.2rem' }}>⚡</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--text-main)' }}>2.48M</span>
            <span className="badge badge-emerald" style={{ fontSize: '0.72rem' }}>+14.2%</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
            Avg 412 req/sec peak
          </span>
        </div>

        {/* Metric 2: Active Gateways */}
        <div
          className="glass-panel"
          style={{ padding: '20px', cursor: 'pointer' }}
          onClick={() => onNavigateToTab('gateways')}
          title="Click to view Gateway Fleet"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              AI Gateways
            </span>
            <span style={{ fontSize: '1.2rem' }}>🌐</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--text-main)' }}>
              {activeGatewaysCount || gatewaysList.length || 17}
            </span>
            <span className="badge badge-emerald" style={{ fontSize: '0.72rem' }}>100% Online</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--primary-text)', marginTop: '4px', display: 'block', fontWeight: 500 }}>
            Fleet active & synced →
          </span>
        </div>

        {/* Metric 3: P95 Latency */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              P95 Latency
            </span>
            <span style={{ fontSize: '1.2rem' }}>⏱️</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--text-main)' }}>14.2ms</span>
            <span className="badge badge-indigo" style={{ fontSize: '0.72rem' }}>P99 28.6ms</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
            Outbound dial overhead &lt; 2.1ms
          </span>
        </div>

        {/* Metric 4: Error Rate */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Error Rate
            </span>
            <span style={{ fontSize: '1.2rem' }}>🛡️</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '1.9rem', fontWeight: 800, color: '#059669' }}>0.018%</span>
            <span className="badge badge-emerald" style={{ fontSize: '0.72rem' }}>Stable</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
            44 retries jitter-handled
          </span>
        </div>

        {/* Metric 5: Downstream MCPs & Agents */}
        <div
          className="glass-panel"
          style={{ padding: '20px', cursor: 'pointer' }}
          onClick={() => onNavigateToTab('mcp-marketplace')}
          title="Click to view MCP Marketplace"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Downstream MCPs
            </span>
            <span style={{ fontSize: '1.2rem' }}>🔌</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--text-main)' }}>
              {totalServersCount || 48}
            </span>
            <span className="badge badge-cyan" style={{ fontSize: '0.72rem' }}>12 Agents</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--primary-text)', marginTop: '4px', display: 'block', fontWeight: 500 }}>
            Browse Marketplace →
          </span>
        </div>

        {/* Metric 6: Universal LLM Gateways */}
        <div
          className="glass-panel"
          style={{ padding: '20px', cursor: 'pointer' }}
          onClick={() => onNavigateToTab('llm-gateway')}
          title="Click to view LLM Gateway"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              LLM Gateways
            </span>
            <span style={{ fontSize: '1.2rem' }}>🔮</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--text-main)' }}>
              5.32M
            </span>
            <span className="badge badge-indigo" style={{ fontSize: '0.72rem' }}>Tokens</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--primary-text)', marginTop: '4px', display: 'block', fontWeight: 500 }}>
            Multi-Cloud LLM Proxy →
          </span>
        </div>
      </div>

      {/* Interactive Telemetry & Traffic Graphs */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
        gap: '20px'
      }}>
        {/* Graph 1: Throughput (RPS over time) */}
        <div className="glass-panel" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                Gateway Ingress & Egress Throughput
              </h3>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Aggregated requests/sec over {selectedTimeframe}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.75rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#4f46e5' }}></span>
                Ingress MCP
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#0ea5e9' }}></span>
                Downstream Dial
              </span>
            </div>
          </div>

          {/* SVG Line / Area Graph */}
          <div style={{ width: '100%', height: '180px', position: 'relative' }}>
            <svg viewBox="0 0 500 160" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
              <defs>
                <linearGradient id="ingressGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="egressGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.30" />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              <line x1="0" y1="30" x2="500" y2="30" stroke="var(--border-subtle)" strokeDasharray="3 3" />
              <line x1="0" y1="70" x2="500" y2="70" stroke="var(--border-subtle)" strokeDasharray="3 3" />
              <line x1="0" y1="110" x2="500" y2="110" stroke="var(--border-subtle)" strokeDasharray="3 3" />
              <line x1="0" y1="150" x2="500" y2="150" stroke="var(--border-subtle)" />

              {/* Egress Curve */}
              <path
                d="M 0 130 Q 80 110 160 85 T 320 60 T 420 45 T 500 35 L 500 150 L 0 150 Z"
                fill="url(#egressGrad)"
              />
              <path
                d="M 0 130 Q 80 110 160 85 T 320 60 T 420 45 T 500 35"
                fill="none"
                stroke="#0ea5e9"
                strokeWidth="2.5"
                strokeLinecap="round"
              />

              {/* Ingress Curve */}
              <path
                d="M 0 120 Q 75 95 150 70 T 300 45 T 410 30 T 500 20 L 500 150 L 0 150 Z"
                fill="url(#ingressGrad)"
              />
              <path
                d="M 0 120 Q 75 95 150 70 T 300 45 T 410 30 T 500 20"
                fill="none"
                stroke="#4f46e5"
                strokeWidth="2.5"
                strokeLinecap="round"
              />

              {/* Data points */}
              <circle cx="150" cy="70" r="4" fill="#4f46e5" stroke="#fff" strokeWidth="2" />
              <circle cx="300" cy="45" r="4" fill="#4f46e5" stroke="#fff" strokeWidth="2" />
              <circle cx="410" cy="30" r="4" fill="#4f46e5" stroke="#fff" strokeWidth="2" />
              <circle cx="500" cy="20" r="4" fill="#4f46e5" stroke="#fff" strokeWidth="2" />
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '8px' }}>
              <span>00:00</span>
              <span>06:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>Now</span>
            </div>
          </div>
        </div>

        {/* Graph 2: Latency & Service Breakdown */}
        <div className="glass-panel" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                Response Latency & Protocol Breakdown
              </h3>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Transport distribution & percentile timings
              </span>
            </div>
            <span className="badge badge-emerald" style={{ fontSize: '0.72rem' }}>
              Zero Drop
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingTop: '8px' }}>
            {/* Breakdown Item 1: Streamable HTTP */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '6px' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Streamable HTTP (JSON-RPC)</span>
                <span style={{ color: 'var(--text-muted)' }}>68% • 11.4ms avg</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: 'var(--bg-surface-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: '68%', height: '100%', background: 'linear-gradient(90deg, #4f46e5, #6366f1)', borderRadius: '4px' }}></div>
              </div>
            </div>

            {/* Breakdown Item 2: SSE (Server-Sent Events) */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '6px' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Server-Sent Events (SSE Streaming)</span>
                <span style={{ color: 'var(--text-muted)' }}>24% • 18.2ms avg</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: 'var(--bg-surface-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: '24%', height: '100%', background: 'linear-gradient(90deg, #0ea5e9, #38bdf8)', borderRadius: '4px' }}></div>
              </div>
            </div>

            {/* Breakdown Item 3: A2A Task Events */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '6px' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Agent-to-Agent (A2A Protocol)</span>
                <span style={{ color: 'var(--text-muted)' }}>8% • 22.8ms avg</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: 'var(--bg-surface-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: '8%', height: '100%', background: 'linear-gradient(90deg, #10b981, #34d399)', borderRadius: '4px' }}></div>
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--bg-surface-subtle)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 14px',
              marginTop: '4px'
            }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Active Traces in ClickHouse: <strong style={{ color: 'var(--text-main)' }}>148,290</strong>
              </span>
              <button
                onClick={() => onNavigateToTab('logs')}
                className="btn-secondary"
                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
              >
                Inspect Telemetry →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Projects Section Header & Search */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', marginTop: '10px' }}>
        <div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-main)' }}>
            All Active Projects ({filteredProjects.length})
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>
            Click on any project card to configure Inbound Authentication, TLS Certificates, Downstream MCPs, and Outbound Security.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '280px' }}>
          <input
            type="text"
            className="input-field"
            placeholder="Search projects by name, slug, or gateway..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ height: '38px', fontSize: '0.85rem' }}
          />
        </div>
      </div>

      {/* All Projects Cards / Tiles Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
        gap: '20px'
      }}>
        {filteredProjects.map((project) => {
          // Resolve associated gateway
          const boundGatewayId = project.settings?.gateway_id;
          const associatedGateway = gatewaysList.find(g => g.id === boundGatewayId || g.name === boundGatewayId) ||
            gatewaysList[0] || { name: 'gateway-default-01', status: 'active' };

          const authMode = project.settings?.inbound_auth_mode || project.settings?.auth_mode || 'OAuth 2.1 (PKCE)';
          const tlsMode = project.settings?.tls?.cert_mode === 'custom_file' ? 'Custom PEM' : 'Auto-Cert (TLS 1.3)';
          const ingressPath = `/p/${project.slug}/mcp`;
          const serverCount = project.server_count ?? (project.servers?.length ?? 2);

          return (
            <div
              key={project.id}
              className="glass-panel"
              style={{
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                position: 'relative',
                cursor: 'pointer',
                border: '1px solid var(--border-subtle)',
              }}
              onClick={() => onSelectProject(project)}
              title={`Click to open full configuration for ${project.name}`}
            >
              <div>
                {/* Tile Header: Name, Status & Config Version */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '2px' }}>
                      {project.name}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="font-mono" style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        slug: /{project.slug}
                      </span>
                      <span className="badge badge-indigo" style={{ fontSize: '0.65rem' }}>
                        v{project.config_version || 1}
                      </span>
                    </div>
                  </div>

                  <span className="badge badge-emerald" style={{ fontSize: '0.72rem' }}>
                    ● {project.status || 'Active'}
                  </span>
                </div>

                {/* Associated AI Gateway */}
                <div style={{
                  background: 'var(--bg-surface-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  padding: '10px 12px',
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.95rem' }}>⚡</span>
                    <div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>
                        Associated AI Gateway
                      </span>
                      <strong style={{ fontSize: '0.85rem', color: 'var(--text-main)', fontFamily: 'JetBrains Mono, monospace' }}>
                        {associatedGateway.name || 'gateway-default-01'}
                      </strong>
                    </div>
                  </div>

                  <span className={`badge ${associatedGateway.status === 'active' ? 'badge-emerald' : 'badge-amber'}`} style={{ fontSize: '0.68rem' }}>
                    {associatedGateway.status === 'active' ? '● Online' : 'Standby'}
                  </span>
                </div>

                {/* Ingress Route Details */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                      Ingress Route
                    </span>
                    <span className="badge badge-cyan" style={{ fontSize: '0.65rem' }}>
                      {tlsMode}
                    </span>
                  </div>
                  <div style={{
                    background: 'var(--bg-surface-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 10px',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '0.8rem',
                    color: 'var(--primary-text)'
                  }}>
                    <span>POST {ingressPath}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>+SSE</span>
                  </div>
                </div>

                {/* Egress Route Details */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                      Egress Target Downstreams
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {serverCount} Downstreams mapped
                    </span>
                  </div>
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px'
                  }}>
                    <span className="badge badge-indigo" style={{ fontSize: '0.7rem' }}>
                      🔌 Downstream MCPs ({serverCount})
                    </span>
                    <span className="badge badge-emerald" style={{ fontSize: '0.7rem' }}>
                      🤖 AI Agents (2)
                    </span>
                    <span className="badge badge-cyan" style={{ fontSize: '0.7rem' }}>
                      🔒 {authMode}
                    </span>
                  </div>
                </div>
              </div>

              {/* Tile Footer Action */}
              <div style={{
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Created {new Date(project.created_at || Date.now()).toLocaleDateString()}
                </span>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectProject(project);
                  }}
                  className="btn-secondary"
                  style={{
                    fontSize: '0.82rem',
                    padding: '6px 12px',
                    color: 'var(--primary-text)',
                    fontWeight: 600
                  }}
                >
                  Configure Project →
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
