// AI Gateway & Observability Platform - Console Application Bundle

(function() {
  'use strict';

  // State Management
  const state = {
    activeTab: 'topology',
    tenantId: 'tenant-1',
    authToken: '',
    topologyViewMode: 'configured',
    topologyDuration: '1h',
    selectedNode: null,
    selectedEdge: null,
    selectedTraceId: null,
    selectedSpan: null,
    targetLogTraceId: null,
    isAuthModalOpen: false,
    isMCPModalOpen: false,
    isAgentModalOpen: false,
    isPolicyModalOpen: false,
    inspectCard: null,
    expandedLogId: null,
    expandedAuditId: null,
    dryResult: null,
    healthResults: {},
    errorBanner: null,
  };

  // API Client Helper
  async function apiRequest(endpoint, options = {}) {
    const url = endpoint;
    const headers = new Headers(options.headers || {});
    headers.set('Content-Type', 'application/json');

    if (state.tenantId) {
      headers.set('X-Tenant-ID', state.tenantId);
    }
    if (state.authToken) {
      headers.set('Authorization', `Bearer ${state.authToken}`);
    }

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      let errMsg = `Request failed: HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson.error) errMsg = errJson.error;
      } catch {}
      throw new Error(errMsg);
    }
    return res.json();
  }

  // Global View Renderer
  async function render() {
    const root = document.getElementById('root');
    if (!root) return;

    let contentHtml = '';
    switch (state.activeTab) {
      case 'topology':
        contentHtml = await renderTopologyView();
        break;
      case 'metrics':
        contentHtml = await renderMetricsView();
        break;
      case 'mcp':
        contentHtml = await renderMCPServersView();
        break;
      case 'agents':
        contentHtml = await renderAgentsView();
        break;
      case 'traces':
        contentHtml = await renderTracesView();
        break;
      case 'logs':
        contentHtml = await renderLogsView();
        break;
      case 'tasks':
        contentHtml = await renderTasksView();
        break;
      case 'policies':
        contentHtml = await renderPoliciesView();
        break;
      case 'audit':
        contentHtml = await renderAuditView();
        break;
      default:
        contentHtml = await renderTopologyView();
    }

    root.innerHTML = `
      <div class="app-container">
        ${renderNavbar()}
        <main class="main-wrapper">
          ${state.errorBanner ? `<div class="alert-banner alert-error">${state.errorBanner} <button class="btn btn-secondary btn-sm" onclick="window.clearError()">✕</button></div>` : ''}
          ${contentHtml}
        </main>
        ${renderModals()}
      </div>
    `;

    bindEvents();
  }

  window.clearError = function() {
    state.errorBanner = null;
    render();
  };

  function renderNavbar() {
    const tabs = [
      { id: 'topology', label: 'Topology Graph', icon: '🌐' },
      { id: 'metrics', label: 'Metrics & KPIs', icon: '📊' },
      { id: 'mcp', label: 'MCP Servers', icon: '⚡' },
      { id: 'agents', label: 'A2A Agents', icon: '🤖' },
      { id: 'traces', label: 'Trace Waterfall', icon: '🔍' },
      { id: 'logs', label: 'Correlated Logs', icon: '📜' },
      { id: 'tasks', label: 'Tasks & Calls', icon: '📋' },
      { id: 'policies', label: 'Policies & RBAC', icon: '🛡️' },
      { id: 'audit', label: 'Security Audit', icon: '🔒' },
    ];

    return `
      <header class="header-bar">
        <div class="brand-section">
          <div class="brand-logo-icon">
            <span style="font-size: 1.2rem; color: #fff;">⚡</span>
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span class="brand-title">AI Gateway Console</span>
              <span class="brand-badge">v1.0.0</span>
            </div>
          </div>
        </div>

        <div class="nav-controls">
          <div style="display: flex; align-items: center; gap: 0.5rem; background: var(--bg-surface); padding: 0.35rem 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
            <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Tenant:</span>
            <select id="tenantSelect" style="background: transparent; border: none; color: var(--text-primary); font-size: 0.85rem; font-weight: 600; outline: none; cursor: pointer;">
              <option value="tenant-1" ${state.tenantId === 'tenant-1' ? 'selected' : ''}>tenant-1 (Primary)</option>
              <option value="tenant-2" ${state.tenantId === 'tenant-2' ? 'selected' : ''}>tenant-2 (Staging)</option>
              <option value="tenant-enterprise" ${state.tenantId === 'tenant-enterprise' ? 'selected' : ''}>tenant-enterprise</option>
            </select>
          </div>

          <button class="btn btn-secondary btn-sm" onclick="window.openAuthModal()">
            🔑 ${state.authToken ? 'Token Active' : 'Set Auth Token'}
          </button>

          <div style="display: flex; align-items: center; gap: 0.45rem; font-size: 0.8rem; color: var(--success);">
            <span class="pulse-dot"></span>
            <span style="font-weight: 600;">ONLINE</span>
          </div>
        </div>
      </header>

      <nav class="tabs-container">
        ${tabs.map(tab => `
          <button class="tab-btn ${state.activeTab === tab.id ? 'active' : ''}" onclick="window.switchTab('${tab.id}')">
            <span>${tab.icon}</span>
            <span>${tab.label}</span>
          </button>
        `).join('')}
      </nav>
    `;
  }

  // 1. Topology View
  async function renderTopologyView() {
    let nodes = [];
    let edges = [];
    let totalCalls = 0;
    let totalErrors = 0;

    try {
      if (state.topologyViewMode === 'configured') {
        const conf = await apiRequest('/api/v1/topology/configured');
        nodes = conf.nodes || [];
        edges = conf.edges || [];
      } else {
        const obs = await apiRequest(`/api/v1/topology/observed?duration=${state.topologyDuration}`);
        nodes = obs.nodes || [];
        edges = obs.edges || [];
        totalCalls = obs.total_calls || 0;
        totalErrors = obs.total_errors || 0;
      }
    } catch (e) {
      state.errorBanner = e.message;
    }

    // Node positioning layout
    const nodePositions = { gateway: { x: 480, y: 280 } };
    const clients = nodes.filter(n => n.type === 'client');
    const mcps = nodes.filter(n => n.type === 'mcp_server');
    const agents = nodes.filter(n => n.type === 'agent');
    const others = nodes.filter(n => !['gateway', 'client', 'mcp_server', 'agent'].includes(n.type));

    clients.forEach((n, i) => {
      nodePositions[n.id] = { x: 480 - ((clients.length - 1) * 160) / 2 + i * 160, y: 70 };
    });
    mcps.forEach((n, i) => {
      nodePositions[n.id] = { x: 140, y: 280 - ((mcps.length - 1) * 90) / 2 + i * 90 };
    });
    agents.forEach((n, i) => {
      nodePositions[n.id] = { x: 820, y: 280 - ((agents.length - 1) * 90) / 2 + i * 90 };
    });
    others.forEach((n, i) => {
      nodePositions[n.id] = { x: 480 - ((others.length - 1) * 160) / 2 + i * 160, y: 490 };
    });

    return `
      <div class="filter-bar">
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn ${state.topologyViewMode === 'configured' ? 'btn-primary' : 'btn-secondary'}" onclick="window.setTopologyMode('configured')">
            Configured Topology
          </button>
          <button class="btn ${state.topologyViewMode === 'observed' ? 'btn-primary' : 'btn-secondary'}" onclick="window.setTopologyMode('observed')">
            Observed Interactions (Telemetry)
          </button>
        </div>

        ${state.topologyViewMode === 'observed' ? `
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span style="font-size: 0.85rem; color: var(--text-muted);">Window:</span>
            <select class="form-select" style="width: auto; padding: 0.4rem 0.8rem;" onchange="window.setTopologyDuration(this.value)">
              <option value="15m" ${state.topologyDuration === '15m' ? 'selected' : ''}>Last 15 minutes</option>
              <option value="1h" ${state.topologyDuration === '1h' ? 'selected' : ''}>Last 1 hour</option>
              <option value="6h" ${state.topologyDuration === '6h' ? 'selected' : ''}>Last 6 hours</option>
              <option value="24h" ${state.topologyDuration === '24h' ? 'selected' : ''}>Last 24 hours</option>
              <option value="7d" ${state.topologyDuration === '7d' ? 'selected' : ''}>Last 7 days</option>
            </select>
          </div>
        ` : ''}

        <button class="btn btn-secondary btn-sm" onclick="window.refreshView()">Refresh Graph</button>
      </div>

      <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); padding: 0.75rem 1.25rem; border-radius: var(--radius-md); margin-bottom: 1.25rem; font-size: 0.85rem; color: var(--text-secondary); display: flex; justify-content: space-between;">
        <span>
          ${state.topologyViewMode === 'configured' 
            ? 'Static configured MCP servers, agents, and upstream routing bindings.' 
            : `Observed interactions aggregated from live spans for <strong>${state.tenantId}</strong>. Calls: <strong>${totalCalls}</strong> | Errors: <strong>${totalErrors}</strong>`}
        </span>
        <span style="font-size: 0.75rem; color: var(--text-muted);">Click any node or edge to inspect details</span>
      </div>

      <div style="display: grid; grid-template-columns: ${(state.selectedNode || state.selectedEdge) ? '1fr 340px' : '1fr'}; gap: 1.5rem;">
        <div class="glass-panel topology-canvas">
          <svg width="100%" height="100%" viewBox="0 0 960 580">
            <defs>
              <linearGradient id="edgeGradConfigured" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#6366f1" stop-opacity="0.8" />
                <stop offset="100%" stop-color="#06b6d4" stop-opacity="0.8" />
              </linearGradient>
              <linearGradient id="edgeGradObservedOk" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#10b981" stop-opacity="0.9" />
                <stop offset="100%" stop-color="#06b6d4" stop-opacity="0.9" />
              </linearGradient>
              <linearGradient id="edgeGradObservedErr" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#f43f5e" stop-opacity="0.9" />
                <stop offset="100%" stop-color="#fb7185" stop-opacity="0.9" />
              </linearGradient>
            </defs>

            ${edges.map(edge => {
              const src = nodePositions[edge.source] || nodePositions['gateway'];
              const tgt = nodePositions[edge.target] || nodePositions['gateway'];
              const dx = tgt.x - src.x;
              const pathD = `M ${src.x} ${src.y} C ${src.x + dx * 0.5} ${src.y}, ${src.x + dx * 0.5} ${tgt.y}, ${tgt.x} ${tgt.y}`;
              const hasErrors = edge.error_count > 0;
              const strokeColor = state.topologyViewMode === 'configured' ? 'url(#edgeGradConfigured)' : hasErrors ? 'url(#edgeGradObservedErr)' : 'url(#edgeGradObservedOk)';
              const strokeWidth = state.topologyViewMode === 'observed' ? Math.min(7, Math.max(2, Math.log2(edge.call_count + 1) * 2)) : 2.5;

              return `
                <g style="cursor: pointer;" onclick="window.selectEdge('${edge.id}')">
                  <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-dasharray="${state.topologyViewMode === 'observed' ? '6 3' : 'none'}" opacity="0.8" />
                  ${state.topologyViewMode === 'observed' && edge.call_count > 0 ? `
                    <g transform="translate(${(src.x + tgt.x)/2}, ${(src.y + tgt.y)/2})">
                      <rect x="-26" y="-10" width="52" height="20" rx="10" fill="${hasErrors ? '#f43f5e' : '#1e293b'}" stroke="rgba(255,255,255,0.2)" />
                      <text x="0" y="4" text-anchor="middle" fill="#fff" font-size="9" font-weight="700" font-family="var(--font-mono)">${edge.call_count} req</text>
                    </g>
                  ` : ''}
                </g>
              `;
            }).join('')}

            ${nodes.map(node => {
              const pos = nodePositions[node.id] || { x: 480, y: 280 };
              const isGateway = node.id === 'gateway';
              const strokeColor = node.status === 'HEALTHY' ? '#10b981' : node.status === 'DEGRADED' ? '#f59e0b' : node.status === 'UNHEALTHY' ? '#f43f5e' : '#64748b';

              return `
                <g transform="translate(${pos.x}, ${pos.y})" style="cursor: pointer;" onclick="window.selectNode('${node.id}')">
                  <circle r="${isGateway ? 42 : 30}" fill="${isGateway ? 'rgba(99, 102, 241, 0.25)' : 'rgba(15, 23, 42, 0.65)'}" stroke="${strokeColor}" stroke-width="2" />
                  <circle r="${isGateway ? 30 : 20}" fill="${isGateway ? '#6366f1' : '#1e293b'}" />
                  <text x="0" y="${isGateway ? 6 : 4}" text-anchor="middle" fill="#fff" font-size="${isGateway ? 14 : 11}" font-weight="700">
                    ${isGateway ? 'GW' : node.type === 'mcp_server' ? 'MCP' : node.type === 'agent' ? 'A2A' : 'CLI'}
                  </text>
                  <text x="0" y="${isGateway ? 58 : 46}" text-anchor="middle" fill="#f8fafc" font-size="12" font-weight="600">${node.label}</text>
                  <text x="0" y="${isGateway ? 72 : 60}" text-anchor="middle" fill="var(--text-muted)" font-size="10">${node.type}</text>
                </g>
              `;
            }).join('')}
          </svg>
        </div>

        ${(state.selectedNode || state.selectedEdge) ? `
          <div class="glass-panel" style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3 style="font-size: 1.05rem; font-weight: 600;">Inspector</h3>
              <button class="btn btn-secondary btn-sm" onclick="window.clearSelection()">✕</button>
            </div>
            ${state.selectedNode ? renderNodeInspector(state.selectedNode) : renderEdgeInspector(state.selectedEdge)}
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderNodeInspector(node) {
    return `
      <div>
        <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Node Label</div>
        <div style="font-size: 1.1rem; font-weight: 700; margin-top: 0.2rem;">${node.label}</div>
        <div class="code-pill" style="margin-top: 0.35rem; display: inline-block;">${node.id}</div>
      </div>
      <div>
        <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Status</div>
        <span class="badge badge-${(node.status || 'unknown').toLowerCase()}" style="margin-top: 0.35rem;">
          <span class="pulse-dot"></span> ${node.status || 'UNKNOWN'}
        </span>
      </div>
      ${node.metadata ? `
        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.35rem;">Metadata</div>
          <pre style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-family: var(--font-mono); max-height: 160px; overflow-y: auto;">${JSON.stringify(node.metadata, null, 2)}</pre>
        </div>
      ` : ''}
      ${state.topologyViewMode === 'observed' ? `
        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Traffic In Window</div>
          <div style="font-size: 1.2rem; font-weight: 700; color: var(--cyan);">${node.call_count} calls</div>
          ${node.error_count > 0 ? `<div style="color: var(--danger); font-size: 0.8rem;">${node.error_count} errors</div>` : ''}
        </div>
      ` : ''}
      <div style="margin-top: auto; display: flex; flex-direction: column; gap: 0.5rem;">
        ${node.type === 'mcp_server' ? `<button class="btn btn-primary btn-sm" onclick="window.switchTab('mcp')">Manage MCP Server →</button>` : ''}
        ${node.type === 'agent' ? `<button class="btn btn-primary btn-sm" onclick="window.switchTab('agents')">Manage Agent →</button>` : ''}
      </div>
    `;
  }

  function renderEdgeInspector(edge) {
    return `
      <div>
        <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Interaction Edge</div>
        <div style="font-weight: 600; margin-top: 0.35rem;">${edge.source} → ${edge.target}</div>
        <span class="code-pill" style="margin-top: 0.35rem; display: inline-block;">Protocol: ${(edge.protocol || 'HTTP').toUpperCase()}</span>
      </div>
      <div>
        <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Metrics</div>
        <div style="font-size: 1.1rem; font-weight: 700; color: var(--cyan); margin-top: 0.2rem;">${edge.call_count} requests</div>
        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">Avg Latency: ${edge.avg_latency_ms?.toFixed(2) || 0} ms</div>
        <div style="font-size: 0.8rem; color: var(--text-secondary);">p95 Latency: ${edge.p95_latency_ms?.toFixed(2) || 0} ms</div>
      </div>
      ${edge.sample_trace_ids && edge.sample_trace_ids.length > 0 ? `
        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.5rem;">Sample Traces</div>
          <div style="display: flex; flex-direction: column; gap: 0.35rem;">
            ${edge.sample_trace_ids.map(tid => `
              <button class="btn btn-secondary btn-sm" style="font-family: var(--font-mono); font-size: 0.75rem; justify-content: flex-start;" onclick="window.openTraceWaterfall('${tid}')">
                🔍 ${tid.substring(0, 16)}...
              </button>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;
  }

  // 2. Metrics View
  async function renderMetricsView() {
    let metrics = null;
    try {
      metrics = await apiRequest('/api/v1/metrics/summary?duration=24h');
    } catch (e) {
      state.errorBanner = e.message;
    }

    return `
      <div class="filter-bar">
        <div>
          <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 700;">Platform Operational Metrics</h2>
          <p style="color: var(--text-muted); font-size: 0.875rem;">Live operational metrics aggregated across gateway requests, MCP tool calls, and A2A tasks.</p>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="window.refreshView()">Refresh</button>
      </div>

      <div class="stats-grid" style="margin-top: 1.5rem;">
        <div class="glass-panel stat-card">
          <div class="stat-header"><span class="stat-label">Total Invocations</span><span>⚡</span></div>
          <div class="stat-value">${(metrics?.total_requests || 0).toLocaleString()}</div>
          <div class="stat-subtext" style="color: var(--cyan);">In past 24 hours</div>
        </div>

        <div class="glass-panel stat-card">
          <div class="stat-header"><span class="stat-label">Error Rate</span><span>⚠️</span></div>
          <div class="stat-value" style="color: ${(metrics?.error_rate_percent || 0) > 5 ? 'var(--danger)' : 'var(--text-primary)'};">
            ${(metrics?.error_rate_percent || 0).toFixed(2)}%
          </div>
          <div class="stat-subtext" style="color: ${(metrics?.total_errors || 0) > 0 ? 'var(--danger)' : 'var(--success)'};">
            ${metrics?.total_errors || 0} failed requests
          </div>
        </div>

        <div class="glass-panel stat-card">
          <div class="stat-header"><span class="stat-label">Avg / p95 Latency</span><span>⏱️</span></div>
          <div class="stat-value">${(metrics?.avg_latency_ms || 0).toFixed(1)} ms</div>
          <div class="stat-subtext" style="color: var(--text-muted);">p95: ${(metrics?.p95_latency_ms || 0).toFixed(1)} ms</div>
        </div>

        <div class="glass-panel stat-card">
          <div class="stat-header"><span class="stat-label">Active Targets</span><span>🤖</span></div>
          <div class="stat-value">${(metrics?.active_mcp_servers || 0) + (metrics?.active_agents || 0)}</div>
          <div class="stat-subtext">${metrics?.active_mcp_servers || 0} MCP servers • ${metrics?.active_agents || 0} agents</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(440px, 1fr)); gap: 1.5rem;">
        <div class="glass-panel" style="padding: 1.5rem;">
          <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 1.25rem;">Top Executed MCP Tools</h3>
          ${!metrics?.top_tools || Object.keys(metrics.top_tools).length === 0 ? `
            <div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No tool calls recorded in this window.</div>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 0.85rem;">
              ${Object.entries(metrics.top_tools).slice(0, 5).map(([tool, count]) => {
                const max = Math.max(...Object.values(metrics.top_tools));
                const pct = (count / (max || 1)) * 100;
                return `
                  <div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.35rem;">
                      <span class="code-pill">${tool}</span>
                      <span style="font-weight: 600; color: var(--cyan);">${count} calls</span>
                    </div>
                    <div style="height: 8px; background: rgba(255,255,255,0.06); border-radius: 4px; overflow: hidden;">
                      <div style="height: 100%; width: ${pct}%; background: linear-gradient(90deg, #6366f1, #06b6d4); border-radius: 4px;"></div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <div class="glass-panel" style="padding: 1.5rem;">
          <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 1.25rem;">A2A Task Status Distribution</h3>
          ${!metrics?.task_status_counts || Object.keys(metrics.task_status_counts).length === 0 ? `
            <div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No tasks recorded in this window.</div>
          ` : `
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;">
              ${Object.entries(metrics.task_status_counts).map(([status, count]) => `
                <div style="padding: 1rem; background: rgba(0,0,0,0.25); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                  <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">${status}</div>
                  <div style="font-size: 1.5rem; font-weight: 700; margin-top: 0.2rem;">${count}</div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  }

  // 3. MCP Servers View
  async function renderMCPServersView() {
    let servers = [];
    try {
      servers = await apiRequest('/api/v1/mcp-servers');
    } catch (e) {
      state.errorBanner = e.message;
    }

    return `
      <div class="filter-bar">
        <div>
          <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 700;">Upstream MCP Server Registry</h2>
          <p style="color: var(--text-muted); font-size: 0.875rem;">Register, aggregate, and inspect tools from distributed Model Context Protocol servers.</p>
        </div>
        <div style="display: flex; gap: 0.75rem;">
          <button class="btn btn-secondary btn-sm" onclick="window.refreshView()">Refresh</button>
          <button class="btn btn-primary" onclick="window.openMCPModal()">+ Register MCP Server</button>
        </div>
      </div>

      <div class="glass-panel" style="margin-top: 1.5rem;">
        ${servers.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">⚡</div>
            <div class="empty-state-title">No MCP Servers Configured</div>
            <div class="empty-state-desc">Register upstream MCP tool providers to expose aggregated tool catalogs through the gateway.</div>
            <button class="btn btn-primary" onclick="window.openMCPModal()">+ Register First Server</button>
          </div>
        ` : `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Server Name</th>
                  <th>Namespace</th>
                  <th>Transport</th>
                  <th>Endpoint / Command</th>
                  <th>Status</th>
                  <th>Probe Status</th>
                  <th style="text-align: right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${servers.map(s => {
                  const probe = state.healthResults[s.id];
                  return `
                    <tr>
                      <td>
                        <div style="font-weight: 600;">${s.name}</div>
                        <div class="mono" style="font-size: 0.75rem; color: var(--text-muted);">ID: ${s.id.substring(0, 8)}...</div>
                      </td>
                      <td><span class="code-pill">${s.namespace_prefix}::</span></td>
                      <td><span class="code-pill">${s.transport_type}</span></td>
                      <td style="max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.endpoint_url || s.command || '—'}</td>
                      <td>
                        <span class="badge badge-${(s.health_status || 'unknown').toLowerCase()}">
                          <span class="pulse-dot"></span> ${s.health_status}
                        </span>
                      </td>
                      <td>
                        ${probe ? `
                          <div style="font-size: 0.8rem;">
                            <span style="color: ${probe.health === 'HEALTHY' ? 'var(--success)' : 'var(--danger)'}; font-weight: 600;">${probe.health} (${probe.latency_ms?.toFixed(1)}ms)</span>
                            <div style="font-size: 0.75rem; color: var(--text-muted);">${probe.message}</div>
                          </div>
                        ` : '<span style="font-size: 0.8rem; color: var(--text-muted);">Not probed yet</span>'}
                      </td>
                      <td style="text-align: right;">
                        <div style="display: inline-flex; gap: 0.5rem;">
                          <button class="btn btn-secondary btn-sm" onclick="window.testMCPHealth('${s.id}')">Probe</button>
                          <button class="btn btn-danger btn-sm" onclick="window.deleteMCP('${s.id}', '${s.name}')">Remove</button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  // 4. A2A Agents View
  async function renderAgentsView() {
    let agents = [];
    try {
      agents = await apiRequest('/api/v1/agents');
    } catch (e) {
      state.errorBanner = e.message;
    }

    return `
      <div class="filter-bar">
        <div>
          <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 700;">Autonomous A2A Agent Registry</h2>
          <p style="color: var(--text-muted); font-size: 0.875rem;">Discover, route tasks, and stream lifecycle state across autonomous agents using the A2A protocol.</p>
        </div>
        <div style="display: flex; gap: 0.75rem;">
          <button class="btn btn-secondary btn-sm" onclick="window.refreshView()">Refresh</button>
          <button class="btn btn-primary" onclick="window.openAgentModal()">+ Register Agent</button>
        </div>
      </div>

      <div class="glass-panel" style="margin-top: 1.5rem;">
        ${agents.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">🤖</div>
            <div class="empty-state-title">No Agents Configured</div>
            <div class="empty-state-desc">Register autonomous agents exposing Agent Cards to handle tasks through the gateway.</div>
            <button class="btn btn-primary" onclick="window.openAgentModal()">+ Register First Agent</button>
          </div>
        ` : `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Agent Name</th>
                  <th>Capabilities</th>
                  <th>Endpoint URL</th>
                  <th>Status</th>
                  <th>Probe Status</th>
                  <th style="text-align: right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${agents.map(a => {
                  const probe = state.healthResults[a.id];
                  return `
                    <tr>
                      <td>
                        <div style="font-weight: 600;">${a.name}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${a.agent_card?.description || 'Autonomous Agent'}</div>
                      </td>
                      <td>
                        <div style="display: flex; flex-wrap: wrap; gap: 0.25rem; max-width: 240px;">
                          ${a.agent_card?.capabilities?.map(c => `<span class="code-pill" style="font-size: 0.7rem;">${c}</span>`).join('') || '—'}
                        </div>
                      </td>
                      <td class="mono" style="font-size: 0.8rem; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${a.endpoint_url}</td>
                      <td>
                        <span class="badge badge-${(a.health_status || 'unknown').toLowerCase()}">
                          <span class="pulse-dot"></span> ${a.health_status}
                        </span>
                      </td>
                      <td>
                        ${probe ? `
                          <div style="font-size: 0.8rem;">
                            <span style="color: ${probe.health === 'HEALTHY' ? 'var(--success)' : 'var(--danger)'}; font-weight: 600;">${probe.health} (${probe.latency_ms?.toFixed(1)}ms)</span>
                            <div style="font-size: 0.75rem; color: var(--text-muted);">${probe.message}</div>
                          </div>
                        ` : '<span style="font-size: 0.8rem; color: var(--text-muted);">Not probed yet</span>'}
                      </td>
                      <td style="text-align: right;">
                        <div style="display: inline-flex; gap: 0.5rem;">
                          <button class="btn btn-secondary btn-sm" onclick="window.testAgentHealth('${a.id}')">Probe</button>
                          <button class="btn btn-secondary btn-sm" onclick="window.inspectAgentCard('${encodeURIComponent(JSON.stringify(a.agent_card))}')">Card</button>
                          <button class="btn btn-danger btn-sm" onclick="window.deleteAgent('${a.id}', '${a.name}')">Delete</button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  // 5. Traces & Waterfall View
  async function renderTracesView() {
    let traces = [];
    let detail = null;
    try {
      traces = await apiRequest('/api/v1/traces');
      if (!state.selectedTraceId && traces && traces.length > 0) {
        state.selectedTraceId = traces[0].trace_id;
      }
      if (state.selectedTraceId) {
        detail = await apiRequest(`/api/v1/traces/${state.selectedTraceId}`);
      }
    } catch (e) {
      state.errorBanner = e.message;
    }

    let minStart = 0;
    let maxEnd = 0;
    let totalDurationMs = 1;

    if (detail?.spans && detail.spans.length > 0) {
      minStart = new Date(detail.spans[0].start_time).getTime();
      maxEnd = new Date(detail.spans[0].end_time).getTime();
      detail.spans.forEach(s => {
        const st = new Date(s.start_time).getTime();
        const et = new Date(s.end_time).getTime();
        if (st < minStart) minStart = st;
        if (et > maxEnd) maxEnd = et;
      });
      totalDurationMs = Math.max(1, maxEnd - minStart);
    }

    return `
      <div class="filter-bar">
        <div>
          <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 700;">Distributed Trace Waterfall</h2>
          <p style="color: var(--text-muted); font-size: 0.875rem;">Interactive Gantt timeline viewer with span attributes and correlated log linking.</p>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="window.refreshView()">Refresh Traces</button>
      </div>

      <div style="display: grid; grid-template-columns: 380px 1fr; gap: 1.5rem; margin-top: 1.5rem;">
        <div class="glass-panel" style="max-height: 720px; overflow-y: auto;">
          <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); font-weight: 600;">
            Trace Search Results (${traces.length})
          </div>
          ${traces.length === 0 ? `
            <div style="padding: 2.5rem; text-align: center; color: var(--text-muted);">No traces recorded yet for ${state.tenantId}.</div>
          ` : `
            <div>
              ${traces.map(t => {
                const isSelected = state.selectedTraceId === t.trace_id;
                const isErr = t.status_code === 'ERROR';
                return `
                  <div style="padding: 0.85rem 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.04); cursor: pointer; background: ${isSelected ? 'rgba(99, 102, 241, 0.12)' : 'transparent'}; border-left: ${isSelected ? '3px solid var(--primary)' : '3px solid transparent'};" onclick="window.selectTraceId('${t.trace_id}')">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span style="font-weight: 600; font-size: 0.9rem; color: ${isErr ? 'var(--danger)' : 'var(--text-primary)'};">${t.root_span_name}</span>
                      <span class="badge badge-${isErr ? 'unhealthy' : 'healthy'}">${t.status_code}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-top: 0.4rem; font-size: 0.75rem; color: var(--text-muted);">
                      <span class="mono">${t.trace_id.substring(0, 16)}...</span>
                      <span>${t.duration_ms.toFixed(1)} ms (${t.span_count} spans)</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <div class="glass-panel" style="padding: 1.5rem; max-height: 720px; overflow-y: auto;">
          ${!detail || !detail.spans || detail.spans.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state-title">Select a Trace</div>
              <div class="empty-state-desc">Select any trace from the left panel to inspect its waterfall Gantt chart and span hierarchy.</div>
            </div>
          ` : `
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-subtle);">
                <div>
                  <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Selected Trace ID</div>
                  <div style="font-size: 1.2rem; font-weight: 700; font-family: var(--font-mono); color: var(--cyan);">${detail.trace_id}</div>
                </div>
                <button class="btn btn-primary btn-sm" onclick="window.viewCorrelatedLogs('${detail.trace_id}')">
                  📜 View Correlated Logs
                </button>
              </div>

              <div style="display: grid; grid-template-columns: 240px 1fr 80px; gap: 1rem; padding: 0.4rem 1rem; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; border-bottom: 1px solid var(--border-subtle); margin-bottom: 0.5rem;">
                <div>Span Name / Kind</div>
                <div>Timeline (0 - ${totalDurationMs} ms)</div>
                <div style="text-align: right;">Duration</div>
              </div>

              <div class="waterfall-container">
                ${detail.spans.map(span => {
                  const sTime = new Date(span.start_time).getTime();
                  const offsetMs = Math.max(0, sTime - minStart);
                  const leftPercent = Math.min(100, Math.max(0, (offsetMs / totalDurationMs) * 100));
                  const widthPercent = Math.min(100 - leftPercent, Math.max(1.5, (span.duration_ms / totalDurationMs) * 100));
                  const isErr = span.status_code === 'ERROR';
                  const indent = span.parent_span_id ? '1.5rem' : '0rem';

                  return `
                    <div class="waterfall-row" onclick="window.selectSpan('${encodeURIComponent(JSON.stringify(span))}')">
                      <div style="padding-left: ${indent}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <span style="font-weight: 600; font-size: 0.85rem; color: ${isErr ? 'var(--danger)' : 'var(--text-primary)'};">${span.name}</span>
                        <div style="font-size: 0.7rem; color: var(--text-muted);">${span.kind} • <span class="mono">${span.span_id.substring(0, 8)}</span></div>
                      </div>
                      <div class="waterfall-bar-track">
                        <div class="waterfall-bar-fill ${isErr ? 'error' : ''}" style="left: ${leftPercent}%; width: ${widthPercent}%;"></div>
                      </div>
                      <div style="text-align: right; font-size: 0.8rem; font-weight: 600; font-family: var(--font-mono);">${span.duration_ms.toFixed(1)}ms</div>
                    </div>
                  `;
                }).join('')}
              </div>

              ${state.selectedSpan ? `
                <div style="margin-top: 1.5rem; padding: 1.25rem; background: rgba(0,0,0,0.25); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                    <div style="font-weight: 600; font-size: 0.95rem;">Span Attributes: <span class="code-pill">${state.selectedSpan.name}</span></div>
                    <span class="badge badge-${state.selectedSpan.status_code === 'ERROR' ? 'unhealthy' : 'healthy'}">${state.selectedSpan.status_code}</span>
                  </div>
                  <pre style="background: rgba(0,0,0,0.4); padding: 0.75rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-family: var(--font-mono); overflow-x: auto;">${JSON.stringify(state.selectedSpan.attributes || {}, null, 2)}</pre>
                </div>
              ` : ''}
            </div>
          `}
        </div>
      </div>
    `;
  }

  // 6. Correlated Logs View
  async function renderLogsView() {
    let logs = [];
    try {
      const q = state.targetLogTraceId ? `?trace_id=${encodeURIComponent(state.targetLogTraceId)}` : '';
      logs = await apiRequest(`/api/v1/logs${q}`);
    } catch (e) {
      state.errorBanner = e.message;
    }

    return `
      <div class="filter-bar">
        <div>
          <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 700;">Correlated Structured Logs</h2>
          <p style="color: var(--text-muted); font-size: 0.875rem;">Tenant-isolated structured logs correlated with distributed trace context.</p>
        </div>
        <div style="display: flex; gap: 0.75rem;">
          ${state.targetLogTraceId ? `
            <button class="btn btn-secondary btn-sm" onclick="window.clearTraceLogFilter()">Clear Filter (${state.targetLogTraceId.substring(0, 8)}...)</button>
          ` : ''}
          <button class="btn btn-secondary btn-sm" onclick="window.refreshView()">Refresh</button>
        </div>
      </div>

      <div class="glass-panel" style="margin-top: 1.5rem;">
        ${logs.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">📜</div>
            <div class="empty-state-title">No Logs Recorded</div>
            <div class="empty-state-desc">Application and gateway structured logs will appear here correlated with distributed traces.</div>
          </div>
        ` : `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 180px;">Timestamp</th>
                  <th style="width: 90px;">Severity</th>
                  <th>Message</th>
                  <th style="width: 180px;">Correlated Trace</th>
                  <th style="width: 70px; text-align: right;">Details</th>
                </tr>
              </thead>
              <tbody>
                ${logs.map(log => {
                  const isErr = log.severity === 'ERROR' || log.severity === 'FATAL';
                  const isExpanded = state.expandedLogId === log.id;
                  return `
                    <tr>
                      <td class="mono" style="font-size: 0.8rem;">${new Date(log.timestamp).toLocaleTimeString()}</td>
                      <td><span class="badge badge-${isErr ? 'unhealthy' : log.severity === 'WARN' ? 'degraded' : 'healthy'}" style="font-size: 0.7rem;">${log.severity}</span></td>
                      <td style="color: ${isErr ? '#fca5a5' : 'var(--text-primary)'}; word-break: break-word;">${log.message}</td>
                      <td>
                        ${log.trace_id ? `
                          <button class="btn btn-secondary btn-sm" style="font-family: var(--font-mono); font-size: 0.75rem; padding: 0.2rem 0.5rem;" onclick="window.openTraceWaterfall('${log.trace_id}')">
                            🔍 ${log.trace_id.substring(0, 10)}...
                          </button>
                        ` : '—'}
                      </td>
                      <td style="text-align: right;">
                        <button class="btn btn-secondary btn-sm" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="window.toggleLogExpand('${log.id}')">
                          ${isExpanded ? '▲' : '▼'}
                        </button>
                      </td>
                    </tr>
                    ${isExpanded ? `
                      <tr style="background: rgba(0,0,0,0.35);">
                        <td colspan="5" style="padding: 1rem 1.5rem;">
                          <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.4rem;">Structured Log Attributes</div>
                          <pre style="background: rgba(0,0,0,0.5); padding: 0.75rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-family: var(--font-mono);">${JSON.stringify(log.attributes || {}, null, 2)}</pre>
                        </td>
                      </tr>
                    ` : ''}
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  // 7. Tasks & Invocations View
  async function renderTasksView() {
    let tasks = [];
    let invocations = [];
    try {
      tasks = await apiRequest('/api/v1/a2a/tasks');
      invocations = await apiRequest('/api/v1/mcp/invocations?limit=25');
    } catch (e) {
      state.errorBanner = e.message;
    }

    return `
      <div class="filter-bar">
        <div>
          <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 700;">A2A Tasks & MCP Tool Invocations</h2>
          <p style="color: var(--text-muted); font-size: 0.875rem;">Inspect asynchronous agent task lifecycles and tool call executions.</p>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="window.refreshView()">Refresh</button>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1.5rem;">
        <div class="glass-panel" style="padding: 1.25rem;">
          <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 1rem;">A2A Tasks (${tasks.length})</h3>
          ${tasks.length === 0 ? `
            <div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No tasks submitted yet.</div>
          ` : `
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr><th>Task ID</th><th>Status</th><th>Target</th><th>Trace</th></tr>
                </thead>
                <tbody>
                  ${tasks.map(t => `
                    <tr>
                      <td class="mono" style="font-size: 0.8rem; color: var(--cyan);">${t.id.substring(0, 10)}...</td>
                      <td><span class="badge badge-${t.status === 'COMPLETED' ? 'healthy' : t.status === 'FAILED' ? 'unhealthy' : 'degraded'}">${t.status}</span></td>
                      <td class="mono" style="font-size: 0.75rem;">${t.target_agent_id?.substring(0, 8)}...</td>
                      <td>${t.trace_id ? `<button class="btn btn-secondary btn-sm" style="font-size: 0.7rem; padding: 0.2rem 0.4rem;" onclick="window.openTraceWaterfall('${t.trace_id}')">Trace</button>` : '—'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <div class="glass-panel" style="padding: 1.25rem;">
          <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 1rem;">Recent Tool Invocations (${invocations.length})</h3>
          ${invocations.length === 0 ? `
            <div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No tool calls recorded yet.</div>
          ` : `
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr><th>Tool Name</th><th>Server</th><th>Duration</th><th>Trace</th></tr>
                </thead>
                <tbody>
                  ${invocations.map(inv => `
                    <tr>
                      <td><span class="code-pill">${inv.tool_name}</span></td>
                      <td style="font-size: 0.8rem;">${inv.server_name}</td>
                      <td class="mono" style="font-size: 0.8rem;">${inv.duration_ms.toFixed(1)}ms</td>
                      <td>${inv.trace_id ? `<button class="btn btn-secondary btn-sm" style="font-size: 0.7rem; padding: 0.2rem 0.4rem;" onclick="window.openTraceWaterfall('${inv.trace_id}')">Trace</button>` : '—'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;
  }

  // 8. Policies & Dry-Run View
  async function renderPoliciesView() {
    let policies = [];
    try {
      policies = await apiRequest('/api/v1/policies');
    } catch (e) {
      state.errorBanner = e.message;
    }

    return `
      <div class="filter-bar">
        <div>
          <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 700;">Tenant Authorization & RBAC Policies</h2>
          <p style="color: var(--text-muted); font-size: 0.875rem;">Fine-grained access control rules and interactive dry-run decision simulator.</p>
        </div>
        <div style="display: flex; gap: 0.75rem;">
          <button class="btn btn-secondary btn-sm" onclick="window.refreshView()">Refresh</button>
          <button class="btn btn-primary" onclick="window.openPolicyModal()">+ Add Policy Rule</button>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 380px; gap: 1.5rem; margin-top: 1.5rem;">
        <div class="glass-panel">
          <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle); font-weight: 600;">
            Configured Policies (${policies.length})
          </div>
          ${policies.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state-icon">🛡️</div>
              <div class="empty-state-title">No Policies Defined</div>
              <div class="empty-state-desc">By default, unauthorized requests are denied. Create an ALLOW rule to grant access.</div>
              <button class="btn btn-primary" onclick="window.openPolicyModal()">+ Add Allow Rule</button>
            </div>
          ` : `
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr><th>Rule Name</th><th>Effect</th><th>Actions</th><th>Resources</th><th>Roles</th><th style="text-align: right;">Action</th></tr>
                </thead>
                <tbody>
                  ${policies.map(p => `
                    <tr>
                      <td>
                        <div style="font-weight: 600;">${p.name}</div>
                        <div class="mono" style="font-size: 0.75rem; color: var(--text-muted);">${p.id}</div>
                      </td>
                      <td><span class="badge badge-${p.effect === 'ALLOW' ? 'healthy' : 'unhealthy'}">${p.effect}</span></td>
                      <td>${p.actions.map(a => `<span class="code-pill" style="font-size: 0.7rem; margin-right: 0.2rem;">${a}</span>`).join('')}</td>
                      <td>${p.resources.map(r => `<span class="code-pill" style="font-size: 0.7rem; margin-right: 0.2rem;">${r}</span>`).join('')}</td>
                      <td style="font-size: 0.8rem;">${p.roles && p.roles.length > 0 ? p.roles.join(', ') : 'Any'}</td>
                      <td style="text-align: right;">
                        <button class="btn btn-danger btn-sm" onclick="window.deletePolicy('${p.id}', '${p.name}')">Delete</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <div class="glass-panel" style="padding: 1.5rem; display: flex; flex-direction: column;">
          <h3 style="font-size: 1.05rem; font-weight: 600; margin-bottom: 0.35rem;">⚡ Policy Dry-Run Simulator</h3>
          <p style="color: var(--text-muted); font-size: 0.8rem; margin-bottom: 1.25rem;">Test authorization decisions before committing changes.</p>

          <form onsubmit="window.handleDryRun(event)" style="display: flex; flex-direction: column; gap: 0.85rem;">
            <div>
              <label class="form-label" style="font-size: 0.75rem;">Subject</label>
              <input type="text" id="drySubject" class="form-input" required value="alice" />
            </div>
            <div>
              <label class="form-label" style="font-size: 0.75rem;">Roles (comma separated)</label>
              <input type="text" id="dryRoles" class="form-input" value="tool-consumer" />
            </div>
            <div>
              <label class="form-label" style="font-size: 0.75rem;">Action</label>
              <input type="text" id="dryAction" class="form-input" required value="mcp:tools:call" />
            </div>
            <div>
              <label class="form-label" style="font-size: 0.75rem;">Resource URI</label>
              <input type="text" id="dryResource" class="form-input" required value="github::create_issue" />
            </div>
            <button type="submit" class="btn btn-primary btn-sm" style="margin-top: 0.5rem;">Evaluate Access →</button>
          </form>

          ${state.dryResult ? `
            <div style="margin-top: 1.25rem; padding: 1rem; border-radius: var(--radius-md); background: ${state.dryResult.decision === 'ALLOW' ? 'var(--success-bg)' : 'var(--danger-bg)'}; border: 1px solid ${state.dryResult.decision === 'ALLOW' ? 'var(--success-border)' : 'var(--danger-border)'};">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 700; font-size: 1.05rem; color: ${state.dryResult.decision === 'ALLOW' ? 'var(--success)' : 'var(--danger)'};">
                  ${state.dryResult.decision === 'ALLOW' ? '✓ ACCESS GRANTED' : '✕ ACCESS DENIED'}
                </span>
                <span class="badge badge-${state.dryResult.decision === 'ALLOW' ? 'healthy' : 'unhealthy'}">${state.dryResult.decision}</span>
              </div>
              <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.4rem;">${state.dryResult.evaluation_reason}</div>
              ${state.dryResult.matched_rule_name ? `
                <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.4rem;">Matching Rule: <strong>${state.dryResult.matched_rule_name}</strong></div>
              ` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  // 9. Audit View
  async function renderAuditView() {
    let events = [];
    try {
      events = await apiRequest('/api/v1/audit');
    } catch (e) {
      state.errorBanner = e.message;
    }

    return `
      <div class="filter-bar">
        <div>
          <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 700;">Security & Administrative Audit Trail</h2>
          <p style="color: var(--text-muted); font-size: 0.875rem;">Immutable chronological record of policy changes and administrative operations.</p>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="window.refreshView()">Refresh</button>
      </div>

      <div class="glass-panel" style="margin-top: 1.5rem;">
        ${events.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">🔒</div>
            <div class="empty-state-title">No Audit Events Logged</div>
            <div class="empty-state-desc">Administrative changes and security events will be automatically recorded here.</div>
          </div>
        ` : `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Resource</th><th>Outcome</th><th>IP Address</th><th style="text-align: right;">Details</th></tr>
              </thead>
              <tbody>
                ${events.map(ev => {
                  const isSuccess = ev.outcome === 'SUCCESS';
                  const isExpanded = state.expandedAuditId === ev.id;
                  return `
                    <tr>
                      <td class="mono" style="font-size: 0.8rem;">${new Date(ev.timestamp).toLocaleString()}</td>
                      <td>
                        <div style="font-weight: 600;">${ev.actor_id}</div>
                        <div style="font-size: 0.7rem; color: var(--text-muted);">${ev.actor_type}</div>
                      </td>
                      <td><span class="code-pill">${ev.action}</span></td>
                      <td class="mono" style="font-size: 0.8rem;">${ev.resource_id ? `${ev.resource_id.substring(0, 10)}...` : '—'}</td>
                      <td><span class="badge badge-${isSuccess ? 'healthy' : 'unhealthy'}">${ev.outcome}</span></td>
                      <td class="mono" style="font-size: 0.8rem; color: var(--text-muted);">${ev.client_ip || '—'}</td>
                      <td style="text-align: right;">
                        ${ev.metadata ? `<button class="btn btn-secondary btn-sm" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="window.toggleAuditExpand('${ev.id}')">${isExpanded ? '▲' : '▼'}</button>` : ''}
                      </td>
                    </tr>
                    ${isExpanded && ev.metadata ? `
                      <tr style="background: rgba(0,0,0,0.35);">
                        <td colspan="7" style="padding: 1rem 1.5rem;">
                          <pre style="background: rgba(0,0,0,0.5); padding: 0.75rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-family: var(--font-mono);">${JSON.stringify(ev.metadata, null, 2)}</pre>
                        </td>
                      </tr>
                    ` : ''}
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  // Modals renderer
  function renderModals() {
    return `
      ${state.isAuthModalOpen ? `
        <div class="modal-backdrop" onclick="window.closeAuthModal()">
          <div class="modal-content" onclick="event.stopPropagation()">
            <div class="modal-header">
              <div class="modal-title">Administrative Bearer Credentials</div>
              <button class="btn btn-secondary btn-sm" onclick="window.closeAuthModal()">✕</button>
            </div>
            <form onsubmit="window.saveAuthToken(event)">
              <div class="modal-body">
                <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1rem;">
                  Inject an authorization bearer token (JWT or API Key) into management requests for role verification.
                </p>
                <div class="form-group">
                  <label class="form-label">Bearer Token</label>
                  <input type="password" id="authTokenInput" class="form-input" placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." value="${state.authToken}" />
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onclick="window.clearAuthToken()">Clear</button>
                <button type="submit" class="btn btn-primary">Save Credentials</button>
              </div>
            </form>
          </div>
        </div>
      ` : ''}

      ${state.isMCPModalOpen ? `
        <div class="modal-backdrop" onclick="window.closeMCPModal()">
          <div class="modal-content" onclick="event.stopPropagation()">
            <div class="modal-header">
              <div class="modal-title">Register Upstream MCP Server</div>
              <button class="btn btn-secondary btn-sm" onclick="window.closeMCPModal()">✕</button>
            </div>
            <form onsubmit="window.handleCreateMCP(event)">
              <div class="modal-body">
                <div class="form-group">
                  <label class="form-label">Server Name</label>
                  <input type="text" id="mcpName" class="form-input" required placeholder="github" />
                </div>
                <div class="form-group">
                  <label class="form-label">Namespace Prefix</label>
                  <input type="text" id="mcpNamespace" class="form-input" placeholder="github" />
                </div>
                <div class="form-group">
                  <label class="form-label">Transport Type</label>
                  <select id="mcpTransport" class="form-select">
                    <option value="SSE">Server-Sent Events (SSE)</option>
                    <option value="HTTP_POST">Streamlined HTTP Post</option>
                    <option value="STDIO">Local STDIO Command</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Endpoint URL</label>
                  <input type="url" id="mcpUrl" class="form-input" placeholder="http://localhost:8081/sse" />
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onclick="window.closeMCPModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Register Server</button>
              </div>
            </form>
          </div>
        </div>
      ` : ''}

      ${state.isAgentModalOpen ? `
        <div class="modal-backdrop" onclick="window.closeAgentModal()">
          <div class="modal-content" onclick="event.stopPropagation()">
            <div class="modal-header">
              <div class="modal-title">Register Autonomous Agent</div>
              <button class="btn btn-secondary btn-sm" onclick="window.closeAgentModal()">✕</button>
            </div>
            <form onsubmit="window.handleCreateAgent(event)">
              <div class="modal-body">
                <div class="form-group">
                  <label class="form-label">Agent Name</label>
                  <input type="text" id="agentName" class="form-input" required placeholder="researcher" />
                </div>
                <div class="form-group">
                  <label class="form-label">Endpoint URL</label>
                  <input type="url" id="agentUrl" class="form-input" required placeholder="http://localhost:8082" />
                </div>
                <div class="form-group">
                  <label class="form-label">Agent Card Description</label>
                  <input type="text" id="agentDesc" class="form-input" placeholder="Autonomous reasoning agent" />
                </div>
                <div class="form-group">
                  <label class="form-label">Capabilities (comma separated)</label>
                  <input type="text" id="agentCaps" class="form-input" value="planning, analysis, execution" />
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onclick="window.closeAgentModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Register Agent</button>
              </div>
            </form>
          </div>
        </div>
      ` : ''}

      ${state.isPolicyModalOpen ? `
        <div class="modal-backdrop" onclick="window.closePolicyModal()">
          <div class="modal-content" onclick="event.stopPropagation()">
            <div class="modal-header">
              <div class="modal-title">Add Authorization Rule</div>
              <button class="btn btn-secondary btn-sm" onclick="window.closePolicyModal()">✕</button>
            </div>
            <form onsubmit="window.handleCreatePolicy(event)">
              <div class="modal-body">
                <div class="form-group">
                  <label class="form-label">Rule Name</label>
                  <input type="text" id="polName" class="form-input" required placeholder="Allow Tool Consumers" />
                </div>
                <div class="form-group">
                  <label class="form-label">Effect</label>
                  <select id="polEffect" class="form-select">
                    <option value="ALLOW">ALLOW</option>
                    <option value="DENY">DENY</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Actions (comma separated)</label>
                  <input type="text" id="polActions" class="form-input" required value="mcp:tools:call" />
                </div>
                <div class="form-group">
                  <label class="form-label">Resources (comma separated)</label>
                  <input type="text" id="polResources" class="form-input" required value="*" />
                </div>
                <div class="form-group">
                  <label class="form-label">Roles (comma separated)</label>
                  <input type="text" id="polRoles" class="form-input" value="tool-consumer" />
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onclick="window.closePolicyModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Create Rule</button>
              </div>
            </form>
          </div>
        </div>
      ` : ''}

      ${state.inspectCard ? `
        <div class="modal-backdrop" onclick="window.closeInspectCard()">
          <div class="modal-content" onclick="event.stopPropagation()">
            <div class="modal-header">
              <div class="modal-title">Agent Card (ADR-0003)</div>
              <button class="btn btn-secondary btn-sm" onclick="window.closeInspectCard()">✕</button>
            </div>
            <div class="modal-body">
              <pre style="background: rgba(0,0,0,0.5); padding: 1rem; border-radius: var(--radius-md); font-size: 0.8rem; font-family: var(--font-mono);">${JSON.stringify(state.inspectCard, null, 2)}</pre>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" onclick="window.closeInspectCard()">Close</button>
            </div>
          </div>
        </div>
      ` : ''}
    `;
  }

  // Event handlers exposed to window
  function bindEvents() {
    const tenantSelect = document.getElementById('tenantSelect');
    if (tenantSelect) {
      tenantSelect.onchange = (e) => {
        state.tenantId = e.target.value;
        render();
      };
    }
  }

  window.switchTab = function(tabId) {
    state.activeTab = tabId;
    state.selectedNode = null;
    state.selectedEdge = null;
    state.errorBanner = null;
    render();
  };

  window.setTopologyMode = function(mode) {
    state.topologyViewMode = mode;
    state.selectedNode = null;
    state.selectedEdge = null;
    render();
  };

  window.setTopologyDuration = function(dur) {
    state.topologyDuration = dur;
    render();
  };

  window.refreshView = function() {
    render();
  };

  window.selectNode = async function(id) {
    try {
      if (state.topologyViewMode === 'configured') {
        const conf = await apiRequest('/api/v1/topology/configured');
        state.selectedNode = conf.nodes.find(n => n.id === id);
      } else {
        const obs = await apiRequest(`/api/v1/topology/observed?duration=${state.topologyDuration}`);
        state.selectedNode = obs.nodes.find(n => n.id === id);
      }
      state.selectedEdge = null;
      render();
    } catch (e) {
      state.errorBanner = e.message;
    }
  };

  window.selectEdge = async function(id) {
    try {
      if (state.topologyViewMode === 'configured') {
        const conf = await apiRequest('/api/v1/topology/configured');
        state.selectedEdge = conf.edges.find(e => e.id === id);
      } else {
        const obs = await apiRequest(`/api/v1/topology/observed?duration=${state.topologyDuration}`);
        state.selectedEdge = obs.edges.find(e => e.id === id);
      }
      state.selectedNode = null;
      render();
    } catch (e) {
      state.errorBanner = e.message;
    }
  };

  window.clearSelection = function() {
    state.selectedNode = null;
    state.selectedEdge = null;
    render();
  };

  window.selectTraceId = function(traceId) {
    state.selectedTraceId = traceId;
    render();
  };

  window.selectSpan = function(encoded) {
    try {
      state.selectedSpan = JSON.parse(decodeURIComponent(encoded));
      render();
    } catch {}
  };

  window.openTraceWaterfall = function(traceId) {
    state.selectedTraceId = traceId;
    state.activeTab = 'traces';
    render();
  };

  window.viewCorrelatedLogs = function(traceId) {
    state.targetLogTraceId = traceId;
    state.activeTab = 'logs';
    render();
  };

  window.clearTraceLogFilter = function() {
    state.targetLogTraceId = null;
    render();
  };

  window.toggleLogExpand = function(id) {
    state.expandedLogId = state.expandedLogId === id ? null : id;
    render();
  };

  window.toggleAuditExpand = function(id) {
    state.expandedAuditId = state.expandedAuditId === id ? null : id;
    render();
  };

  window.openAuthModal = function() {
    state.isAuthModalOpen = true;
    render();
  };
  window.closeAuthModal = function() {
    state.isAuthModalOpen = false;
    render();
  };
  window.saveAuthToken = function(e) {
    e.preventDefault();
    state.authToken = document.getElementById('authTokenInput').value;
    state.isAuthModalOpen = false;
    render();
  };
  window.clearAuthToken = function() {
    state.authToken = '';
    state.isAuthModalOpen = false;
    render();
  };

  window.openMCPModal = function() { state.isMCPModalOpen = true; render(); };
  window.closeMCPModal = function() { state.isMCPModalOpen = false; render(); };
  window.handleCreateMCP = async function(e) {
    e.preventDefault();
    try {
      await apiRequest('/api/v1/mcp-servers', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('mcpName').value,
          namespace_prefix: document.getElementById('mcpNamespace').value || document.getElementById('mcpName').value,
          transport_type: document.getElementById('mcpTransport').value,
          endpoint_url: document.getElementById('mcpUrl').value,
        }),
      });
      state.isMCPModalOpen = false;
      render();
    } catch (err) {
      state.errorBanner = err.message;
      render();
    }
  };

  window.testMCPHealth = async function(id) {
    try {
      const res = await apiRequest(`/api/v1/mcp-servers/${encodeURIComponent(id)}/health`, { method: 'POST' });
      state.healthResults[id] = res;
      render();
    } catch (err) {
      state.healthResults[id] = { health: 'UNHEALTHY', message: err.message, latency_ms: 0 };
      render();
    }
  };

  window.deleteMCP = async function(id, name) {
    if (!confirm(`Delete MCP server "${name}"?`)) return;
    try {
      await apiRequest(`/api/v1/mcp-servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      render();
    } catch (err) {
      state.errorBanner = err.message;
      render();
    }
  };

  window.openAgentModal = function() { state.isAgentModalOpen = true; render(); };
  window.closeAgentModal = function() { state.isAgentModalOpen = false; render(); };
  window.handleCreateAgent = async function(e) {
    e.preventDefault();
    try {
      const name = document.getElementById('agentName').value;
      const caps = document.getElementById('agentCaps').value.split(',').map(s => s.trim()).filter(Boolean);
      await apiRequest('/api/v1/agents', {
        method: 'POST',
        body: JSON.stringify({
          name,
          endpoint_url: document.getElementById('agentUrl').value,
          agent_card: {
            name,
            description: document.getElementById('agentDesc').value,
            version: '1.0.0',
            protocol_version: 'a2a/v1',
            capabilities: caps.length > 0 ? caps : ['general'],
          },
        }),
      });
      state.isAgentModalOpen = false;
      render();
    } catch (err) {
      state.errorBanner = err.message;
      render();
    }
  };

  window.testAgentHealth = async function(id) {
    try {
      const res = await apiRequest(`/api/v1/agents/${encodeURIComponent(id)}/health`, { method: 'POST' });
      state.healthResults[id] = res;
      render();
    } catch (err) {
      state.healthResults[id] = { health: 'UNHEALTHY', message: err.message, latency_ms: 0 };
      render();
    }
  };

  window.inspectAgentCard = function(encoded) {
    try {
      state.inspectCard = JSON.parse(decodeURIComponent(encoded));
      render();
    } catch {}
  };
  window.closeInspectCard = function() {
    state.inspectCard = null;
    render();
  };

  window.deleteAgent = async function(id, name) {
    if (!confirm(`Delete autonomous agent "${name}"?`)) return;
    try {
      await apiRequest(`/api/v1/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
      render();
    } catch (err) {
      state.errorBanner = err.message;
      render();
    }
  };

  window.openPolicyModal = function() { state.isPolicyModalOpen = true; render(); };
  window.closePolicyModal = function() { state.isPolicyModalOpen = false; render(); };
  window.handleCreatePolicy = async function(e) {
    e.preventDefault();
    try {
      await apiRequest('/api/v1/policies', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('polName').value,
          effect: document.getElementById('polEffect').value,
          actions: document.getElementById('polActions').value.split(',').map(s => s.trim()).filter(Boolean),
          resources: document.getElementById('polResources').value.split(',').map(s => s.trim()).filter(Boolean),
          roles: document.getElementById('polRoles').value.split(',').map(s => s.trim()).filter(Boolean),
        }),
      });
      state.isPolicyModalOpen = false;
      render();
    } catch (err) {
      state.errorBanner = err.message;
      render();
    }
  };

  window.deletePolicy = async function(id, name) {
    if (!confirm(`Delete authorization rule "${name}"?`)) return;
    try {
      await apiRequest(`/api/v1/policies/${encodeURIComponent(id)}`, { method: 'DELETE' });
      render();
    } catch (err) {
      state.errorBanner = err.message;
      render();
    }
  };

  window.handleDryRun = async function(e) {
    e.preventDefault();
    try {
      const res = await apiRequest('/api/v1/policies/dry-run', {
        method: 'POST',
        body: JSON.stringify({
          subject: document.getElementById('drySubject').value,
          roles: document.getElementById('dryRoles').value.split(',').map(s => s.trim()).filter(Boolean),
          action: document.getElementById('dryAction').value,
          resource: document.getElementById('dryResource').value,
        }),
      });
      state.dryResult = res;
      render();
    } catch (err) {
      state.errorBanner = err.message;
      render();
    }
  };

  // Initial render on DOM load
  document.addEventListener('DOMContentLoaded', () => {
    render();
  });
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    render();
  }
})();
