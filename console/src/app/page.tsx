'use client';

import React, { useState, useEffect } from 'react';

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
        body: JSON.stringify({ name: newProjectName, slug: newProjectSlug }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowNewProjectModal(false);
        setNewProjectName('');
        setNewProjectSlug('');
        await loadProjects();
        setSelectedProjectId(data.project.id);
        showBanner(`Project "${data.project.name}" created successfully!`, 'success');
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
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '14px 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '9px',
            background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.4)'
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
              <span className="brand-font" style={{ fontWeight: 700, fontSize: '1.15rem' }}>AI CONSOLE</span>
              <span className="badge badge-cyan" style={{ fontSize: '0.65rem' }}>Control Plane</span>
              <span className="badge badge-emerald" style={{ fontSize: '0.65rem' }}>Phase 2 Ready</span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Org: <strong style={{ color: 'var(--text-muted)' }}>{org?.name || 'Default Enterprise'}</strong>
            </span>
          </div>
        </div>

        {/* User Info & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '9999px',
            padding: '4px 12px 4px 6px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: '#4f46e5',
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
          background: 'rgba(11, 17, 32, 0.6)',
          padding: '24px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          {[
            { id: 'projects', label: 'Projects & Virtual MCP', icon: '📁' },
            { id: 'mcp-servers', label: 'Downstream MCPs', icon: '🔌' },
            { id: 'gateways', label: 'Gateway Fleet', icon: '🌐' },
            { id: 'oauth', label: 'OAuth & Secrets', icon: '🛡️' },
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
                padding: '10px 14px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === item.id ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                color: activeTab === item.id ? '#a5b4fc' : 'var(--text-muted)',
                fontWeight: activeTab === item.id ? 600 : 400,
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
        <main style={{ flex: 1, padding: '32px 36px', overflowY: 'auto' }}>
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
                      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, color: '#f8fafc' }}>{proj.name}</h3>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <span className="badge badge-cyan">v{proj.config_version}</span>
                        <span className="badge badge-emerald">{proj.status}</span>
                      </div>
                    </div>

                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px' }}>
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
                      background: 'rgba(15, 23, 42, 0.9)',
                      border: '1px solid var(--border-subtle)',
                      color: '#f8fafc',
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
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc', marginBottom: '16px' }}>
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
                            <h4 style={{ fontSize: '1.15rem', fontWeight: 600, color: '#f8fafc' }}>{srv.name}</h4>
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

                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px 12px', borderRadius: '6px', marginBottom: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                      <h3 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#f8fafc', marginBottom: '4px' }}>
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
                        background: 'rgba(255, 255, 255, 0.02)',
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
                        <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: '#f8fafc' }}>{gw.name}</h3>
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
                        <span>Applied Config:</span>
                        <span className="badge badge-cyan">v{gw.applied_config_version || 1}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Last Seen / Heartbeat:</span>
                        <span style={{ color: 'var(--accent-cyan)' }}>
                          {gw.last_seen_at ? new Date(gw.last_seen_at).toLocaleTimeString() : 'Awaiting heartbeat'}
                        </span>
                      </div>
                    </div>

                    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                        Protocol: HTTPS Polling
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
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
                  <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#f8fafc', marginTop: '4px' }}>
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
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'rgba(255, 255, 255, 0.02)' }}>
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
                                borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
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
                              <td style={{ padding: '12px 16px', color: '#f8fafc', fontWeight: 500 }}>
                                {log.project}
                              </td>
                              <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>
                                {log.mcp_server || '—'}
                              </td>
                              <td style={{ padding: '12px 16px', color: log.tool ? 'var(--accent-cyan)' : 'var(--text-dim)' }}>
                                {log.tool || 'initialize / list'}
                              </td>
                              <td style={{ padding: '12px 16px', color: '#f8fafc', fontFamily: 'monospace' }}>
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
                              <tr style={{ background: 'rgba(15, 23, 42, 0.6)', borderBottom: '1px solid var(--border-subtle)' }}>
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
                                        <pre style={{ background: 'rgba(0,0,0,0.4)', padding: '10px', borderRadius: '6px', fontSize: '0.75rem', color: '#a78bfa', overflowX: 'auto', margin: 0 }}>
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
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'rgba(255, 255, 255, 0.02)' }}>
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
                                borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                                cursor: 'pointer',
                                background: isExpanded ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                                transition: 'background 0.15s ease',
                              }}
                            >
                              <td style={{ padding: '12px 16px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                                {new Date(log.timestamp).toLocaleString()}
                              </td>
                              <td style={{ padding: '12px 16px', color: '#f8fafc', fontWeight: 500 }}>
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
                              <tr style={{ background: 'rgba(15, 23, 42, 0.6)', borderBottom: '1px solid var(--border-subtle)' }}>
                                <td colSpan={5} style={{ padding: '16px 24px' }}>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '6px' }}>MUTATION DIFF (SECRETS REDACTED)</div>
                                  <pre style={{ background: 'rgba(0,0,0,0.5)', padding: '12px', borderRadius: '8px', fontSize: '0.8rem', color: '#38bdf8', overflowX: 'auto', margin: 0 }}>
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

          {/* Other Tabs */}
          {activeTab !== 'projects' && activeTab !== 'mcp-servers' && activeTab !== 'gateways' && activeTab !== 'logs' && activeTab !== 'audit' && (
            <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🚧</div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px' }}>
                Module Scheduled in Roadmap
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '480px', margin: '0 auto' }}>
                This section is part of upcoming implementation phases according to Section 11 of the architecture plan.
              </p>
            </div>
          )}
        </main>
      </div>

      {/* MODAL: Create Project */}
      {showNewProjectModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '480px', padding: '32px' }}>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
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
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '520px', padding: '32px' }}>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
              Add Downstream MCP Server
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Register an upstream MCP server to merge into this project's tool catalog.
            </p>

            {/* Quick Presets */}
            <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px', borderRadius: '8px', marginBottom: '18px' }}>
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
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', padding: '32px' }}>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
              Register Gateway Instance
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Provision a headless gateway secret. The secret will be hashed and displayed only once.
            </p>

            {generatedSecret ? (
              <div>
                <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
                  <span style={{ fontSize: '0.8rem', color: '#34d399', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                    GATEWAY SECRET GENERATED:
                  </span>
                  <code style={{ fontSize: '0.95rem', color: '#ffffff', wordBreak: 'break-all', display: 'block', background: 'rgba(0,0,0,0.4)', padding: '10px', borderRadius: '6px' }}>
                    {generatedSecret}
                  </code>
                  <span style={{ fontSize: '0.75rem', color: '#fda4af', display: 'block', marginTop: '8px' }}>
                    ⚠️ Copy this secret now. It will never be displayed again.
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '520px', padding: '32px' }}>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
              🔑 Gateway Secret Rotated
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              The secret for gateway <strong>{rotatedSecretModal.gatewayName}</strong> has been regenerated.
            </p>

            <div style={{ background: 'rgba(244, 63, 94, 0.1)', border: '1px solid rgba(244, 63, 94, 0.3)', padding: '12px', borderRadius: '8px', marginBottom: '16px', color: '#fda4af', fontSize: '0.8rem' }}>
              ⚠️ <strong>Save this secret immediately.</strong> It will NEVER be shown again in the console or logs.
            </div>

            <div style={{ background: 'rgba(0,0,0,0.4)', padding: '14px', borderRadius: '8px', marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <code style={{ fontSize: '0.95rem', color: 'var(--accent-cyan)', wordBreak: 'break-all' }}>
                {rotatedSecretModal.secret}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(rotatedSecretModal.secret);
                  showBanner('Secret copied to clipboard!', 'success');
                }}
                className="btn-secondary"
                style={{ fontSize: '0.78rem', padding: '4px 8px', marginLeft: '12px', whiteSpace: 'nowrap' }}
              >
                📋 Copy
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
    </div>
  );
}
