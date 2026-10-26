'use client';

import React, { useState } from 'react';

interface InboundEndpointsViewProps {
  projects: any[];
  gatewaysList: any[];
  onNavigateToPolicies: (projectId: string) => void;
  onNavigateToCerts: (gatewayId?: string) => void;
  onInspectGateway: (gatewayId: string) => void;
  onRefresh: () => void;
}

export default function InboundEndpointsView({
  projects,
  gatewaysList,
  onNavigateToPolicies,
  onNavigateToCerts,
  onInspectGateway,
  onRefresh,
}: InboundEndpointsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [selectedGatewayId, setSelectedGatewayId] = useState<string>('all');
  const [protocolFilter, setProtocolFilter] = useState<'all' | 'https' | 'http'>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeSnippetTab, setActiveSnippetTab] = useState<Record<string, 'claude' | 'cursor' | 'curl'>>({});
  const [expandedToolsProjectId, setExpandedToolsProjectId] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  // Determine gateway base URL
  const activeGateway = gatewaysList.find(g => g.status === 'active') || gatewaysList[0];
  const baseUrl = activeGateway?.base_url || 'http://localhost:8080';
  const isHttps = activeGateway?.protocol === 'https' || activeGateway?.tls_enabled;

  // Helper to determine which gateways host a project
  const getHostingGateways = (projectId: string) => {
    return gatewaysList.filter(g => {
      if (!g.bound_projects || g.bound_projects.length === 0) return true; // Global mode serves all projects
      return g.bound_projects.some((bp: any) => bp.id === projectId);
    });
  };

  // Filter projects
  const filteredProjects = projects.filter((p) => {
    if (selectedProjectId !== 'all' && p.id !== selectedProjectId) return false;

    if (selectedGatewayId !== 'all') {
      const gw = gatewaysList.find(g => g.id === selectedGatewayId || g.name === selectedGatewayId);
      if (gw) {
        if (gw.bound_projects && gw.bound_projects.length > 0) {
          const isBound = gw.bound_projects.some((bp: any) => bp.id === p.id);
          if (!isBound) return false;
        }
      }
    }

    if (protocolFilter === 'https' && !isHttps) return false;
    if (protocolFilter === 'http' && isHttps) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = p.name?.toLowerCase().includes(q);
      const matchSlug = p.slug?.toLowerCase().includes(q);
      const matchServer = p.servers?.some((s: any) =>
        s.name?.toLowerCase().includes(q) || s.url?.toLowerCase().includes(q) || s.namespace_prefix?.toLowerCase().includes(q)
      );
      return matchName || matchSlug || matchServer;
    }
    return true;
  });

  // Calculate totals
  const totalServersCount = projects.reduce((acc, p) => acc + (p.servers?.length || 0), 0);
  const totalToolsCount = projects.reduce((acc, p) =>
    acc + (p.servers || []).reduce((sAcc: number, s: any) => sAcc + (s.tools_count || s.tool_count || (s.tool_policies ? s.tool_policies.length : 3)), 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header Banner */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span style={{ fontSize: '1.8rem' }}>🌐</span>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              Gateway Inbound &amp; MCP Endpoints
            </h2>
            <span className="badge badge-indigo" style={{ fontSize: '0.72rem' }}>
              Virtual MCP Hub
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
            Unified live entrypoints, Model Context Protocol routing tables, and security configurations per project.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={onRefresh}
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <span>🔄</span> Refresh Routes
          </button>
          <button
            onClick={() => onNavigateToCerts()}
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--accent-cyan)' }}
          >
            <span>🔒</span> TLS / Certs Hub
          </button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        <div className="glass-panel" style={{ padding: '18px 20px', borderLeft: '4px solid var(--accent-indigo)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Total Inbound Endpoints
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px' }}>
            {projects.length}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--accent-indigo)', marginTop: '4px' }}>
            Mapped under <code>/p/{'{slug}'}/mcp</code>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '18px 20px', borderLeft: '4px solid var(--accent-cyan)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Downstream MCP Upstreams
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent-cyan)', marginTop: '4px' }}>
            {totalServersCount}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginTop: '4px' }}>
            Aggregated into virtual tool catalogs
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '18px 20px', borderLeft: '4px solid var(--accent-emerald)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Exposed MCP Tools
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent-emerald)', marginTop: '4px' }}>
            {totalToolsCount}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginTop: '4px' }}>
            Protected by namespace boundaries
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '18px 20px', borderLeft: `4px solid ${isHttps ? '#10b981' : '#f59e0b'}` }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Active Listener Security
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <span style={{ fontSize: '1.5rem', fontWeight: 800, color: isHttps ? '#10b981' : '#f59e0b' }}>
              {isHttps ? 'HTTPS' : 'HTTP'}
            </span>
            <span className={`badge ${isHttps ? 'badge-emerald' : 'badge-amber'}`} style={{ fontSize: '0.7rem' }}>
              {isHttps ? 'TLS 1.3 Active' : 'Plaintext Listener'}
            </span>
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginTop: '4px' }}>
            Target Port: <code>:8080</code>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="glass-panel" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          {/* Search Input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '280px' }}>
            <span style={{ color: 'var(--text-muted)' }}>🔍</span>
            <input
              type="text"
              placeholder="Search endpoints by project name, slug, downstream URL, or tool..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field"
              style={{ flex: 1, padding: '8px 12px', fontSize: '0.85rem' }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="btn-secondary"
                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Protocol Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>Protocol:</span>
            {(['all', 'https', 'http'] as const).map((proto) => (
              <button
                key={proto}
                onClick={() => setProtocolFilter(proto)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: protocolFilter === proto ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                  background: protocolFilter === proto ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                  color: protocolFilter === proto ? 'var(--primary-text)' : 'var(--text-muted)',
                  transition: 'all 0.15s ease'
                }}
              >
                {proto === 'all' ? 'All' : proto === 'https' ? '🔒 HTTPS' : '🌐 HTTP'}
              </button>
            ))}
          </div>

          {/* Gateway Filter Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>Gateway:</span>
            <select
              value={selectedGatewayId}
              onChange={(e) => setSelectedGatewayId(e.target.value)}
              className="input-field"
              style={{
                width: 'auto',
                padding: '5px 10px',
                fontSize: '0.78rem',
                cursor: 'pointer'
              }}
            >
              <option value="all">⚡ All Fleet Gateways ({gatewaysList.length})</option>
              {gatewaysList.map(gw => (
                <option key={gw.id} value={gw.id}>
                  {gw.name} ({gw.bound_projects?.length ? `${gw.bound_projects.length} Targeted` : 'Global'})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Project Selector Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
            Project Filter:
          </span>
          <button
            onClick={() => setSelectedProjectId('all')}
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: selectedProjectId === 'all' ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
              background: selectedProjectId === 'all' ? 'var(--primary-subtle)' : 'var(--bg-surface)',
              color: selectedProjectId === 'all' ? 'var(--primary-text)' : 'var(--text-muted)'
            }}
          >
            All Projects ({projects.length})
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedProjectId(p.id)}
              style={{
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.76rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                border: selectedProjectId === p.id ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                background: selectedProjectId === p.id ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                color: selectedProjectId === p.id ? 'var(--primary-text)' : 'var(--text-muted)'
              }}
            >
              <span>{p.name}</span>
              <span style={{ fontSize: '0.68rem', color: 'var(--primary-text)', background: 'var(--bg-surface-subtle)', padding: '1px 5px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                /{p.slug}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Endpoints & MCP Servers Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {filteredProjects.length === 0 ? (
          <div className="glass-panel" style={{ padding: '60px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🔍</div>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--text-main)', marginBottom: '8px' }}>
              No Inbound Endpoints Match Filter
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Try adjusting your search query or selecting a different project scope.
            </p>
          </div>
        ) : (
          filteredProjects.map((p) => {
            const inboundEndpoint = `${baseUrl}/p/${p.slug}/mcp`;
            const discoveryEndpoint = `${baseUrl}/p/${p.slug}/.well-known/oauth-protected-resource`;
            const settings = p.settings || {};
            const inboundAuth = settings.inbound_auth || { mode: 'none' };
            const rateLimits = settings.rate_limits || { requests_per_minute: 600, burst: 50 };
            const circuitBreaker = settings.circuit_breaker || { max_failures: 5, recovery_seconds: 30 };
            const attachedServers = p.servers || [];
            const snippetTab = activeSnippetTab[p.id] || 'claude';
            const isToolsExpanded = expandedToolsProjectId === p.id;

            // Generate snippets
            const claudeSnippet = JSON.stringify({
              mcpServers: {
                [p.slug]: {
                  url: inboundEndpoint,
                  transport: 'http',
                  headers: inboundAuth.mode === 'api_key' ? { 'X-API-Key': 'YOUR_API_KEY_HERE' } : undefined,
                }
              }
            }, null, 2);

            const cursorSnippet = JSON.stringify({
              name: p.name,
              endpoint: inboundEndpoint,
              transport: 'sse',
              auth_type: inboundAuth.mode || 'none',
              auto_reconnect: true,
            }, null, 2);

            const curlSnippet = `curl -X POST "${inboundEndpoint}" \\
  -H "Content-Type: application/json" \\
  ${inboundAuth.mode === 'api_key' ? '-H "X-API-Key: YOUR_API_KEY" \\\n  ' : ''}${inboundAuth.mode === 'oauth_jwt' ? '-H "Authorization: Bearer YOUR_OAUTH_TOKEN" \\\n  ' : ''}-d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}'`;

            return (
              <div key={p.id} className="glass-panel" style={{ padding: '24px', position: 'relative' }}>
                {/* Project Header Bar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.2rem',
                      fontWeight: 700,
                      color: '#fff',
                      boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)'
                    }}>
                      📁
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                          {p.name}
                        </h3>
                        <span className={`badge ${p.status === 'active' ? 'badge-emerald' : 'badge-rose'}`}>
                          {p.status?.toUpperCase() || 'ACTIVE'}
                        </span>
                        <span className="badge badge-cyan" style={{ fontSize: '0.68rem' }}>
                          Config v{p.config_version || 1}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Namespace:</span>
                        <code style={{ fontSize: '0.78rem', color: 'var(--accent-cyan)' }}>/p/{p.slug}</code>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                        <span style={{ fontSize: '0.73rem', color: 'var(--text-dim)', fontWeight: 600 }}>Served by Gateway(s):</span>
                        {getHostingGateways(p.id).map(gw => (
                          <button
                            key={gw.id}
                            onClick={() => onInspectGateway(gw.id)}
                            style={{
                              background: 'rgba(99, 102, 241, 0.15)',
                              border: '1px solid rgba(99, 102, 241, 0.35)',
                              borderRadius: '4px',
                              padding: '2px 8px',
                              fontSize: '0.72rem',
                              color: '#c7d2fe',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px'
                            }}
                            title={`Click to inspect gateway "${gw.name}" in Gateway Fleet`}
                          >
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: gw.status === 'active' ? '#10b981' : '#f59e0b' }}></span>
                            <span>⚡ {gw.name}</span>
                            <span style={{ opacity: 0.7, fontSize: '0.65rem' }}>({gw.bound_projects?.length ? 'Targeted' : 'Global'})</span>
                          </button>
                        ))}
                        {getHostingGateways(p.id).length === 0 && (
                          <span style={{ fontSize: '0.72rem', color: '#f87171' }}>⚠️ No gateway serving this project</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      onClick={() => onNavigateToPolicies(p.id)}
                      className="btn-primary"
                      style={{ fontSize: '0.8rem', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <span>🛡️</span> Configure &amp; Enforce Policies
                    </button>
                    {activeGateway && (
                      <button
                        onClick={() => onInspectGateway(activeGateway.id)}
                        className="btn-secondary"
                        style={{ fontSize: '0.8rem', padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      >
                        <span>🔍</span> Inspect in Gateway Fleet
                      </button>
                    )}
                  </div>
                </div>

                {/* Gateway Inbound Endpoints Box */}
                <div style={{ background: 'var(--bg-surface-subtle)', borderRadius: 'var(--radius-md)', padding: '16px', border: '1px solid var(--border-subtle)', marginBottom: '20px' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Inbound Gateway Network Routes</span>
                    <span className="badge badge-emerald" style={{ fontSize: '0.68rem' }}>
                      ⚡ Low-Latency Gateway Route
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '14px' }}>
                    {/* Primary Virtual MCP Endpoint */}
                    <div style={{ background: 'var(--bg-surface)', padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--card-shadow)' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Virtual MCP Client Listener:</span>
                        <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>Streamable HTTP / SSE</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <code style={{ fontSize: '0.82rem', color: 'var(--primary-text)', background: 'var(--bg-surface-subtle)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {inboundEndpoint}
                        </code>
                        <button
                          onClick={() => copyToClipboard(inboundEndpoint, `in-${p.id}`)}
                          className="btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                          title="Copy MCP Endpoint URL"
                        >
                          {copiedKey === `in-${p.id}` ? '✓ Copied' : '📋 Copy'}
                        </button>
                      </div>
                    </div>

                    {/* OAuth Protected Resource Discovery */}
                    <div style={{ background: 'var(--bg-surface)', padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--card-shadow)' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>OAuth 2.1 Metadata Discovery:</span>
                        <span style={{ color: 'var(--accent-indigo)', fontWeight: 600 }}>RFC 8414 Protected</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <code style={{ fontSize: '0.82rem', color: 'var(--primary-text)', background: 'var(--bg-surface-subtle)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {discoveryEndpoint}
                        </code>
                        <button
                          onClick={() => copyToClipboard(discoveryEndpoint, `disc-${p.id}`)}
                          className="btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                          title="Copy Discovery URL"
                        >
                          {copiedKey === `disc-${p.id}` ? '✓ Copied' : '📋 Copy'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Security & Traffic Guardrails Summary */}
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '14px', fontSize: '0.76rem' }}>
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', padding: '4px 10px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: 'var(--text-dim)' }}>Inbound Auth:</span>
                      <strong style={{ color: inboundAuth.mode === 'none' ? 'var(--text-muted)' : 'var(--primary-text)' }}>
                        {inboundAuth.mode?.toUpperCase() || 'NONE'}
                      </strong>
                    </div>

                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', padding: '4px 10px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: 'var(--text-dim)' }}>Rate Limit:</span>
                      <strong style={{ color: 'var(--text-main)' }}>
                        {rateLimits.requests_per_minute || 600} req/min (Burst: {rateLimits.burst || 50})
                      </strong>
                    </div>

                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', padding: '4px 10px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: 'var(--text-dim)' }}>Circuit Breaker:</span>
                      <strong style={{ color: 'var(--text-main)' }}>
                        Trip on {circuitBreaker.max_failures || 5} fails ({circuitBreaker.recovery_seconds || 30}s recovery)
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Downstream MCP Clusters Attached */}
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1rem' }}>🔌</span>
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
                        Attached Downstream MCP Servers ({attachedServers.length})
                      </h4>
                    </div>
                    {attachedServers.length > 0 && (
                      <button
                        onClick={() => setExpandedToolsProjectId(isToolsExpanded ? null : p.id)}
                        className="btn-secondary"
                        style={{ fontSize: '0.75rem', padding: '3px 8px', color: 'var(--accent-cyan)' }}
                      >
                        {isToolsExpanded ? '▲ Hide Aggregated Tools' : '▼ View Aggregated Tools Catalog'}
                      </button>
                    )}
                  </div>

                  {attachedServers.length === 0 ? (
                    <div style={{ background: 'var(--bg-surface-subtle)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-subtle)', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.82rem' }}>
                      No downstream MCP servers attached to this project yet. AI clients connecting to this endpoint will see an empty tool catalog.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                      {attachedServers.map((s: any) => {
                        const isServerHttps = (s.url || '').toLowerCase().startsWith('https://');
                        return (
                          <div
                            key={s.id}
                            style={{
                              background: 'var(--bg-surface)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              boxShadow: 'var(--card-shadow)',
                              padding: '12px 14px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div className="pulse-dot" style={{ backgroundColor: s.health_status === 'healthy' ? '#10b981' : '#f59e0b', width: '8px', height: '8px' }}></div>
                                <strong style={{ fontSize: '0.86rem', color: 'var(--text-main)' }}>{s.name}</strong>
                              </div>
                              <span className={`badge ${isServerHttps ? 'badge-emerald' : 'badge-amber'}`} style={{ fontSize: '0.68rem', padding: '1px 5px' }}>
                                {isServerHttps ? '🔒 TLS' : '🌐 HTTP'}
                              </span>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--text-dim)' }}>
                              <span>Namespace Prefix:</span>
                              <code style={{ color: 'var(--primary-text)' }}>{s.namespace_prefix || 'root'}::</code>
                            </div>

                            <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              Target: <code style={{ color: 'var(--text-muted)' }}>{s.url}</code>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px', marginTop: '2px', fontSize: '0.72rem' }}>
                              <span style={{ color: 'var(--text-dim)' }}>Transport: {s.transport?.toUpperCase() || 'HTTP'}</span>
                              <span className="badge badge-indigo" style={{ fontSize: '0.65rem' }}>
                                {s.tools_count || s.tool_count || (s.tool_policies ? s.tool_policies.length : 3)} Tools
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Expanded Tools Catalog */}
                  {isToolsExpanded && (
                    <div style={{ marginTop: '14px', background: 'var(--bg-surface-subtle)', padding: '14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--primary-text)', marginBottom: '8px' }}>
                        Aggregated Tools Catalog for Endpoint:
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '8px', fontSize: '0.78rem' }}>
                        {attachedServers.flatMap((s: any) => {
                          const tools = s.tool_policies?.length > 0 ? s.tool_policies : [
                            { tool_name: `${s.namespace_prefix}_query`, enabled: true },
                            { tool_name: `${s.namespace_prefix}_execute`, enabled: true },
                            { tool_name: `${s.namespace_prefix}_describe`, enabled: true },
                          ];
                          return tools.map((tp: any, idx: number) => (
                            <div key={`${s.id}-${idx}`} style={{ background: 'var(--bg-surface)', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div>
                                <code style={{ color: 'var(--primary-text)', fontWeight: 600 }}>{tp.rename || tp.tool_name}</code>
                                {tp.rename && <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>from {tp.tool_name}</div>}
                              </div>
                              <span className={`badge ${tp.enabled !== false ? 'badge-emerald' : 'badge-rose'}`} style={{ fontSize: '0.65rem' }}>
                                {tp.enabled !== false ? '✓ Active' : '✕ Blocked'}
                              </span>
                            </div>
                          ));
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Interactive Client Connection Snippets */}
                <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-surface-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.85rem' }}>💻</span>
                      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-main)' }}>
                        Connect AI Agents &amp; MCP Clients:
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      {(['claude', 'cursor', 'curl'] as const).map((snip) => (
                        <button
                          key={snip}
                          onClick={() => setActiveSnippetTab({ ...activeSnippetTab, [p.id]: snip })}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            border: snippetTab === snip ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                            background: snippetTab === snip ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                            color: snippetTab === snip ? 'var(--primary-text)' : 'var(--text-muted)',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {snip === 'claude' ? 'Claude Desktop' : snip === 'cursor' ? 'Cursor / IDE' : 'cURL Command'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ padding: '12px', position: 'relative', background: 'var(--bg-surface-subtle)' }}>
                    <pre style={{ margin: 0, fontSize: '0.76rem', color: 'var(--primary-text)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', maxHeight: '140px', overflowY: 'auto' }}>
                      {snippetTab === 'claude' ? claudeSnippet : snippetTab === 'cursor' ? cursorSnippet : curlSnippet}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(
                        snippetTab === 'claude' ? claudeSnippet : snippetTab === 'cursor' ? cursorSnippet : curlSnippet,
                        `snip-${p.id}`
                      )}
                      className="btn-secondary"
                      style={{ position: 'absolute', top: '18px', right: '18px', fontSize: '0.7rem', padding: '3px 8px' }}
                    >
                      {copiedKey === `snip-${p.id}` ? '✓ Copied Config' : '📋 Copy Config'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
