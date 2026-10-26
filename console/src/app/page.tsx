'use client';

import React, { useState, useEffect } from 'react';
import InboundEndpointsView from './components/InboundEndpointsView';
import ProjectPoliciesView from './components/ProjectPoliciesView';
import CertificatesSettingsView from './components/CertificatesSettingsView';
import OAuthSecretsView from './components/OAuthSecretsView';

interface User {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  role: string;
}

interface Org {
  id: string;
  name: string;
  slug: string;
}

interface Project {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  status: string;
  settings: Record<string, any>;
  config_version: number;
  server_count?: number;
  servers?: any[];
  created_at: string;
}

interface MCPServer {
  id: string;
  project_id: string;
  name: string;
  namespace_prefix: string;
  transport: string;
  url: string;
  auth_type: string;
  timeouts: { dial_ms: number; call_ms: number };
  enabled: boolean;
  health_status: string;
  last_checked_at: string | null;
  tools_count?: number;
}

interface DiscoveredTool {
  id?: string;
  name: string;
  virtual_name: string;
  description: string;
  inputSchema: any;
  enabled: boolean;
  rename?: string | null;
  server_id: string;
  server_name: string;
  namespace_prefix: string;
}

export default function ConsoleDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<string>('projects');

  // Auth Form State
  const [email, setEmail] = useState<string>('admin@aigateway.local');
  const [password, setPassword] = useState<string>('Admin123!@#');
  const [loginError, setLoginError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Projects State
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [showNewProjectModal, setShowNewProjectModal] = useState<boolean>(false);
  const [newProjectName, setNewProjectName] = useState<string>('');
  const [newProjectSlug, setNewProjectSlug] = useState<string>('');
  const [newProjectGatewayId, setNewProjectGatewayId] = useState<string>('');
  const [projectActionLoading, setProjectActionLoading] = useState<boolean>(false);

  // MCP Servers State
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [showNewServerModal, setShowNewServerModal] = useState<boolean>(false);
  const [newServerName, setNewServerName] = useState<string>('');
  const [newServerPrefix, setNewServerPrefix] = useState<string>('');
  const [newServerUrl, setNewServerUrl] = useState<string>('');
  const [newServerTransport, setNewServerTransport] = useState<string>('http');
  const [serverActionLoading, setServerActionLoading] = useState<boolean>(false);

  // Test & Discovery State
  const [testResults, setTestResults] = useState<Record<string, { status: string; latency_ms: number; message: string }>>({});
  const [testingServerId, setTestingServerId] = useState<string | null>(null);
  const [discoveringServerId, setDiscoveringServerId] = useState<string | null>(null);
  const [discoveredTools, setDiscoveredTools] = useState<DiscoveredTool[]>([]);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Gateways State
  const [gatewaysList, setGatewaysList] = useState<any[]>([]);
  const [showNewGatewayModal, setShowNewGatewayModal] = useState<boolean>(false);
  const [newGatewayName, setNewGatewayName] = useState<string>('');
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [gatewayActionLoading, setGatewayActionLoading] = useState<boolean>(false);

  // Gateway Deep Inspector State
  const [inspectingGatewayId, setInspectingGatewayId] = useState<string | null>(null);
  const [inspectingGatewayData, setInspectingGatewayData] = useState<any | null>(null);
  const [inspectionLoading, setInspectionLoading] = useState<boolean>(false);
  const [inspectionTab, setInspectionTab] = useState<'endpoints' | 'downstreams' | 'policies' | 'tls'>('endpoints');
  const [inspectSearchQuery, setInspectSearchQuery] = useState<string>('');
  const [inspectSelectedProjectId, setInspectSelectedProjectId] = useState<string>('');
  const [inspectViewMode, setInspectViewMode] = useState<'cards' | 'table'>('table');
  const [inspectProtocolFilter, setInspectProtocolFilter] = useState<'all' | 'https' | 'http'>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Logs & Telemetry State
  const [logs, setLogs] = useState<any[]>([]);
  const [logsTotal, setLogsTotal] = useState<number>(0);
  const [logsLoading, setLogsLoading] = useState<boolean>(false);
  const [logFilterProject, setLogFilterProject] = useState<string>('');
  const [logFilterStatus, setLogFilterStatus] = useState<string>('');
  const [logFilterSearch, setLogFilterSearch] = useState<string>('');
  const [logAutoRefresh, setLogAutoRefresh] = useState<boolean>(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState<boolean>(false);
  const [auditFilterAction, setAuditFilterAction] = useState<string>('');
  const [auditFilterActor, setAuditFilterActor] = useState<string>('');
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);

  // Rotated Secret Modal State
  const [rotatedSecretModal, setRotatedSecretModal] = useState<{ gatewayName: string; secret: string } | null>(null);

  // Gateway Project Bindings Modal State
  const [bindingGateway, setBindingGateway] = useState<any | null>(null);
  const [bindingSelectedMode, setBindingSelectedMode] = useState<'global' | 'targeted'>('global');
  const [bindingSelectedProjectIds, setBindingSelectedProjectIds] = useState<string[]>([]);
  const [bindingSaving, setBindingSaving] = useState<boolean>(false);
  const [deploySnippetTab, setDeploySnippetTab] = useState<'helm' | 'docker' | 'linux' | 'windows'>('helm');

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (user) {
      loadProjects();
      loadGateways();
      if (activeTab === 'audit') {
        loadAuditLogs();
      }
    }
  }, [user, activeTab, auditFilterAction, auditFilterActor]);

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams();
      if (logFilterProject) params.set('project', logFilterProject);
      if (logFilterStatus) params.set('status', logFilterStatus);
      if (logFilterSearch.trim()) params.set('search', logFilterSearch.trim());
      params.set('limit', '50');
      const res = await fetch(`/api/logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setLogsTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'logs') {
      loadLogs();
      if (logAutoRefresh) {
        const interval = setInterval(loadLogs, 3000);
        return () => clearInterval(interval);
      }
    }
  }, [activeTab, logFilterProject, logFilterStatus, logFilterSearch, logAutoRefresh]);

  const loadGateways = async () => {
    try {
      const res = await fetch('/api/gateways');
      if (res.ok) {
        const data = await res.json();
        setGatewaysList(data.gateways || []);
      }
    } catch (err) {
      console.error('Failed to load gateways:', err);
    }
  };

  const handleRegisterGateway = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGatewayName.trim()) return;
    setGatewayActionLoading(true);
    try {
      const res = await fetch('/api/gateways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGatewayName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setGeneratedSecret(data.secret);
        await loadGateways();
        showBanner(`Gateway "${data.gateway.name}" registered! Copy the secret now.`, 'success');
      } else {
        showBanner(data.error || 'Failed to register gateway', 'error');
      }
    } catch (err: any) {
      showBanner(err.message, 'error');
    } finally {
      setGatewayActionLoading(false);
    }
  };

  const handleRotateGatewaySecret = async (gatewayId: string, gatewayName: string) => {
    if (!confirm(`Are you sure you want to rotate the secret for gateway "${gatewayName}"? Connected instances must be updated with the new secret.`)) return;
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/rotate-secret`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setRotatedSecretModal({ gatewayName, secret: data.secret });
        await loadGateways();
        showBanner(`Secret for "${gatewayName}" rotated successfully!`, 'success');
      } else {
        showBanner(data.error || 'Failed to rotate secret', 'error');
      }
    } catch (err: any) {
      showBanner(err.message, 'error');
    }
  };

  const handleRevokeGateway = async (gatewayId: string, gatewayName: string) => {
    if (!confirm(`Are you sure you want to REVOKE gateway "${gatewayName}"? All authentication from this instance will be permanently blocked.`)) return;
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/revoke`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        await loadGateways();
        showBanner(`Gateway "${gatewayName}" has been revoked!`, 'info');
      } else {
        showBanner(data.error || 'Failed to revoke gateway', 'error');
      }
    } catch (err: any) {
      showBanner(err.message, 'error');
    }
  };

  const openManageBindings = (gw: any) => {
    setBindingGateway(gw);
    const hasBindings = gw.bound_projects && gw.bound_projects.length > 0;
    setBindingSelectedMode(hasBindings ? 'targeted' : 'global');
    setBindingSelectedProjectIds(hasBindings ? gw.bound_projects.map((p: any) => p.id) : []);
  };

  const handleSaveBindings = async () => {
    if (!bindingGateway) return;
    setBindingSaving(true);
    try {
      const boundIds = bindingSelectedMode === 'global' ? [] : bindingSelectedProjectIds;
      const res = await fetch(`/api/gateways/${bindingGateway.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bound_project_ids: boundIds })
      });
      const data = await res.json();
      if (res.ok) {
        showBanner(`Updated project mappings for gateway "${bindingGateway.name}"!`, 'success');
        setBindingGateway(null);
        await loadGateways();
      } else {
        showBanner(data.error || 'Failed to update gateway bindings', 'error');
      }
    } catch (err: any) {
      showBanner(err.message, 'error');
    } finally {
      setBindingSaving(false);
    }
  };

  const handleInspectGateway = async (gatewayId: string) => {
    setInspectingGatewayId(gatewayId);
    setInspectionLoading(true);
    setInspectionTab('endpoints');
    setInspectSearchQuery('');
    setInspectSelectedProjectId('');
    setInspectProtocolFilter('all');

    // Pre-populate with local gateway details immediately so user sees rich feedback instantly
    const localGw = gatewaysList.find((g) => g.id === gatewayId || g.name === gatewayId);
    if (localGw) {
      setInspectingGatewayData({
        gateway: localGw,
        endpoints: (localGw.bound_projects && localGw.bound_projects.length > 0)
          ? localGw.bound_projects.map((bp: any) => ({
              project_id: bp.id,
              project_name: bp.name,
              slug: bp.slug,
              endpoint_path: bp.endpoint_path || `/p/${bp.slug}/mcp`,
              endpoint_url: bp.endpoint_url || `http://localhost:8080/p/${bp.slug}/mcp`,
              status: bp.status || 'active',
              inbound_auth: { mode: 'none' },
              rate_limits: { requests_per_minute: 600, burst: 50 },
              circuit_breaker: { max_failures: 5, recovery_seconds: 30 },
              downstream_servers: []
            }))
          : projects.map((p) => ({
              project_id: p.id,
              project_name: p.name,
              slug: p.slug,
              endpoint_path: `/p/${p.slug}/mcp`,
              endpoint_url: `${localGw.base_url || 'http://localhost:8080'}/p/${p.slug}/mcp`,
              status: p.status || 'active',
              inbound_auth: p.settings?.inbound_auth || { mode: 'none' },
              rate_limits: p.settings?.rate_limits || { requests_per_minute: 600, burst: 50 },
              circuit_breaker: p.settings?.circuit_breaker || { max_failures: 5, recovery_seconds: 30 },
              downstream_servers: p.servers || []
            }))
      });
    }

    try {
      const res = await fetch(`/api/gateways/${gatewayId}`);
      if (res.ok) {
        const data = await res.json();
        setInspectingGatewayData(data);
      } else {
        const errData = await res.json().catch(() => ({}));
        if (localGw) {
          showBanner(errData.error ? `Displaying cached fleet profile (${errData.error})` : 'Showing cached gateway profile', 'info');
        } else {
          showBanner(errData.error || 'Failed to inspect gateway', 'error');
          setInspectingGatewayId(null);
        }
      }
    } catch (err: any) {
      if (localGw) {
        showBanner(`Displaying cached fleet profile: ${err.message}`, 'info');
      } else {
        showBanner(err.message, 'error');
        setInspectingGatewayId(null);
      }
    } finally {
      setInspectionLoading(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
    showBanner('Copied to clipboard!', 'success');
  };

  const renderDeploySnippets = (secret: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    const consoleUrl = `${origin}/api/v1`;

    const snippets: Record<'helm' | 'docker' | 'linux' | 'windows', string> = {
      helm: `helm install ai-gateway ./charts/ai-gateway \\\n  --set auth.key="${secret}" \\\n  --set gateway.consoleUrl="${consoleUrl}"`,
      docker: `docker run -d --name ai-gateway \\\n  -p 8080:8080 \\\n  -e AI_GATEWAY_KEY="${secret}" \\\n  -e CONSOLE_URL="${consoleUrl}" \\\n  ghcr.io/my-org/ai-gateway:1.0.0`,
      linux: `AI_GATEWAY_KEY="${secret}" \\\nCONSOLE_URL="${consoleUrl}" \\\nsudo ./deployments/standalone/install-linux.sh`,
      windows: `powershell -ExecutionPolicy Bypass -File .\\deployments\\standalone\\install-windows.ps1 \`\n  -GatewayKey "${secret}" \`\n  -ConsoleUrl "${consoleUrl}"`
    };

    const currentCode = snippets[deploySnippetTab];

    return (
      <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>
            🚀 Quickstart Deployment Snippets
          </span>
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-surface-subtle)', padding: '3px', borderRadius: 'var(--radius-sm)' }}>
            {(['helm', 'docker', 'linux', 'windows'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setDeploySnippetTab(tab)}
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  cursor: 'pointer',
                  background: deploySnippetTab === tab ? 'var(--primary)' : 'transparent',
                  color: deploySnippetTab === tab ? '#ffffff' : 'var(--text-muted)',
                  transition: 'all 0.15s ease'
                }}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <pre style={{
            background: '#090d16',
            color: '#e2e8f0',
            fontSize: '0.78rem',
            fontFamily: 'monospace',
            padding: '14px',
            paddingRight: '70px',
            borderRadius: 'var(--radius-md)',
            overflowX: 'auto',
            margin: 0,
            lineHeight: 1.5,
            border: '1px solid #1e293b'
          }}>
            {currentCode}
          </pre>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(currentCode);
              showBanner(`${deploySnippetTab.toUpperCase()} deployment command copied!`, 'success');
            }}
            className="btn-secondary"
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              fontSize: '0.72rem',
              padding: '4px 8px',
              background: 'rgba(255, 255, 255, 0.12)',
              borderColor: 'rgba(255, 255, 255, 0.25)',
              color: '#f8fafc'
            }}
          >
            📋 Copy
          </button>
        </div>
      </div>
    );
  };


  const loadAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams();
      if (auditFilterAction) params.append('action', auditFilterAction);
      if (auditFilterActor) params.append('actor', auditFilterActor);
      const res = await fetch(`/api/audit?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.audit_logs || []);
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (selectedProjectId) {
      loadServers(selectedProjectId);
    }
  }, [selectedProjectId]);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setOrg(data.organization);
      } else {
        setUser(null);
        setOrg(null);
      }
    } catch {
      setUser(null);
      setOrg(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || 'Authentication failed');
      } else {
        await checkAuth();
      }
    } catch {
      setLoginError('Network error connecting to control plane');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setOrg(null);
      setProjects([]);
      setServers([]);
      setDiscoveredTools([]);
    }
  };

  // Projects CRUD
  const loadProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
        if (data.projects && data.projects.length > 0 && !selectedProjectId) {
          setSelectedProjectId(data.projects[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setProjectActionLoading(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProjectName,
          slug: newProjectSlug,
          gateway_id: newProjectGatewayId || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowNewProjectModal(false);
        setNewProjectName('');
        setNewProjectSlug('');
        setNewProjectGatewayId('');
        await loadProjects();
        await loadGateways();
        setSelectedProjectId(data.project.id);
        showBanner(`Project "${data.project.name}" created and assigned to gateway successfully!`, 'success');
      } else {
        showBanner(data.error || 'Failed to create project', 'error');
      }
    } catch (err: any) {
      showBanner(err.message, 'error');
    } finally {
      setProjectActionLoading(false);
    }
  };

  // MCP Servers CRUD
  const loadServers = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/servers`);
      if (res.ok) {
        const data = await res.json();
        setServers(data.servers || []);
      }
    } catch (err) {
      console.error('Failed to load servers:', err);
    }
  };

  const handleCreateServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerName || !newServerUrl) return;
    setServerActionLoading(true);
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newServerName,
          namespace_prefix: newServerPrefix,
          transport: newServerTransport,
          url: newServerUrl,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowNewServerModal(false);
        setNewServerName('');
        setNewServerPrefix('');
        setNewServerUrl('');
        await loadServers(selectedProjectId);
        await loadProjects();
        showBanner(`Downstream server "${data.server.name}" added to project!`, 'success');
      } else {
        showBanner(data.error || 'Failed to add server', 'error');
      }
    } catch (err: any) {
      showBanner(err.message, 'error');
    } finally {
      setServerActionLoading(false);
    }
  };

  const handleToggleServer = async (server: MCPServer) => {
    try {
      const res = await fetch(`/api/servers/${server.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      if (res.ok) {
        await loadServers(selectedProjectId);
        await loadProjects();
      }
    } catch (err) {
      console.error('Failed to toggle server:', err);
    }
  };

  const handleDeleteServer = async (serverId: string, serverName: string) => {
    if (!confirm(`Are you sure you want to remove MCP downstream "${serverName}"?`)) return;
    try {
      const res = await fetch(`/api/servers/${serverId}`, { method: 'DELETE' });
      if (res.ok) {
        await loadServers(selectedProjectId);
        await loadProjects();
        // Remove tools from that server in UI catalog
        setDiscoveredTools(prev => prev.filter(t => t.server_id !== serverId));
        showBanner(`Removed server "${serverName}"`, 'info');
      }
    } catch (err) {
      console.error('Failed to delete server:', err);
    }
  };

  // Live Test Connection
  const handleTestConnection = async (serverId: string) => {
    setTestingServerId(serverId);
    try {
      const res = await fetch(`/api/servers/${serverId}/test`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResults(prev => ({
          ...prev,
          [serverId]: { status: 'healthy', latency_ms: data.latency_ms, message: `Connected in ${data.latency_ms}ms` }
        }));
        showBanner(`Connection test succeeded (${data.latency_ms}ms)`, 'success');
      } else {
        setTestResults(prev => ({
          ...prev,
          [serverId]: { status: 'unhealthy', latency_ms: data.latency_ms || 0, message: 'Connection failed or timed out' }
        }));
        showBanner('Connection failed or downstream unreachable', 'error');
      }
      await loadServers(selectedProjectId);
    } catch (err: any) {
      showBanner(err.message || 'Connection test error', 'error');
    } finally {
      setTestingServerId(null);
    }
  };

  // Live Tool Discovery
  const handleDiscoverTools = async (serverId: string) => {
    setDiscoveringServerId(serverId);
    try {
      const res = await fetch(`/api/servers/${serverId}/discover`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        const newTools: DiscoveredTool[] = data.tools || [];
        setDiscoveredTools(prev => {
          // Merge tools avoiding duplicate tool IDs
          const otherTools = prev.filter(t => t.server_id !== serverId);
          return [...otherTools, ...newTools];
        });
        showBanner(`Discovered ${newTools.length} tool(s) from "${data.server_name}"!`, 'success');
        await loadServers(selectedProjectId);
        await loadProjects();
      } else {
        showBanner(data.error || 'Failed to discover tools', 'error');
      }
    } catch (err: any) {
      showBanner(err.message || 'Tool discovery error', 'error');
    } finally {
      setDiscoveringServerId(null);
    }
  };

  // Toggle Tool Policy
  const handleToggleToolPolicy = async (tool: DiscoveredTool) => {
    try {
      const newEnabled = !tool.enabled;
      const res = await fetch(`/api/servers/${tool.server_id}/tools/${encodeURIComponent(tool.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled, rename: tool.rename }),
      });
      if (res.ok) {
        setDiscoveredTools(prev =>
          prev.map(t => (t.server_id === tool.server_id && t.name === tool.name ? { ...t, enabled: newEnabled } : t))
        );
        await loadProjects();
      }
    } catch (err) {
      console.error('Failed to toggle tool policy:', err);
    }
  };

  const showBanner = (text: string, type: 'success' | 'error' | 'info') => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 4500);
  };

  const activeProject = projects.find(p => p.id === selectedProjectId) || projects[0];

  // Presets
  const applyPreset = (preset: 'math' | 'weather') => {
    if (preset === 'math') {
      setNewServerName('Mock Math Tools');
      setNewServerPrefix('math');
      setNewServerUrl('http://127.0.0.1:3000/api/mock/mcp-math');
    } else {
      setNewServerName('Mock Weather Tools');
      setNewServerPrefix('weather');
      setNewServerUrl('http://127.0.0.1:3000/api/mock/mcp-weather');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="pulse-dot" style={{ margin: '0 auto 16px', width: '16px', height: '16px' }}></div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Initializing AI Console Control Plane...</p>
        </div>
      </div>
    );
  }

  // Login View
  if (!user) {
    return (
      <div style={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        position: 'relative'
      }}>
        <div className="glass-panel" style={{
          width: '100%',
          maxWidth: '440px',
          padding: '40px 36px',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
              boxShadow: '0 8px 24px rgba(99, 102, 241, 0.45)',
              marginBottom: '16px'
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                <line x1="6" y1="6" x2="6.01" y2="6"></line>
                <line x1="6" y1="18" x2="6.01" y2="18"></line>
              </svg>
            </div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px' }}>
              AI Console
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Distributed Control Plane for Headless AI Gateways
            </p>
            <div style={{ marginTop: '10px' }}>
              <span className="badge badge-indigo">Phase 2: Projects & MCP Discovery</span>
            </div>
          </div>

          {loginError && (
            <div style={{
              background: 'rgba(244, 63, 94, 0.15)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '20px',
              color: '#fda4af',
              fontSize: '0.85rem'
            }}>
              ⚠️ {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                Admin Email
              </label>
              <input
                id="email-input"
                type="email"
                className="input-field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                Password
              </label>
              <input
                id="password-input"
                type="password"
                className="input-field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button
              id="submit-login-btn"
              type="submit"
              disabled={isSubmitting}
              className="btn-primary"
              style={{ width: '100%', marginTop: '8px', height: '44px' }}
            >
              {isSubmitting ? 'Authenticating...' : 'Sign In to Control Plane'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Authenticated Shell
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Toast Notification Banner */}
      {statusMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '24px',
          zIndex: 9999,
          background: statusMessage.type === 'success' ? 'rgba(16, 185, 129, 0.9)' : statusMessage.type === 'error' ? 'rgba(244, 63, 94, 0.9)' : 'rgba(99, 102, 241, 0.9)',
          backdropFilter: 'blur(10px)',
          color: '#ffffff',
          padding: '12px 20px',
          borderRadius: '10px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.4)',
          fontWeight: 600,
          fontSize: '0.9rem',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          animation: 'fade-in 0.2s ease'
        }}>
          <span>{statusMessage.type === 'success' ? '✅' : statusMessage.type === 'error' ? '❌' : 'ℹ️'}</span>
          {statusMessage.text}
        </div>
      )}

      {/* Top Navbar */}
      <header style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '14px 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: 'var(--card-shadow)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(79, 70, 229, 0.35)'
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
              <line x1="6" y1="6" x2="6.01" y2="6"></line>
              <line x1="6" y1="18" x2="6.01" y2="18"></line>
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="brand-font" style={{ fontWeight: 700, fontSize: '1.15rem', color: 'var(--text-main)' }}>AI CONSOLE</span>
              <span className="badge badge-cyan" style={{ fontSize: '0.65rem' }}>Control Plane</span>
              <span className="badge badge-emerald" style={{ fontSize: '0.65rem' }}>Phase 2 Ready</span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Org: <strong style={{ color: 'var(--text-main)' }}>{org?.name || 'Default Enterprise'}</strong>
            </span>
          </div>
        </div>

        {/* User Info & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            background: 'var(--bg-surface-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-pill)',
            padding: '4px 12px 4px 6px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: 'var(--primary)',
              color: 'var(--text-inverse)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.75rem',
              fontWeight: 700
            }}>
              {user.name.charAt(0)}
            </div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{user.email}</span>
            <span className="badge badge-indigo" style={{ fontSize: '0.65rem' }}>{user.role}</span>
          </div>

          <button id="logout-btn" onClick={handleLogout} className="btn-secondary" style={{ padding: '6px 12px' }}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div style={{ flex: 1, display: 'flex' }}>
        {/* Sidebar Nav */}
        <nav style={{
          width: '240px',
          borderRight: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          padding: '24px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}>
          {[
            { id: 'projects', label: 'Projects & Virtual MCP', icon: '📁' },
            { id: 'inbound-endpoints', label: 'Inbound & MCP Endpoints', icon: '🌐' },
            { id: 'gateways', label: 'Gateway Fleet', icon: '⚡' },
            { id: 'policies', label: 'Project Policies', icon: '🛡️' },
            { id: 'certificates', label: 'Certificates & Security Hub', icon: '🔒' },
            { id: 'mcp-servers', label: 'Downstream MCPs', icon: '🔌' },
            { id: 'oauth', label: 'OAuth & Secrets', icon: '🔑' },
            { id: 'logs', label: 'Logs & Telemetry', icon: '📊' },
            { id: 'audit', label: 'Audit Trail', icon: '📜' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                border: activeTab === item.id ? '1px solid var(--border-strong)' : '1px solid transparent',
                background: activeTab === item.id ? 'var(--primary-subtle)' : 'transparent',
                color: activeTab === item.id ? 'var(--primary-text)' : 'var(--text-muted)',
                fontWeight: activeTab === item.id ? 600 : 500,
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
                transition: 'all 0.15s ease'
              }}
            >
              <span>{item.icon}</span>
              <span style={{ fontSize: '0.88rem' }}>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Content Body */}
        <main style={{ flex: 1, padding: '32px 36px', overflowY: 'auto', background: 'var(--bg-page)' }}>
          {/* TAB 1: PROJECTS */}
          {activeTab === 'projects' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                <div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                    Projects & Virtual MCP Endpoints
                  </h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                    Each project aggregates multiple downstream MCP servers into a unified virtual server.
                  </p>
                </div>
                <button
                  id="create-project-btn"
                  onClick={() => setShowNewProjectModal(true)}
                  className="btn-primary"
                >
                  + Create New Project
                </button>
              </div>

              {/* Projects Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '20px' }}>
                {projects.map((proj) => (
                  <div key={proj.id} className="glass-panel" style={{
                    padding: '24px',
                    borderColor: selectedProjectId === proj.id ? 'rgba(99, 102, 241, 0.5)' : undefined,
                    boxShadow: selectedProjectId === proj.id ? '0 0 20px rgba(99, 102, 241, 0.25)' : undefined,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-main)' }}>{proj.name}</h3>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <span className="badge badge-cyan">v{proj.config_version}</span>
                        <span className="badge badge-emerald">{proj.status}</span>
                      </div>
                    </div>

                    <div style={{ background: 'var(--bg-surface)', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '4px' }}>
                        Virtual MCP Endpoint:
                      </div>
                      <code style={{ fontSize: '0.85rem', color: 'var(--accent-cyan)' }}>
                        /p/{proj.slug}/mcp
                      </code>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        Downstreams: <strong style={{ color: '#fff' }}>{proj.server_count || 0}</strong>
                      </span>
                      <button
                        id={`manage-proj-${proj.slug}`}
                        onClick={() => {
                          setSelectedProjectId(proj.id);
                          setActiveTab('mcp-servers');
                        }}
                        className="btn-primary"
                        style={{ padding: '6px 14px', fontSize: '0.85rem' }}
                      >
                        Manage Downstreams ➔
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: MCP SERVERS & DISCOVERY */}
          {activeTab === 'mcp-servers' && (
            <div>
              {/* Project Selector Bar */}
              <div className="glass-panel" style={{ padding: '16px 20px', marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <span style={{ fontSize: '0.88rem', color: 'var(--text-dim)', fontWeight: 600 }}>Active Project:</span>
                  <select
                    id="project-selector"
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-main)',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      fontSize: '0.9rem',
                      fontWeight: 600
                    }}
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name} (/p/{p.slug}/mcp)</option>
                    ))}
                  </select>

                  {activeProject && (
                    <span className="badge badge-cyan">Config v{activeProject.config_version}</span>
                  )}
                </div>

                <button
                  id="add-mcp-server-btn"
                  onClick={() => setShowNewServerModal(true)}
                  className="btn-primary"
                >
                  + Add Downstream MCP Server
                </button>
              </div>

              {/* Server Cards */}
              <div style={{ marginBottom: '32px' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '16px' }}>
                  Downstream MCP Servers ({servers.length})
                </h3>

                {servers.length === 0 ? (
                  <div className="glass-panel" style={{ padding: '36px', textAlign: 'center' }}>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
                      No downstream MCP servers registered for this project yet.
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
                      <button
                        id="quick-add-math-btn"
                        onClick={() => {
                          applyPreset('math');
                          setShowNewServerModal(true);
                        }}
                        className="btn-secondary"
                      >
                        ⚡ Add Mock Math Server
                      </button>
                      <button
                        id="quick-add-weather-btn"
                        onClick={() => {
                          applyPreset('weather');
                          setShowNewServerModal(true);
                        }}
                        className="btn-secondary"
                      >
                        ⚡ Add Mock Weather Server
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '20px' }}>
                    {servers.map((srv) => (
                      <div key={srv.id} className="glass-panel" style={{ padding: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                          <div>
                            <h4 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-main)' }}>{srv.name}</h4>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                              Prefix: <code style={{ color: 'var(--accent-cyan)' }}>{srv.namespace_prefix}__</code>
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className={`badge ${srv.health_status === 'healthy' ? 'badge-emerald' : srv.health_status === 'unhealthy' ? 'badge-rose' : 'badge-indigo'}`}>
                              {srv.health_status}
                            </span>
                            <span className="badge badge-indigo">{srv.transport.toUpperCase()}</span>
                          </div>
                        </div>

                        <div style={{ background: 'var(--bg-surface)', padding: '8px 12px', borderRadius: '6px', marginBottom: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <code style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{srv.url}</code>
                        </div>

                        {/* Test Status Feedback */}
                        {testResults[srv.id] && (
                          <div style={{
                            padding: '8px 12px',
                            borderRadius: '6px',
                            background: testResults[srv.id].status === 'healthy' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                            fontSize: '0.8rem',
                            color: testResults[srv.id].status === 'healthy' ? '#34d399' : '#fda4af',
                            marginBottom: '14px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}>
                            <span>{testResults[srv.id].status === 'healthy' ? '●' : '✕'}</span>
                            {testResults[srv.id].message}
                          </div>
                        )}

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                          <button
                            id={`test-server-${srv.namespace_prefix}`}
                            disabled={testingServerId === srv.id}
                            onClick={() => handleTestConnection(srv.id)}
                            className="btn-secondary"
                            style={{ padding: '6px 12px', fontSize: '0.82rem' }}
                          >
                            {testingServerId === srv.id ? 'Pinging...' : '🔌 Test Connection'}
                          </button>

                          <button
                            id={`discover-tools-${srv.namespace_prefix}`}
                            disabled={discoveringServerId === srv.id}
                            onClick={() => handleDiscoverTools(srv.id)}
                            className="btn-primary"
                            style={{ padding: '6px 12px', fontSize: '0.82rem' }}
                          >
                            {discoveringServerId === srv.id ? 'Scanning...' : '🔍 Discover Tools'}
                          </button>

                          <button
                            onClick={() => handleToggleServer(srv)}
                            className="btn-secondary"
                            style={{ padding: '6px 12px', fontSize: '0.82rem' }}
                          >
                            {srv.enabled ? 'Disable' : 'Enable'}
                          </button>

                          <button
                            onClick={() => handleDeleteServer(srv.id, srv.name)}
                            className="btn-secondary"
                            style={{ padding: '6px 10px', fontSize: '0.82rem', color: '#f43f5e' }}
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Discovered Tools Catalog */}
              {discoveredTools.length > 0 && (
                <div className="glass-panel" style={{ padding: '28px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                    <div>
                      <h3 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                        Discovered Tools Catalog ({discoveredTools.length})
                      </h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        Namespaced tools aggregated into the project virtual MCP endpoint. Operators can toggle or rename individual tools.
                      </p>
                    </div>
                    <span className="badge badge-emerald">
                      {discoveredTools.filter(t => t.enabled).length} Enabled
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {discoveredTools.map((tool, idx) => (
                      <div key={idx} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '16px 20px',
                        background: 'var(--bg-surface-subtle)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '10px'
                      }}>
                        <div style={{ flex: 1, paddingRight: '20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                            <code style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                              {tool.virtual_name}
                            </code>
                            <span className="badge badge-indigo" style={{ fontSize: '0.65rem' }}>
                              From {tool.server_name}
                            </span>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                              (Raw: <code>{tool.name}</code>)
                            </span>
                          </div>
                          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                            {tool.description || 'No description provided'}
                          </p>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <button
                            id={`toggle-tool-${tool.virtual_name}`}
                            onClick={() => handleToggleToolPolicy(tool)}
                            style={{
                              padding: '8px 16px',
                              borderRadius: '8px',
                              border: 'none',
                              cursor: 'pointer',
                              fontWeight: 600,
                              fontSize: '0.82rem',
                              background: tool.enabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.2)',
                              color: tool.enabled ? '#34d399' : '#fda4af',
                              borderWidth: '1px',
                              borderStyle: 'solid',
                              borderColor: tool.enabled ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)',
                              transition: 'all 0.2s ease'
                            }}
                          >
                            {tool.enabled ? '✓ Enabled' : '✕ Disabled'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: GATEWAYS FLEET */}
          {activeTab === 'gateways' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                <div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                    Headless AI Gateway Fleet
                  </h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                    Data plane instances poll configuration via HTTPS, enforce fail-static local caching, and emit real-time heartbeats.
                  </p>
                </div>
                <button
                  id="register-gateway-btn"
                  onClick={() => {
                    setGeneratedSecret(null);
                    setShowNewGatewayModal(true);
                  }}
                  className="btn-primary"
                >
                  + Register New Gateway
                </button>
              </div>

              {/* Gateway Cards Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '20px' }}>
                {gatewaysList.map((gw) => (
                  <div key={gw.id} className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div className="pulse-dot" style={{ backgroundColor: gw.status === 'active' ? '#10b981' : '#f59e0b' }}></div>
                        <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-main)' }}>{gw.name}</h3>
                      </div>
                      <span className={`badge ${gw.status === 'active' ? 'badge-emerald' : gw.status === 'revoked' ? 'badge-rose' : 'badge-indigo'}`}>
                        {gw.status.toUpperCase()}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Runtime Version:</span>
                        <strong style={{ color: '#fff' }}>v{gw.version || '1.0.0'}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Applied Config Version:</span>
                        <span className="badge badge-cyan">v{gw.applied_config_version || 1}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Last Seen / Heartbeat:</span>
                        <span style={{ color: 'var(--accent-cyan)' }}>
                          {gw.last_seen_at ? new Date(gw.last_seen_at).toLocaleTimeString() : 'Awaiting heartbeat'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>TLS / Encryption:</span>
                        <span className="badge badge-emerald" style={{ fontSize: '0.7rem', padding: '2px 6px' }}>
                          HTTPS / TLS 1.3 Ready
                        </span>
                      </div>
                    </div>

                    {/* Assigned Endpoints & Active Rules Representation */}
                    {/* Assigned Endpoints & Active Rules Representation */}
                    <div style={{ background: 'var(--bg-surface-subtle)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-subtle)', marginBottom: '16px' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Hosted Endpoints &amp; Mappings</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className={`badge ${gw.bound_projects?.length ? 'badge-indigo' : 'badge-cyan'}`} style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                            {gw.bound_projects?.length ? `🎯 ${gw.bound_projects.length} Targeted` : `🌐 Global (${projects.length})`}
                          </span>
                          <button
                            onClick={() => openManageBindings(gw)}
                            className="btn-secondary"
                            style={{ fontSize: '0.7rem', padding: '2px 7px', color: 'var(--accent-cyan)', background: 'rgba(6, 182, 212, 0.12)' }}
                            title="Map or unmap projects to this gateway"
                          >
                            🔗 Map Projects
                          </button>
                        </div>
                      </div>

                      {gw.bound_projects && gw.bound_projects.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ fontSize: '0.73rem', color: '#818cf8', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                            <span>🎯 Targeted Scope (Strictly isolated to {gw.bound_projects.length} project{gw.bound_projects.length > 1 ? 's' : ''}):</span>
                          </div>
                          {gw.bound_projects.slice(0, 3).map((bp: any) => (
                            <div key={bp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem', background: 'var(--bg-surface-subtle)', padding: '6px 8px', borderRadius: '4px' }}>
                              <div style={{ overflow: 'hidden' }}>
                                <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.82rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{bp.name}</div>
                                <code style={{ fontSize: '0.72rem', color: 'var(--accent-cyan)' }}>{bp.endpoint_url || `/p/${bp.slug}/mcp`}</code>
                              </div>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', background: 'var(--bg-surface-subtle)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap', marginLeft: '6px' }}>
                                {bp.server_count || 0} upstreams
                              </span>
                            </div>
                          ))}
                          {gw.bound_projects.length > 3 && (
                            <button
                              onClick={() => handleInspectGateway(gw.id)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--accent-cyan)',
                                fontSize: '0.74rem',
                                cursor: 'pointer',
                                textAlign: 'left',
                                padding: '4px 2px',
                                textDecoration: 'underline'
                              }}
                            >
                              + {gw.bound_projects.length - 3} more targeted projects (click to inspect all ➔)
                            </button>
                          )}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ fontSize: '0.73rem', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                            <span>🌐 Global Mode: Serving all {projects.length} org project(s)</span>
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>Broadcasting</span>
                          </div>
                          {projects.slice(0, 3).map((p: any) => (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem', background: 'var(--bg-surface-subtle)', padding: '5px 8px', borderRadius: '4px' }}>
                              <div style={{ overflow: 'hidden' }}>
                                <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.82rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{p.name}</div>
                                <code style={{ fontSize: '0.72rem', color: 'var(--accent-cyan)' }}>/p/{p.slug}/mcp</code>
                              </div>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', background: 'var(--bg-surface-subtle)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap', marginLeft: '6px' }}>
                                {p.servers?.length ?? p.server_count ?? 0} upstreams
                              </span>
                            </div>
                          ))}
                          {projects.length > 3 && (
                            <button
                              onClick={() => handleInspectGateway(gw.id)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--accent-cyan)',
                                fontSize: '0.74rem',
                                cursor: 'pointer',
                                textAlign: 'left',
                                padding: '4px 2px',
                                textDecoration: 'underline'
                              }}
                            >
                              + {projects.length - 3} more mapped projects (click to inspect all ➔)
                            </button>
                          )}
                          {projects.length === 0 && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                              No active projects created yet in organization.
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                        Protocol: {gw.protocol?.toUpperCase() || 'HTTP'} Polling
                      </span>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          id={`inspect-gw-${gw.id}`}
                          onClick={() => handleInspectGateway(gw.id)}
                          className="btn-primary"
                          style={{
                            fontSize: '0.75rem',
                            padding: '4px 10px',
                            background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px'
                          }}
                          title="Deep inspect endpoints, downstreams, rules, and TLS"
                        >
                          <span>🔍</span> Inspect Details
                        </button>

                        <button
                          onClick={() => openManageBindings(gw)}
                          className="btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '4px 8px', color: '#c7d2fe' }}
                          title="Manage project bindings for this gateway"
                        >
                          🔗 Bindings
                        </button>

                        <button
                          onClick={() => setActiveTab('inbound-endpoints')}
                          className="btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '4px 8px', color: 'var(--accent-cyan)' }}
                          title="View all inbound endpoints and MCPs for this gateway"
                        >
                          🌐 Endpoints ➔
                        </button>

                        <button
                          onClick={() => setActiveTab('policies')}
                          className="btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '4px 8px', color: '#10b981' }}
                          title="Configure & enforce project policies"
                        >
                          🛡️ Policies
                        </button>

                        <button
                          onClick={() => setActiveTab('certificates')}
                          className="btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '4px 8px', color: '#f59e0b' }}
                          title="Configure TLS certificates and settings"
                        >
                          🔒 TLS / Certs
                        </button>

                        {gw.status !== 'revoked' && (
                          <>
                            <button
                              id={`rotate-gw-${gw.id}`}
                              onClick={() => handleRotateGatewaySecret(gw.id, gw.name)}
                              className="btn-secondary"
                              style={{ fontSize: '0.75rem', padding: '4px 8px', color: 'var(--accent-cyan)' }}
                              title="Rotate secret for this gateway"
                            >
                              🔑 Rotate
                            </button>
                            <button
                              id={`revoke-gw-${gw.id}`}
                              onClick={() => handleRevokeGateway(gw.id, gw.name)}
                              className="btn-secondary"
                              style={{ fontSize: '0.75rem', padding: '4px 8px', color: '#f43f5e' }}
                              title="Revoke this gateway instance"
                            >
                              🚫 Revoke
                            </button>
                          </>
                        )}
                        <button
                          onClick={loadGateways}
                          className="btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                        >
                          🔄 Refresh
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: Gateway Logs & Telemetry Viewer */}
          {activeTab === 'logs' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                <div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                    Gateway Logs & Telemetry
                  </h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                    Real-time aggregated MCP access logs and execution metrics ingested from the headless gateway fleet.
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    onClick={() => setLogAutoRefresh(!logAutoRefresh)}
                    className="btn-secondary"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.85rem',
                      borderColor: logAutoRefresh ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-subtle)',
                      background: logAutoRefresh ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    <span className="pulse-dot" style={{ backgroundColor: logAutoRefresh ? '#10b981' : '#64748b' }}></span>
                    Auto-refresh: {logAutoRefresh ? 'ON' : 'OFF'}
                  </button>
                  <button
                    id="refresh-logs-btn"
                    onClick={loadLogs}
                    disabled={logsLoading}
                    className="btn-primary"
                    style={{ fontSize: '0.85rem' }}
                  >
                    {logsLoading ? 'Refreshing...' : '🔄 Refresh Now'}
                  </button>
                </div>
              </div>

              {/* Stats Bar */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                <div className="glass-panel" style={{ padding: '16px 20px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Total Ingested Events
                  </span>
                  <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '4px' }}>
                    {logsTotal}
                  </div>
                </div>
                <div className="glass-panel" style={{ padding: '16px 20px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Avg Latency (Current View)
                  </span>
                  <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--accent-cyan)', marginTop: '4px' }}>
                    {logs.length > 0 ? (logs.reduce((acc, l) => acc + (parseFloat(l.latency_ms) || 0), 0) / logs.length).toFixed(2) : '0.00'} ms
                  </div>
                </div>
                <div className="glass-panel" style={{ padding: '16px 20px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Success Rate
                  </span>
                  <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#34d399', marginTop: '4px' }}>
                    {logs.length > 0 ? ((logs.filter(l => l.status === '200').length / logs.length) * 100).toFixed(1) : '100.0'}%
                  </div>
                </div>
                <div className="glass-panel" style={{ padding: '16px 20px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Ingest Pipeline
                  </span>
                  <div style={{ fontSize: '1rem', fontWeight: 600, color: '#a78bfa', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>⚡ Redis Stream ➔ PG</span>
                  </div>
                </div>
              </div>

              {/* Filters Bar */}
              <div className="glass-panel" style={{ padding: '16px 20px', marginBottom: '20px', display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'center' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <input
                    id="log-search-input"
                    className="input-field"
                    placeholder="Search by tool, server, error, trace..."
                    value={logFilterSearch}
                    onChange={(e) => setLogFilterSearch(e.target.value)}
                  />
                </div>

                <div style={{ minWidth: '180px' }}>
                  <select
                    id="log-project-filter"
                    className="input-field"
                    value={logFilterProject}
                    onChange={(e) => setLogFilterProject(e.target.value)}
                  >
                    <option value="">All Projects</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.slug}>{p.name} ({p.slug})</option>
                    ))}
                  </select>
                </div>

                <div style={{ minWidth: '140px' }}>
                  <select
                    id="log-status-filter"
                    className="input-field"
                    value={logFilterStatus}
                    onChange={(e) => setLogFilterStatus(e.target.value)}
                  >
                    <option value="">All Statuses</option>
                    <option value="200">200 OK</option>
                    <option value="400">400 Bad Request</option>
                    <option value="401">401 Unauthorized</option>
                    <option value="404">404 Not Found</option>
                    <option value="500">500 Server Error</option>
                    <option value="-32601">-32601 Method Not Found</option>
                    <option value="-32000">-32000 Downstream Error</option>
                  </select>
                </div>

                {(logFilterProject || logFilterStatus || logFilterSearch) && (
                  <button
                    onClick={() => {
                      setLogFilterProject('');
                      setLogFilterStatus('');
                      setLogFilterSearch('');
                    }}
                    className="btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  >
                    ✕ Clear Filters
                  </button>
                )}
              </div>

              {/* Logs Table */}
              <div className="glass-panel" style={{ overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface-subtle)' }}>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Timestamp</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Status</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Project</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Server</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Tool</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Latency</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Trace ID</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📡</div>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>No Gateway Logs Found</div>
                          <div style={{ fontSize: '0.8rem' }}>Call tools via <code>/p/{'{slug}'}/mcp</code> to generate telemetry events.</div>
                        </td>
                      </tr>
                    ) : (
                      logs.map((log) => {
                        const isExpanded = expandedLogId === log.id;
                        const isOk = log.status === '200';
                        const isWarn = log.status?.startsWith('4') || log.status === '401';
                        return (
                          <React.Fragment key={log.id}>
                            <tr
                              onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                              style={{
                                borderBottom: '1px solid var(--border-subtle)',
                                cursor: 'pointer',
                                background: isExpanded ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                                transition: 'background 0.15s ease',
                              }}
                            >
                              <td style={{ padding: '12px 16px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                                {new Date(log.timestamp).toLocaleTimeString()}
                              </td>
                              <td style={{ padding: '12px 16px' }}>
                                <span className={`badge ${isOk ? 'badge-emerald' : isWarn ? 'badge-amber' : 'badge-rose'}`} style={{ fontSize: '0.75rem' }}>
                                  {log.status}
                                </span>
                              </td>
                              <td style={{ padding: '12px 16px', color: 'var(--text-main)', fontWeight: 500 }}>
                                {log.project}
                              </td>
                              <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>
                                {log.mcp_server || '—'}
                              </td>
                              <td style={{ padding: '12px 16px', color: log.tool ? 'var(--accent-cyan)' : 'var(--text-dim)' }}>
                                {log.tool || 'initialize / list'}
                              </td>
                              <td style={{ padding: '12px 16px', color: 'var(--text-main)', fontFamily: 'monospace' }}>
                                {parseFloat(log.latency_ms || 0).toFixed(2)} ms
                              </td>
                              <td style={{ padding: '12px 16px', color: 'var(--text-dim)', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                                {log.trace_id ? log.trace_id.substring(0, 16) + '...' : '—'}
                              </td>
                              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
                                  {isExpanded ? '▲ Less' : '▼ Inspect'}
                                </button>
                              </td>
                            </tr>

                            {isExpanded && (
                              <tr style={{ background: 'var(--bg-surface-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
                                <td colSpan={8} style={{ padding: '16px 24px' }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                                    <div>
                                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '4px' }}>EVENT & TRACE IDS</div>
                                      <div style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: '#fff', wordBreak: 'break-all' }}>
                                        Event ID: {log.event_id}<br />
                                        Trace ID: {log.trace_id || 'n/a'}<br />
                                        Client ID: {log.client_id || 'n/a'}
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '4px' }}>PAYLOAD SIZES</div>
                                      <div style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: '#fff' }}>
                                        Bytes In: {log.bytes_in || 0} bytes<br />
                                        Bytes Out: {log.bytes_out || 0} bytes<br />
                                        Recorded: {new Date(log.timestamp).toISOString()}
                                      </div>
                                    </div>
                                    {log.error && (
                                      <div style={{ gridColumn: '1 / -1' }}>
                                        <div style={{ fontSize: '0.75rem', color: '#fda4af', marginBottom: '4px' }}>ERROR DETAILS</div>
                                        <div style={{ background: 'rgba(244, 63, 94, 0.15)', border: '1px solid rgba(244, 63, 94, 0.3)', padding: '8px 12px', borderRadius: '6px', color: '#fda4af', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                                          {log.error}
                                        </div>
                                      </div>
                                    )}
                                    {log.attributes && Object.keys(log.attributes).length > 0 && (
                                      <div style={{ gridColumn: '1 / -1' }}>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '4px' }}>ATTRIBUTES</div>
                                        <pre style={{ background: 'var(--bg-surface-subtle)', padding: '10px', borderRadius: '6px', fontSize: '0.75rem', color: '#a78bfa', overflowX: 'auto', margin: 0 }}>
                                          {JSON.stringify(log.attributes, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: Audit Trail Viewer */}
          {activeTab === 'audit' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                <div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                    Immutable Audit Trail
                  </h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                    Tamper-evident record of all console mutations, secret rotations, and configuration updates.
                  </p>
                </div>
                <button
                  onClick={loadAuditLogs}
                  className="btn-secondary"
                  style={{ fontSize: '0.85rem', padding: '8px 16px' }}
                >
                  🔄 Refresh Logs
                </button>
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <input
                    id="audit-action-filter"
                    className="input-field"
                    placeholder="Filter by action (e.g. gateway, project, server)..."
                    value={auditFilterAction}
                    onChange={(e) => setAuditFilterAction(e.target.value)}
                  />
                </div>
                <div style={{ minWidth: '180px' }}>
                  <input
                    id="audit-actor-filter"
                    className="input-field"
                    placeholder="Filter by actor email..."
                    value={auditFilterActor}
                    onChange={(e) => setAuditFilterActor(e.target.value)}
                  />
                </div>
                {(auditFilterAction || auditFilterActor) && (
                  <button
                    onClick={() => {
                      setAuditFilterAction('');
                      setAuditFilterActor('');
                    }}
                    className="btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  >
                    ✕ Clear
                  </button>
                )}
              </div>

              {/* Audit Table */}
              <div className="glass-panel" style={{ overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface-subtle)' }}>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Timestamp</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Actor</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Action</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Target</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>Mutation Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📜</div>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>No Audit Records Found</div>
                          <div style={{ fontSize: '0.8rem' }}>Configuration mutations will be tracked here automatically.</div>
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => {
                        const isExpanded = expandedAuditId === log.id;
                        const actionBadgeClass =
                          log.action?.includes('delete') || log.action?.includes('revoke')
                            ? 'badge-rose'
                            : log.action?.includes('create') || log.action?.includes('rotate')
                            ? 'badge-emerald'
                            : 'badge-cyan';

                        return (
                          <React.Fragment key={log.id}>
                            <tr
                              onClick={() => setExpandedAuditId(isExpanded ? null : log.id)}
                              style={{
                                borderBottom: '1px solid var(--border-subtle)',
                                cursor: 'pointer',
                                background: isExpanded ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                                transition: 'background 0.15s ease',
                              }}
                            >
                              <td style={{ padding: '12px 16px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                                {new Date(log.timestamp).toLocaleString()}
                              </td>
                              <td style={{ padding: '12px 16px', color: 'var(--text-main)', fontWeight: 500 }}>
                                {log.actor}
                              </td>
                              <td style={{ padding: '12px 16px' }}>
                                <span className={`badge ${actionBadgeClass}`} style={{ fontSize: '0.75rem' }}>
                                  {log.action}
                                </span>
                              </td>
                              <td style={{ padding: '12px 16px', color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>
                                {log.target}
                              </td>
                              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
                                  {isExpanded ? '▲ Hide Diff' : '▼ View Diff'}
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr style={{ background: 'var(--bg-surface-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
                                <td colSpan={5} style={{ padding: '16px 24px' }}>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '6px' }}>MUTATION DIFF (SECRETS REDACTED)</div>
                                  <pre style={{ background: 'var(--bg-surface-subtle)', padding: '12px', borderRadius: '8px', fontSize: '0.8rem', color: '#38bdf8', overflowX: 'auto', margin: 0 }}>
                                    {JSON.stringify(log.diff, null, 2)}
                                  </pre>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: INBOUND & MCP ENDPOINTS */}
          {activeTab === 'inbound-endpoints' && (
            <InboundEndpointsView
              projects={projects}
              gatewaysList={gatewaysList}
              onNavigateToPolicies={(projId) => {
                setSelectedProjectId(projId);
                setActiveTab('policies');
              }}
              onNavigateToCerts={() => {
                setActiveTab('certificates');
              }}
              onInspectGateway={(gwId) => handleInspectGateway(gwId)}
              onRefresh={() => {
                loadProjects();
                loadGateways();
              }}
            />
          )}

          {/* TAB: PROJECT POLICIES & ENFORCEMENT */}
          {activeTab === 'policies' && (
            <ProjectPoliciesView
              projects={projects}
              selectedProjectId={selectedProjectId || projects[0]?.id}
              onSelectProject={(projId) => setSelectedProjectId(projId)}
              onRefreshProjects={loadProjects}
              showBanner={showBanner}
            />
          )}

          {/* TAB: CERTIFICATES & SECURITY HUB */}
          {activeTab === 'certificates' && (
            <CertificatesSettingsView
              gatewaysList={gatewaysList}
              onRefreshGateways={loadGateways}
              showBanner={showBanner}
            />
          )}

          {/* TAB: OAUTH & SECRETS */}
          {activeTab === 'oauth' && (
            <OAuthSecretsView
              projects={projects}
              showBanner={showBanner}
            />
          )}
        </main>
      </div>

      {/* MODAL: Create Project */}
      {showNewProjectModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '480px', padding: '32px' }}>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '8px' }}>
              Create New Project
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
              A project exposes an aggregated virtual MCP endpoint for connected AI clients.
            </p>

            <form onSubmit={handleCreateProject} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Project Name
                </label>
                <input
                  id="new-project-name-input"
                  className="input-field"
                  placeholder="e.g. Finance Agent Workspace"
                  value={newProjectName}
                  onChange={(e) => {
                    setNewProjectName(e.target.value);
                    if (!newProjectSlug || newProjectSlug === newProjectName.toLowerCase().replace(/[^a-z0-9]/g, '-')) {
                      setNewProjectSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                    }
                  }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Endpoint Slug (/p/{'{slug}'}/mcp)
                </label>
                <input
                  id="new-project-slug-input"
                  className="input-field"
                  placeholder="e.g. finance-agent"
                  value={newProjectSlug}
                  onChange={(e) => setNewProjectSlug(e.target.value)}
                  required
                />
              </div>

              <div>
                <label htmlFor="new-project-gateway-select" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Target AI Gateway Instance
                </label>
                <select
                  id="new-project-gateway-select"
                  className="input-field"
                  value={newProjectGatewayId}
                  onChange={(e) => setNewProjectGatewayId(e.target.value)}
                  style={{ width: '100%', background: 'var(--bg-surface)', color: 'var(--text-main)', padding: '10px 12px' }}
                >
                  <option value="">🌐 All Live Gateways (Global Broadcast)</option>
                  {gatewaysList.map((gw: any) => (
                    <option key={gw.id} value={gw.id}>
                      {gw.is_online ? '🟢' : '⚪'} {gw.name} (v{gw.version || '1.0.0'} • {gw.is_online ? 'Online' : 'Registered'})
                    </option>
                  ))}
                </select>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '4px' }}>
                  Select which live gateway this endpoint and its policy rules will be pushed down to.
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowNewProjectModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  id="submit-create-project-btn"
                  type="submit"
                  disabled={projectActionLoading}
                  className="btn-primary"
                >
                  {projectActionLoading ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Add MCP Server */}
      {showNewServerModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '520px', padding: '32px' }}>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '8px' }}>
              Add Downstream MCP Server
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Register an upstream MCP server to merge into this project's tool catalog.
            </p>

            {/* Quick Presets */}
            <div style={{ background: 'var(--bg-surface-subtle)', padding: '12px', borderRadius: '8px', marginBottom: '18px' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                QUICK TEST PRESETS:
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  id="preset-math-btn"
                  onClick={() => applyPreset('math')}
                  className="btn-secondary"
                  style={{ fontSize: '0.78rem', padding: '6px 10px' }}
                >
                  + Mock Math Server
                </button>
                <button
                  type="button"
                  id="preset-weather-btn"
                  onClick={() => applyPreset('weather')}
                  className="btn-secondary"
                  style={{ fontSize: '0.78rem', padding: '6px 10px' }}
                >
                  + Mock Weather Server
                </button>
              </div>
            </div>

            <form onSubmit={handleCreateServer} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Server Name
                </label>
                <input
                  id="new-server-name-input"
                  className="input-field"
                  placeholder="e.g. Math Tools"
                  value={newServerName}
                  onChange={(e) => {
                    setNewServerName(e.target.value);
                    if (!newServerPrefix) {
                      setNewServerPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '_'));
                    }
                  }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Namespace Prefix
                  </label>
                  <input
                    id="new-server-prefix-input"
                    className="input-field"
                    placeholder="e.g. math"
                    value={newServerPrefix}
                    onChange={(e) => setNewServerPrefix(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Transport
                  </label>
                  <select
                    className="input-field"
                    value={newServerTransport}
                    onChange={(e) => setNewServerTransport(e.target.value)}
                  >
                    <option value="http">Streamable HTTP</option>
                    <option value="sse">Server-Sent Events (SSE)</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Endpoint URL
                </label>
                <input
                  id="new-server-url-input"
                  className="input-field"
                  placeholder="http://127.0.0.1:3000/api/mock/mcp-math"
                  value={newServerUrl}
                  onChange={(e) => setNewServerUrl(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowNewServerModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  id="submit-create-server-btn"
                  type="submit"
                  disabled={serverActionLoading}
                  className="btn-primary"
                >
                  {serverActionLoading ? 'Saving...' : 'Add Downstream Server'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Register Gateway */}
      {showNewGatewayModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '680px', maxHeight: '90vh', overflowY: 'auto', padding: '32px' }}>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '8px' }}>
              Register Gateway Instance
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Provision a headless gateway secret. The secret will be hashed and displayed only once.
            </p>

            {generatedSecret ? (
              <div>
                <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--danger)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    ⚠️ Store this key in your secrets manager. It will not be shown again.
                  </span>
                </div>

                <div style={{ background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '14px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                      Cryptographic Gateway Key
                    </span>
                    <code style={{ fontSize: '0.9rem', color: 'var(--primary-text)', fontWeight: 600, wordBreak: 'break-all' }}>
                      {generatedSecret}
                    </code>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(generatedSecret);
                      showBanner('Gateway key copied to clipboard!', 'success');
                    }}
                    className="btn-secondary"
                    style={{ fontSize: '0.78rem', padding: '6px 12px', whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    📋 Copy Key
                  </button>
                </div>

                {renderDeploySnippets(generatedSecret)}

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
                  <button
                    onClick={() => {
                      setShowNewGatewayModal(false);
                      setGeneratedSecret(null);
                      setNewGatewayName('');
                    }}
                    className="btn-primary"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleRegisterGateway} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Gateway Instance Name
                  </label>
                  <input
                    id="gateway-name-input"
                    className="input-field"
                    placeholder="e.g. gateway-us-east-01"
                    value={newGatewayName}
                    onChange={(e) => setNewGatewayName(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                  <button
                    type="button"
                    onClick={() => setShowNewGatewayModal(false)}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    id="submit-register-gateway-btn"
                    type="submit"
                    disabled={gatewayActionLoading}
                    className="btn-primary"
                  >
                    {gatewayActionLoading ? 'Registering...' : 'Generate Secret & Register'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Rotated Gateway Secret */}
      {rotatedSecretModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '680px', maxHeight: '90vh', overflowY: 'auto', padding: '32px' }}>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '8px' }}>
              🔑 Gateway Secret Rotated
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              The secret for gateway <strong>{rotatedSecretModal.gatewayName}</strong> has been regenerated.
            </p>

            <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--danger)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                ⚠️ Store this key in your secrets manager. It will not be shown again. Connected instances must be updated immediately.
              </span>
            </div>

            <div style={{ background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)', padding: '14px 16px', borderRadius: '8px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ overflow: 'hidden' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                  New Gateway Key
                </span>
                <code style={{ fontSize: '0.9rem', color: 'var(--primary-text)', fontWeight: 600, wordBreak: 'break-all' }}>
                  {rotatedSecretModal.secret}
                </code>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(rotatedSecretModal.secret);
                  showBanner('Secret copied to clipboard!', 'success');
                }}
                className="btn-secondary"
                style={{ fontSize: '0.78rem', padding: '6px 12px', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                📋 Copy Key
              </button>
            </div>

            {renderDeploySnippets(rotatedSecretModal.secret)}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
              <button
                onClick={() => setRotatedSecretModal(null)}
                className="btn-primary"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Gateway Deep Inspector */}
      {inspectingGatewayId && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1050,
          padding: '16px'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '1120px',
            maxHeight: '92vh',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--card-hover-shadow)',
            overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '20px 28px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              flexWrap: 'wrap'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1rem'
                  }}>
                    ⚡
                  </div>
                  <h3 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                    AI Gateway Deep Inspector
                  </h3>
                  <code style={{ fontSize: '0.85rem', color: 'var(--accent-cyan)', background: 'rgba(6, 182, 212, 0.12)', padding: '2px 8px', borderRadius: '4px' }}>
                    {inspectingGatewayData?.gateway?.name || 'Loading...'}
                  </code>
                </div>
                {inspectingGatewayData?.gateway && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.78rem' }}>
                    <span className={`badge ${inspectingGatewayData.gateway.is_online ? 'badge-emerald' : 'badge-rose'}`}>
                      {inspectingGatewayData.gateway.is_online ? '🟢 Online (Heartbeat active)' : '⚪ Inactive'}
                    </span>
                    <span className={`badge ${inspectingGatewayData.gateway.mode === 'targeted' ? 'badge-indigo' : 'badge-cyan'}`}>
                      {inspectingGatewayData.gateway.mode === 'targeted' ? '🎯 Targeted Binding Mode' : '🌐 Global Broadcast Mode'}
                    </span>
                    <span className="badge badge-emerald">
                      {inspectingGatewayData.gateway.protocol === 'https' ? '🔒 HTTPS (TLS 1.3 Ready)' : '🌐 HTTP Listener'}
                    </span>
                    <span style={{ color: 'var(--text-dim)' }}>
                      Config Version: <strong style={{ color: '#fff' }}>v{inspectingGatewayData.gateway.applied_config_version}</strong>
                      {inspectingGatewayData.gateway.applied_config_version === inspectingGatewayData.gateway.target_config_version && (
                        <span style={{ color: 'var(--accent-emerald)', marginLeft: '4px' }}>✓ In Sync</span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => {
                    const gw = gatewaysList.find(g => g.id === (inspectingGatewayData?.gateway?.id || inspectingGatewayId) || g.name === (inspectingGatewayData?.gateway?.name || inspectingGatewayId));
                    if (gw) openManageBindings(gw);
                  }}
                  className="btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '6px 10px', color: '#c7d2fe' }}
                  title="Configure mapped projects for this gateway"
                >
                  🔗 Edit Bindings
                </button>
                <button
                  onClick={() => {
                    setInspectingGatewayId(null);
                    setActiveTab('inbound-endpoints');
                  }}
                  className="btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '6px 10px', color: 'var(--accent-cyan)' }}
                  title="Open in dedicated Inbound Endpoints page"
                >
                  🌐 Endpoints View ➔
                </button>
                <button
                  onClick={() => {
                    setInspectingGatewayId(null);
                    setActiveTab('policies');
                  }}
                  className="btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '6px 10px', color: '#10b981' }}
                  title="Open in dedicated Project Policies page"
                >
                  🛡️ Policies Page ➔
                </button>
                <button
                  onClick={() => {
                    setInspectingGatewayId(null);
                    setActiveTab('certificates');
                  }}
                  className="btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '6px 10px', color: '#f59e0b' }}
                  title="Open in dedicated Certificates & Security Hub"
                >
                  🔒 TLS Hub ➔
                </button>
                <button
                  onClick={() => {
                    setInspectingGatewayId(null);
                    setInspectingGatewayData(null);
                  }}
                  className="btn-secondary"
                  style={{ fontSize: '1.1rem', padding: '6px 12px', lineHeight: 1 }}
                  title="Close Inspector"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Sub-Tabs Navigation & Quick Filter */}
            <div style={{
              padding: '12px 28px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap'
            }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setInspectionTab('endpoints')}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    border: inspectionTab === 'endpoints' ? '1px solid var(--primary)' : '1px solid transparent',
                    background: inspectionTab === 'endpoints' ? 'var(--primary-subtle)' : 'transparent',
                    color: inspectionTab === 'endpoints' ? 'var(--primary-text)' : 'var(--text-muted)'
                  }}
                >
                  🌐 Served Endpoints ({inspectingGatewayData?.endpoints?.length || 0})
                </button>

                <button
                  onClick={() => setInspectionTab('downstreams')}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    border: inspectionTab === 'downstreams' ? '1px solid var(--accent)' : '1px solid transparent',
                    background: inspectionTab === 'downstreams' ? '#f0f9ff' : 'transparent',
                    color: inspectionTab === 'downstreams' ? '#0369a1' : 'var(--text-muted)'
                  }}
                >
                  ⚡ Downstream MCP Servers ({
                    inspectingGatewayData?.endpoints?.reduce((acc: number, ep: any) => acc + (ep.downstream_servers?.length || 0), 0) || 0
                  })
                </button>

                <button
                  onClick={() => setInspectionTab('policies')}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    border: inspectionTab === 'policies' ? '1px solid #10b981' : '1px solid transparent',
                    background: inspectionTab === 'policies' ? '#ecfdf5' : 'transparent',
                    color: inspectionTab === 'policies' ? '#047857' : 'var(--text-muted)'
                  }}
                >
                  🛡️ Enforced Policies &amp; Rules
                </button>

                <button
                  onClick={() => setInspectionTab('tls')}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    border: inspectionTab === 'tls' ? '1px solid #f59e0b' : '1px solid transparent',
                    background: inspectionTab === 'tls' ? '#fffbeb' : 'transparent',
                    color: inspectionTab === 'tls' ? '#b45309' : 'var(--text-muted)'
                  }}
                >
                  🔒 Protocol &amp; Certificate Hub
                </button>
              </div>

              <input
                type="text"
                placeholder="Search endpoints, tools, or URLs..."
                value={inspectSearchQuery}
                onChange={(e) => setInspectSearchQuery(e.target.value)}
                className="input-field"
                style={{
                  width: '240px',
                  padding: '6px 12px',
                  fontSize: '0.8rem'
                }}
              />
            </div>

            {/* Modal Body */}
            <div style={{ padding: '24px 28px', overflowY: 'auto', flex: 1 }}>
              {inspectionLoading ? (
                <div style={{ textAlign: 'center', padding: '60px 0' }}>
                  <div className="pulse-dot" style={{ margin: '0 auto 16px', width: '20px', height: '20px' }}></div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Querying gateway configuration graph and telemetry...</p>
                </div>
              ) : !inspectingGatewayData ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-dim)' }}>
                  Failed to load inspection details.
                </div>
              ) : (() => {
                const allEndpoints = inspectingGatewayData.endpoints || [];
                const totalProjectsCount = allEndpoints.length;
                const totalDownstreamServersCount = allEndpoints.reduce((sum: number, ep: any) => sum + (ep.downstream_servers?.length || 0), 0);
                const totalToolPoliciesCount = allEndpoints.reduce((sum: number, ep: any) =>
                  sum + (ep.downstream_servers || []).reduce((sSum: number, s: any) => sSum + (s.tool_policies?.length || 0), 0), 0);
                const totalHttpsServersCount = allEndpoints.reduce((sum: number, ep: any) =>
                  sum + (ep.downstream_servers || []).filter((s: any) => s.protocol === 'https').length, 0);

                const filteredEndpoints = allEndpoints.filter((ep: any) => {
                  if (inspectSelectedProjectId && ep.project_id !== inspectSelectedProjectId) {
                    return false;
                  }
                  if (inspectProtocolFilter === 'https') {
                    const hasHttps = ep.downstream_servers?.some((s: any) => s.protocol === 'https');
                    if (!hasHttps) return false;
                  }
                  if (inspectProtocolFilter === 'http') {
                    const hasHttp = ep.downstream_servers?.some((s: any) => s.protocol === 'http');
                    if (!hasHttp) return false;
                  }
                  if (inspectSearchQuery.trim()) {
                    const q = inspectSearchQuery.toLowerCase();
                    const matchName = ep.project_name.toLowerCase().includes(q);
                    const matchSlug = ep.slug.toLowerCase().includes(q);
                    const matchUrl = ep.endpoint_url.toLowerCase().includes(q);
                    const matchServer = ep.downstream_servers?.some((s: any) =>
                      s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q) || s.namespace_prefix.toLowerCase().includes(q)
                    );
                    const matchTool = ep.downstream_servers?.some((s: any) =>
                      s.tool_policies?.some((tp: any) => tp.tool_name.toLowerCase().includes(q) || (tp.rename && tp.rename.toLowerCase().includes(q)))
                    );
                    return matchName || matchSlug || matchUrl || matchServer || matchTool;
                  }
                  return true;
                });

                return (
                  <div>
                    {/* Multi-Project Summary Stats Bar */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '18px' }}>
                      <div className="glass-panel" style={{ padding: '12px 16px', background: 'var(--bg-surface-subtle)' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Mapped Projects
                        </span>
                        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>
                          {totalProjectsCount}
                        </div>
                      </div>

                      <div className="glass-panel" style={{ padding: '12px 16px', background: 'var(--bg-surface-subtle)' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Upstream MCP Servers
                        </span>
                        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent-cyan)', marginTop: '2px' }}>
                          {totalDownstreamServersCount}
                        </div>
                      </div>

                      <div className="glass-panel" style={{ padding: '12px 16px', background: 'var(--bg-surface-subtle)' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Active Tool Policies
                        </span>
                        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent-emerald)', marginTop: '2px' }}>
                          {totalToolPoliciesCount}
                        </div>
                      </div>

                      <div className="glass-panel" style={{ padding: '12px 16px', background: 'var(--bg-surface-subtle)' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Encrypted Upstreams (TLS)
                        </span>
                        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: totalHttpsServersCount > 0 ? 'var(--accent-emerald)' : '#f59e0b', marginTop: '2px' }}>
                          {totalHttpsServersCount} / {totalDownstreamServersCount}
                        </div>
                      </div>
                    </div>

                    {/* Interactive Project Scope Selector (Horizontal Pills) */}
                    <div style={{
                      background: 'var(--bg-surface-subtle)',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-subtle)',
                      marginBottom: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      flexWrap: 'wrap'
                    }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginRight: '4px' }}>
                        Project Scope:
                      </span>

                      <button
                        onClick={() => setInspectSelectedProjectId('')}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '0.76rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          border: inspectSelectedProjectId === '' ? '1px solid var(--accent-cyan)' : '1px solid rgba(255, 255, 255, 0.1)',
                          background: inspectSelectedProjectId === '' ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                          color: inspectSelectedProjectId === '' ? '#fff' : 'var(--text-muted)'
                        }}
                      >
                        🌐 All Projects ({totalProjectsCount})
                      </button>

                      {allEndpoints.map((ep: any) => (
                        <button
                          key={ep.project_id}
                          onClick={() => setInspectSelectedProjectId(ep.project_id)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            border: inspectSelectedProjectId === ep.project_id ? '1px solid var(--accent-indigo)' : '1px solid rgba(255, 255, 255, 0.08)',
                            background: inspectSelectedProjectId === ep.project_id ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.03)',
                            color: inspectSelectedProjectId === ep.project_id ? '#fff' : 'var(--text-muted)'
                          }}
                        >
                          <span>{ep.project_name}</span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--accent-cyan)', background: 'var(--bg-surface-subtle)', padding: '1px 5px', borderRadius: '4px' }}>
                            {ep.downstream_servers?.length || 0}
                          </span>
                        </button>
                      ))}

                      {inspectSelectedProjectId && (
                        <button
                          onClick={() => setInspectSelectedProjectId('')}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#fda4af',
                            fontSize: '0.74rem',
                            cursor: 'pointer',
                            marginLeft: 'auto'
                          }}
                        >
                          ✕ Clear Project Filter
                        </button>
                      )}
                    </div>

                    {/* Filter Bar & View Toggle */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '16px',
                      flexWrap: 'wrap',
                      gap: '10px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>Protocol Filter:</span>
                        <button
                          onClick={() => setInspectProtocolFilter('all')}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            cursor: 'pointer',
                            border: inspectProtocolFilter === 'all' ? '1px solid var(--accent-cyan)' : '1px solid rgba(255,255,255,0.08)',
                            background: inspectProtocolFilter === 'all' ? 'rgba(6,182,212,0.2)' : 'transparent',
                            color: inspectProtocolFilter === 'all' ? '#fff' : 'var(--text-muted)'
                          }}
                        >
                          All Protocols
                        </button>
                        <button
                          onClick={() => setInspectProtocolFilter('https')}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            cursor: 'pointer',
                            border: inspectProtocolFilter === 'https' ? '1px solid var(--accent-emerald)' : '1px solid rgba(255,255,255,0.08)',
                            background: inspectProtocolFilter === 'https' ? 'rgba(16,185,129,0.2)' : 'transparent',
                            color: inspectProtocolFilter === 'https' ? 'var(--accent-emerald)' : 'var(--text-muted)'
                          }}
                        >
                          🔒 HTTPS Only
                        </button>
                        <button
                          onClick={() => setInspectProtocolFilter('http')}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            cursor: 'pointer',
                            border: inspectProtocolFilter === 'http' ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.08)',
                            background: inspectProtocolFilter === 'http' ? 'rgba(245,158,11,0.2)' : 'transparent',
                            color: inspectProtocolFilter === 'http' ? '#f59e0b' : 'var(--text-muted)'
                          }}
                        >
                          🌐 HTTP Only
                        </button>
                      </div>

                      {inspectionTab === 'endpoints' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>View Mode:</span>
                          <button
                            onClick={() => setInspectViewMode('table')}
                            style={{
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontSize: '0.72rem',
                              cursor: 'pointer',
                              border: inspectViewMode === 'table' ? '1px solid var(--accent-indigo)' : '1px solid rgba(255,255,255,0.08)',
                              background: inspectViewMode === 'table' ? 'rgba(99,102,241,0.2)' : 'transparent',
                              color: inspectViewMode === 'table' ? '#fff' : 'var(--text-muted)'
                            }}
                          >
                            📋 Compact Table
                          </button>
                          <button
                            onClick={() => setInspectViewMode('cards')}
                            style={{
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontSize: '0.72rem',
                              cursor: 'pointer',
                              border: inspectViewMode === 'cards' ? '1px solid var(--accent-indigo)' : '1px solid rgba(255,255,255,0.08)',
                              background: inspectViewMode === 'cards' ? 'rgba(99,102,241,0.2)' : 'transparent',
                              color: inspectViewMode === 'cards' ? '#fff' : 'var(--text-muted)'
                            }}
                          >
                            🗂️ Cards Flow
                          </button>
                        </div>
                      )}
                    </div>

                    {/* TAB 1: SERVED ENDPOINTS */}
                    {inspectionTab === 'endpoints' && (
                      <div>
                        {filteredEndpoints.length > 0 ? (
                          inspectViewMode === 'table' ? (
                            /* HIGH DENSITY TABLE VIEW FOR MULTI-PROJECTS */
                            <div style={{ background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '10px', overflow: 'hidden' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                                <thead>
                                  <tr style={{ background: 'var(--bg-surface-subtle)', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                                    <th style={{ padding: '10px 14px' }}>Project Name &amp; Slug</th>
                                    <th style={{ padding: '10px 14px' }}>Inbound Endpoint URL</th>
                                    <th style={{ padding: '10px 14px' }}>Inbound Auth</th>
                                    <th style={{ padding: '10px 14px' }}>Upstream Servers</th>
                                    <th style={{ padding: '10px 14px' }}>Outbound Security</th>
                                    <th style={{ padding: '10px 14px' }}>Rate Limit</th>
                                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>Action</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredEndpoints.map((ep: any) => (
                                    <tr
                                      key={ep.project_id}
                                      style={{
                                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                        background: inspectSelectedProjectId === ep.project_id ? 'rgba(99, 102, 241, 0.1)' : 'transparent'
                                      }}
                                    >
                                      <td style={{ padding: '10px 14px' }}>
                                        <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{ep.project_name}</div>
                                        <code style={{ fontSize: '0.72rem', color: 'var(--accent-cyan)' }}>/{ep.slug}</code>
                                      </td>
                                      <td style={{ padding: '10px 14px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                          <code style={{ fontSize: '0.74rem', color: 'var(--text-main)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {ep.endpoint_url}
                                          </code>
                                          <button
                                            onClick={() => copyToClipboard(ep.endpoint_url, `ep-${ep.project_id}`)}
                                            className="btn-secondary"
                                            style={{ fontSize: '0.68rem', padding: '2px 6px' }}
                                            title="Copy URL"
                                          >
                                            {copiedKey === `ep-${ep.project_id}` ? '✓' : '📋'}
                                          </button>
                                        </div>
                                      </td>
                                      <td style={{ padding: '10px 14px' }}>
                                        <span className="badge badge-indigo" style={{ fontSize: '0.68rem' }}>
                                          {ep.inbound_auth?.mode?.toUpperCase() || 'NONE'}
                                        </span>
                                      </td>
                                      <td style={{ padding: '10px 14px' }}>
                                        <span className="badge badge-emerald" style={{ fontSize: '0.68rem' }}>
                                          {ep.downstream_servers?.length || 0} MCP Servers
                                        </span>
                                      </td>
                                      <td style={{ padding: '10px 14px' }}>
                                        {ep.downstream_servers?.some((s: any) => s.protocol === 'https') ? (
                                          <span className="badge badge-emerald" style={{ fontSize: '0.68rem' }}>🔒 HTTPS</span>
                                        ) : (
                                          <span className="badge badge-amber" style={{ fontSize: '0.68rem' }}>🌐 HTTP</span>
                                        )}
                                      </td>
                                      <td style={{ padding: '10px 14px', color: 'var(--text-dim)', fontSize: '0.74rem' }}>
                                        {ep.rate_limits?.requests_per_minute || 600} req/m
                                      </td>
                                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                                        <button
                                          onClick={() => {
                                            setInspectSelectedProjectId(ep.project_id);
                                            setInspectionTab('downstreams');
                                          }}
                                          className="btn-secondary"
                                          style={{ fontSize: '0.72rem', padding: '3px 8px', color: 'var(--accent-cyan)' }}
                                        >
                                          Inspect Downstreams ➔
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            /* DETAILED CARDS VIEW */
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                              {filteredEndpoints.map((ep: any) => (
                                <div
                                  key={ep.project_id}
                                  className="glass-panel"
                                  style={{
                                    padding: '18px 22px',
                                    background: 'var(--bg-surface-subtle)',
                                    border: '1px solid var(--border-subtle)',
                                    borderRadius: '10px'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                      <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>
                                        {ep.project_name}
                                      </h4>
                                      <span className="badge badge-cyan" style={{ fontSize: '0.7rem' }}>
                                        /{ep.slug}
                                      </span>
                                      <span className={`badge ${ep.status === 'active' ? 'badge-emerald' : 'badge-rose'}`} style={{ fontSize: '0.68rem' }}>
                                        {ep.status}
                                      </span>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem' }}>
                                      <span className="badge badge-indigo">
                                        Auth: {ep.inbound_auth?.mode?.toUpperCase() || 'NONE'}
                                      </span>
                                      <span className="badge badge-emerald">
                                        {ep.downstream_servers?.length || 0} Downstream MCPs
                                      </span>
                                    </div>
                                  </div>

                                  {/* Endpoint URL Bar */}
                                  <div style={{
                                    background: 'var(--bg-surface)',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    padding: '10px 14px',
                                    borderRadius: '8px',
                                    marginBottom: '10px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '12px'
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                        MCP Protocol URL:
                                      </span>
                                      <code style={{ fontSize: '0.84rem', color: 'var(--accent-cyan)', wordBreak: 'break-all' }}>
                                        {ep.endpoint_url}
                                      </code>
                                    </div>
                                    <button
                                      onClick={() => copyToClipboard(ep.endpoint_url, `ep-${ep.project_id}`)}
                                      className="btn-secondary"
                                      style={{ fontSize: '0.72rem', padding: '3px 8px', whiteSpace: 'nowrap' }}
                                    >
                                      {copiedKey === `ep-${ep.project_id}` ? '✓ Copied' : '📋 Copy URL'}
                                    </button>
                                  </div>

                                  {/* OAuth Discovery Bar */}
                                  <div style={{
                                    background: 'var(--bg-surface-subtle)',
                                    border: '1px solid rgba(255, 255, 255, 0.05)',
                                    padding: '8px 14px',
                                    borderRadius: '6px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '12px',
                                    fontSize: '0.76rem'
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                                      <span style={{ color: 'var(--text-dim)' }}>OAuth Discovery:</span>
                                      <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        {ep.oauth_discovery_url}
                                      </code>
                                    </div>
                                    <button
                                      onClick={() => copyToClipboard(ep.oauth_discovery_url, `oa-${ep.project_id}`)}
                                      className="btn-secondary"
                                      style={{ fontSize: '0.68rem', padding: '2px 6px', whiteSpace: 'nowrap' }}
                                    >
                                      {copiedKey === `oa-${ep.project_id}` ? '✓ Copied' : '📋 Copy'}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        ) : (
                          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                            No endpoints match the selected project/protocol filters.
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB 2: DOWNSTREAM MCP CONNECTIONS */}
                    {inspectionTab === 'downstreams' && (
                      <div>
                        {filteredEndpoints.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {filteredEndpoints.map((ep: any) => (
                              <div key={ep.project_id} style={{ background: 'var(--bg-surface)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                                  <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                                    Project: {ep.project_name} ({ep.downstream_servers?.length || 0} Upstream Servers)
                                  </h4>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                                    Prefix Namespace Isolations Enforced
                                  </span>
                                </div>

                                {ep.downstream_servers && ep.downstream_servers.length > 0 ? (
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                                    {ep.downstream_servers
                                      .filter((s: any) =>
                                        !inspectSearchQuery ||
                                        s.name.toLowerCase().includes(inspectSearchQuery.toLowerCase()) ||
                                        s.url.toLowerCase().includes(inspectSearchQuery.toLowerCase()) ||
                                        s.namespace_prefix.toLowerCase().includes(inspectSearchQuery.toLowerCase())
                                      )
                                      .map((s: any) => (
                                        <div
                                          key={s.id}
                                          style={{
                                            background: 'var(--bg-surface-subtle)',
                                            border: '1px solid rgba(255, 255, 255, 0.07)',
                                            borderRadius: '8px',
                                            padding: '14px'
                                          }}
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#fff' }}>
                                              {s.name}
                                            </div>
                                            <span className={`badge ${s.protocol === 'https' ? 'badge-emerald' : 'badge-cyan'}`} style={{ fontSize: '0.68rem' }}>
                                              {s.protocol === 'https' ? '🔒 HTTPS' : '🌐 HTTP'}
                                            </span>
                                          </div>

                                          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '8px' }}>
                                            Prefix: <code style={{ color: 'var(--accent-indigo)' }}>{s.namespace_prefix || 'none'}</code> • Transport: <strong style={{ color: '#fff' }}>{s.transport}</strong>
                                          </div>

                                          <div style={{
                                            background: 'var(--bg-surface-subtle)',
                                            padding: '6px 8px',
                                            borderRadius: '4px',
                                            fontSize: '0.72rem',
                                            color: 'var(--text-muted)',
                                            wordBreak: 'break-all',
                                            marginBottom: '10px'
                                          }}>
                                            {s.url}
                                          </div>

                                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                                            <span>Timeouts: {s.timeouts?.dial_ms || 5000}ms / {s.timeouts?.call_ms || 15000}ms</span>
                                            <span>Auth: {s.auth_type?.toUpperCase() || 'NONE'}</span>
                                          </div>

                                          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                                            <span style={{ color: 'var(--text-dim)' }}>Tool Policies:</span>
                                            <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                                              {s.tool_policies?.length || 0} Managed Rules
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                  </div>
                                ) : (
                                  <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                                    No upstream MCP servers attached to this project.
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                            No upstream connections match the active filters.
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB 3: ENFORCED POLICIES & RULES */}
                    {inspectionTab === 'policies' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {filteredEndpoints.length > 0 ? (
                          filteredEndpoints.map((ep: any) => (
                            <div key={ep.project_id} style={{ background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '18px' }}>
                              <h4 style={{ margin: '0 0 14px 0', fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>
                                Policy Stack for {ep.project_name}
                              </h4>

                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', marginBottom: '16px' }}>
                                {/* Inbound Auth Policy Card */}
                                <div style={{ background: 'var(--bg-surface-subtle)', padding: '12px 14px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                                    INBOUND AUTHENTICATION
                                  </div>
                                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent-cyan)', marginBottom: '4px' }}>
                                    Mode: {ep.inbound_auth?.mode?.toUpperCase() || 'NONE'}
                                  </div>
                                  {ep.inbound_auth?.issuer && (
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', wordBreak: 'break-all' }}>
                                      Issuer: {ep.inbound_auth.issuer}
                                    </div>
                                  )}
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '4px' }}>
                                    Required Scopes: {ep.inbound_auth?.required_scopes?.join(', ') || 'mcp:tools, mcp:read'}
                                  </div>
                                </div>

                                {/* Traffic Guardrails Card */}
                                <div style={{ background: 'var(--bg-surface-subtle)', padding: '12px 14px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                                    TRAFFIC &amp; RATE GUARDRAILS
                                  </div>
                                  <div style={{ fontSize: '0.82rem', color: 'var(--text-main)', marginBottom: '4px' }}>
                                    Rate Limit: <strong style={{ color: '#fff' }}>{ep.rate_limits?.requests_per_minute || 600} req/min</strong>
                                  </div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                                    Burst Capacity: {ep.rate_limits?.burst || 50} tokens
                                  </div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '2px' }}>
                                    Circuit Breaker: Trip on {ep.circuit_breaker?.max_failures || 5} consecutive errors ({ep.circuit_breaker?.recovery_seconds || 30}s recovery)
                                  </div>
                                </div>
                              </div>

                              {/* Tool Policies Table */}
                              <div style={{ marginTop: '10px' }}>
                                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>
                                  UPSTREAM TOOL POLICIES &amp; TRANSFORMS
                                </div>

                                {ep.downstream_servers?.some((s: any) => s.tool_policies?.length > 0) ? (
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                                    <thead>
                                      <tr style={{ background: 'var(--bg-surface-subtle)', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                                        <th style={{ padding: '8px 10px' }}>Server Prefix</th>
                                        <th style={{ padding: '8px 10px' }}>Tool Name</th>
                                        <th style={{ padding: '8px 10px' }}>Policy Status</th>
                                        <th style={{ padding: '8px 10px' }}>Gateway Alias / Rename</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {ep.downstream_servers.flatMap((s: any) =>
                                        (s.tool_policies || []).map((tp: any, idx: number) => (
                                          <tr key={`${s.id}-${idx}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                            <td style={{ padding: '8px 10px', color: 'var(--accent-indigo)' }}>
                                              <code>{s.namespace_prefix || 'root'}</code>
                                            </td>
                                            <td style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text-main)' }}>
                                              {tp.tool_name}
                                            </td>
                                            <td style={{ padding: '8px 10px' }}>
                                              <span className={`badge ${tp.enabled ? 'badge-emerald' : 'badge-rose'}`} style={{ fontSize: '0.68rem' }}>
                                                {tp.enabled ? '✓ Allowed' : '✕ Blocked'}
                                              </span>
                                            </td>
                                            <td style={{ padding: '8px 10px', color: tp.rename ? 'var(--accent-cyan)' : 'var(--text-dim)' }}>
                                              {tp.rename ? <code>{tp.rename}</code> : 'Original Name'}
                                            </td>
                                          </tr>
                                        ))
                                      )}
                                    </tbody>
                                  </table>
                                ) : (
                                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', fontStyle: 'italic', padding: '8px' }}>
                                    All upstream tools implicitly passed through with namespace prefixes.
                                  </div>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                            No policies match the active filters.
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB 4: PROTOCOL & CERTIFICATE HUB */}
                    {inspectionTab === 'tls' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px' }}>
                          {/* Inbound TLS Panel */}
                          <div style={{
                            background: 'var(--bg-surface)',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            borderRadius: '12px',
                            padding: '20px'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '1.2rem' }}>🔒</span>
                                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                                  Inbound Gateway Listener Security
                                </h4>
                              </div>
                              <span className="badge badge-emerald">
                                {inspectingGatewayData.gateway.protocol?.toUpperCase()}
                              </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.8rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '6px' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Inbound Port:</span>
                                <strong style={{ color: '#fff' }}>:8080 (Data Plane)</strong>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '6px' }}>
                                <span style={{ color: 'var(--text-muted)' }}>TLS Protocol Version:</span>
                                <span className="badge badge-cyan" style={{ fontSize: '0.7rem' }}>
                                  {inspectingGatewayData.gateway.tls_telemetry?.inbound?.min_version || 'TLS 1.2 / TLS 1.3'}
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '6px' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Certificate Mode:</span>
                                <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                                  {inspectingGatewayData.gateway.tls_telemetry?.inbound?.cert_mode === 'auto_cert'
                                    ? 'ECDSA P-256 Auto-Cert'
                                    : (inspectingGatewayData.gateway.tls_telemetry?.inbound?.cert_mode === 'custom_file' ? 'Custom PEM Certificate' : 'HTTP Mode')}
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '6px' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Configured SANs:</span>
                                <span style={{ color: 'var(--accent-cyan)' }}>
                                  {inspectingGatewayData.gateway.tls_telemetry?.inbound?.sans?.join(', ') || 'localhost, 127.0.0.1, ::1'}
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '6px' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Inbound Client Auth (mTLS):</span>
                                <span className="badge badge-indigo" style={{ fontSize: '0.7rem' }}>
                                  {inspectingGatewayData.gateway.tls_telemetry?.inbound?.client_auth || 'None (Standard Client TLS)'}
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Client CA Bundle:</span>
                                <span style={{ color: inspectingGatewayData.gateway.tls_telemetry?.inbound?.has_client_ca ? 'var(--accent-emerald)' : 'var(--text-dim)' }}>
                                  {inspectingGatewayData.gateway.tls_telemetry?.inbound?.has_client_ca ? 'Mounted & Verified' : 'Standard Web PKI'}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Outbound Downstream TLS Panel */}
                          <div style={{
                            background: 'var(--bg-surface)',
                            border: '1px solid rgba(6, 182, 212, 0.3)',
                            borderRadius: '12px',
                            padding: '20px'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '1.2rem' }}>🌐</span>
                                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                                  Outbound Downstream MCP Security
                                </h4>
                              </div>
                              <span className="badge badge-cyan">
                                Downstream Pool
                              </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.8rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '6px' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Transport Architecture:</span>
                                <strong style={{ color: '#fff' }}>SafeDialContext + TLSClientConfig</strong>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '6px' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Certificate Verification:</span>
                                <span className={`badge ${inspectingGatewayData.gateway.tls_telemetry?.downstream?.insecure_skip_verify ? 'badge-rose' : 'badge-emerald'}`} style={{ fontSize: '0.7rem' }}>
                                  {inspectingGatewayData.gateway.tls_telemetry?.downstream?.insecure_skip_verify ? '⚠️ InsecureSkipVerify Active' : '🔒 Strict Chain Verification'}
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '6px' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Custom Downstream CA Pool:</span>
                                <span style={{ color: inspectingGatewayData.gateway.tls_telemetry?.downstream?.has_custom_ca ? 'var(--accent-emerald)' : 'var(--text-dim)' }}>
                                  {inspectingGatewayData.gateway.tls_telemetry?.downstream?.has_custom_ca ? 'Configured (DOWNSTREAM_CA_CERT_FILE)' : 'System Root CA Bundle'}
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '6px' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Downstream Mutual TLS (mTLS):</span>
                                <span style={{ color: inspectingGatewayData.gateway.tls_telemetry?.downstream?.has_client_cert ? 'var(--accent-emerald)' : 'var(--text-dim)' }}>
                                  {inspectingGatewayData.gateway.tls_telemetry?.downstream?.has_client_cert ? 'Client Certificate & Key Active' : 'None (Standard One-way TLS)'}
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Downstream Min TLS Version:</span>
                                <strong style={{ color: 'var(--accent-cyan)' }}>
                                  {inspectingGatewayData.gateway.tls_telemetry?.downstream?.min_version || 'TLS 1.2'}
                                </strong>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Detailed Connection Security Matrix */}
                        <div style={{ background: 'var(--bg-surface-subtle)', borderRadius: '10px', padding: '16px', border: '1px solid var(--border-subtle)' }}>
                          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '12px' }}>
                            DOWNSTREAM SERVER ENCRYPTION STATUS
                          </div>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                            <thead>
                              <tr style={{ background: 'var(--bg-surface-subtle)', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                                <th style={{ padding: '8px 10px' }}>Upstream MCP Server</th>
                                <th style={{ padding: '8px 10px' }}>Target URL</th>
                                <th style={{ padding: '8px 10px' }}>Scheme</th>
                                <th style={{ padding: '8px 10px' }}>Encryption &amp; Security</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredEndpoints.flatMap((ep: any) =>
                                (ep.downstream_servers || []).map((s: any) => (
                                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                    <td style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text-main)' }}>
                                      {s.name} <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>({ep.project_name})</span>
                                    </td>
                                    <td style={{ padding: '8px 10px', color: 'var(--accent-cyan)' }}>
                                      <code>{s.url}</code>
                                    </td>
                                    <td style={{ padding: '8px 10px' }}>
                                      <span className={`badge ${s.protocol === 'https' ? 'badge-emerald' : 'badge-amber'}`} style={{ fontSize: '0.68rem' }}>
                                        {s.protocol?.toUpperCase()}
                                      </span>
                                    </td>
                                    <td style={{ padding: '8px 10px' }}>
                                      {s.protocol === 'https' ? (
                                        <span style={{ color: 'var(--accent-emerald)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                          <span>🔒</span> TLS Encrypted
                                        </span>
                                      ) : (
                                        <span style={{ color: 'var(--text-muted)' }}>
                                          Plaintext HTTP (Internal Network)
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '14px 28px',
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span style={{ fontSize: '0.76rem', color: 'var(--text-dim)' }}>
                Gateway ID: <code style={{ color: 'var(--accent-indigo)' }}>{inspectingGatewayData?.gateway?.id || inspectingGatewayId}</code>
              </span>
              <button
                onClick={() => {
                  setInspectingGatewayId(null);
                  setInspectingGatewayData(null);
                }}
                className="btn-primary"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MANAGE PROJECT BINDINGS MODAL */}
      {bindingGateway && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="glass-panel" style={{
            maxWidth: '620px',
            width: '100%',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--card-hover-shadow)'
          }}>
            {/* Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--bg-surface-subtle)'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '1.3rem' }}>🔗</span>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                    Map Projects to Gateway
                  </h3>
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Configure which project endpoints are hosted and served by{' '}
                  <strong style={{ color: 'var(--primary-text)' }}>{bindingGateway.name}</strong>
                </div>
              </div>
              <button
                onClick={() => setBindingGateway(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '1.2rem',
                  cursor: 'pointer',
                  padding: '4px 8px'
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Routing Mode Choice */}
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px', display: 'block' }}>
                  Gateway Routing &amp; Binding Mode
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div
                    onClick={() => setBindingSelectedMode('global')}
                    style={{
                      padding: '14px',
                      borderRadius: 'var(--radius-md)',
                      border: bindingSelectedMode === 'global' ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                      background: bindingSelectedMode === 'global' ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <input
                        type="radio"
                        checked={bindingSelectedMode === 'global'}
                        onChange={() => setBindingSelectedMode('global')}
                      />
                      <strong style={{ fontSize: '0.88rem', color: 'var(--text-main)' }}>🌐 Global Mode</strong>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, paddingLeft: '22px' }}>
                      Gateway hosts <strong>all active projects</strong> ({projects.length}) in the organization dynamically.
                    </p>
                  </div>

                  <div
                    onClick={() => setBindingSelectedMode('targeted')}
                    style={{
                      padding: '14px',
                      borderRadius: 'var(--radius-md)',
                      border: bindingSelectedMode === 'targeted' ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                      background: bindingSelectedMode === 'targeted' ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <input
                        type="radio"
                        checked={bindingSelectedMode === 'targeted'}
                        onChange={() => setBindingSelectedMode('targeted')}
                      />
                      <strong style={{ fontSize: '0.88rem', color: 'var(--text-main)' }}>🎯 Targeted Mode</strong>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, paddingLeft: '22px' }}>
                      Gateway strictly isolates and serves only explicitly selected projects.
                    </p>
                  </div>
                </div>
              </div>

              {/* Projects Selection List */}
              {bindingSelectedMode === 'targeted' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      Select Target Projects ({bindingSelectedProjectIds.length} of {projects.length} selected):
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => setBindingSelectedProjectIds(projects.map(p => p.id))}
                        className="btn-secondary"
                        style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                      >
                        Select All
                      </button>
                      <button
                        onClick={() => setBindingSelectedProjectIds([])}
                        className="btn-secondary"
                        style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                      >
                        Clear All
                      </button>
                    </div>
                  </div>

                  <div style={{
                    maxHeight: '260px',
                    overflowY: 'auto',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-surface-subtle)',
                    padding: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    {projects.map((p) => {
                      const isSelected = bindingSelectedProjectIds.includes(p.id);
                      return (
                        <div
                          key={p.id}
                          onClick={() => {
                            if (isSelected) {
                              setBindingSelectedProjectIds(bindingSelectedProjectIds.filter(id => id !== p.id));
                            } else {
                              setBindingSelectedProjectIds([...bindingSelectedProjectIds, p.id]);
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 12px',
                            borderRadius: 'var(--radius-sm)',
                            background: isSelected ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                            border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                            cursor: 'pointer',
                            transition: 'all 0.12s ease'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}} // handled by parent div onClick
                              style={{ cursor: 'pointer' }}
                            />
                            <div>
                              <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.85rem' }}>
                                {p.name}
                              </div>
                              <code style={{ fontSize: '0.72rem', color: 'var(--primary-text)' }}>
                                /p/{p.slug}/mcp
                              </code>
                            </div>
                          </div>
                          <span className="badge badge-indigo" style={{ fontSize: '0.7rem' }}>
                            {p.servers?.length ?? p.server_count ?? 0} Upstream MCPs
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Status Note */}
              <div style={{
                background: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px',
                fontSize: '0.8rem',
                color: 'var(--text-muted)'
              }}>
                <span style={{ color: 'var(--primary-text)', fontWeight: 600 }}>💡 Fleet Routing Note: </span>
                {bindingSelectedMode === 'global' ? (
                  <span>
                    In <strong>Global Mode</strong>, gateway <code>{bindingGateway.name}</code> handles all inbound traffic across every project and automatically registers newly created projects.
                  </span>
                ) : (
                  <span>
                    In <strong>Targeted Mode</strong>, this gateway will <strong>strictly route</strong> to the {bindingSelectedProjectIds.length} project(s) chosen above. Requests for unmapped projects will return 404 Route Not Bound.
                  </span>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '10px'
            }}>
              <button
                onClick={() => setBindingGateway(null)}
                className="btn-secondary"
                disabled={bindingSaving}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBindings}
                className="btn-primary"
                disabled={bindingSaving}
              >
                {bindingSaving ? 'Saving...' : '💾 Save Bindings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
