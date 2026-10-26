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

interface ProjectDetailViewProps {
  project: Project;
  gatewaysList: any[];
  onBack: () => void;
  onUpdateProject: (updatedProject: any) => Promise<void>;
  showBanner: (text: string, type: 'success' | 'error' | 'info') => void;
}

export default function ProjectDetailView({
  project,
  gatewaysList,
  onBack,
  onUpdateProject,
  showBanner,
}: ProjectDetailViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<'auth' | 'tls' | 'downstreams' | 'downstream-auth'>('auth');
  const [isSaving, setIsSaving] = useState(false);
  const [copiedIngress, setCopiedIngress] = useState(false);

  // 1. Inbound Auth State
  const [inboundAuthMode, setInboundAuthMode] = useState<string>(
    project.settings?.inbound_auth_mode || 'oauth_jwt'
  );
  const [tokenIssuer, setTokenIssuer] = useState<string>(
    project.settings?.token_issuer || 'https://auth.aigateway.local/oauth/v2'
  );
  const [audience, setAudience] = useState<string>(
    project.settings?.audience || `https://gateway.corp/p/${project.slug}`
  );
  const [requiredScopes, setRequiredScopes] = useState<string>(
    project.settings?.required_scopes || 'mcp:tools:read, mcp:tools:execute'
  );
  const [redirectUris, setRedirectUris] = useState<string>(
    project.settings?.redirect_uris || 'http://localhost:3000/api/oauth/callback'
  );
  const [jwksUri, setJwksUri] = useState<string>(
    project.settings?.jwks_uri || 'http://localhost:3000/api/mock/idp/.well-known/jwks.json'
  );
  const [tokenTtlSeconds, setTokenTtlSeconds] = useState<number>(
    project.settings?.token_ttl_seconds || 3600
  );

  // 2. Endpoint TLS State
  const [protocol, setProtocol] = useState<'https' | 'http'>(
    project.settings?.tls?.protocol || 'https'
  );
  const [tlsMinVersion, setTlsMinVersion] = useState<'TLS 1.3' | 'TLS 1.2'>(
    project.settings?.tls?.min_version || 'TLS 1.3'
  );
  const [certMode, setCertMode] = useState<'auto_cert' | 'custom_file' | 'self_signed'>(
    project.settings?.tls?.cert_mode || 'auto_cert'
  );
  const [sans, setSans] = useState<string>(
    project.settings?.tls?.sans?.join(', ') || `localhost, 127.0.0.1, ${project.slug}.ai-gateway.local`
  );
  const [certPem, setCertPem] = useState<string>(project.settings?.tls?.cert_pem || '');
  const [keyPem, setKeyPem] = useState<string>(project.settings?.tls?.key_pem || '');
  const [showPrivateKey, setShowPrivateKey] = useState<boolean>(false);

  // 3. Downstream Mappings State (MCP Servers & AI Agents)
  const [downstreams, setDownstreams] = useState<any[]>(
    project.servers?.length ? project.servers : [
      {
        id: 'mock-math-srv',
        name: 'Mock Math Tools',
        type: 'mcp',
        namespace_prefix: 'math',
        transport: 'http',
        url: 'http://127.0.0.1:3000/api/mock/mcp-math',
        enabled: true,
        health_status: 'healthy',
        latency_ms: 8,
      },
      {
        id: 'mock-weather-srv',
        name: 'Mock Weather Service',
        type: 'mcp',
        namespace_prefix: 'weather',
        transport: 'http',
        url: 'http://127.0.0.1:3000/api/mock/mcp-weather',
        enabled: true,
        health_status: 'healthy',
        latency_ms: 12,
      },
      {
        id: 'agent-research-01',
        name: 'Autonomous Research Synthesizer',
        type: 'agent',
        namespace_prefix: 'agent_res',
        transport: 'a2a_sse',
        url: 'http://127.0.0.1:8080/agents/agent-res-01',
        enabled: true,
        health_status: 'healthy',
        latency_ms: 22,
      }
    ]
  );

  // New Downstream Modal State
  const [showAddDownstreamModal, setShowAddDownstreamModal] = useState(false);
  const [newDownstreamName, setNewDownstreamName] = useState('');
  const [newDownstreamType, setNewDownstreamType] = useState<'mcp' | 'agent'>('mcp');
  const [newDownstreamPrefix, setNewDownstreamPrefix] = useState('');
  const [newDownstreamUrl, setNewDownstreamUrl] = useState('');
  const [newDownstreamTransport, setNewDownstreamTransport] = useState('http');
  const [newAgentCardUrl, setNewAgentCardUrl] = useState('');
  const [newAgentCapabilities, setNewAgentCapabilities] = useState('research_synthesis, query_agent');
  const [newAgentDelegationMode, setNewAgentDelegationMode] = useState<'sync_sse' | 'async_queue'>('sync_sse');
  const [newAgentTimeoutMs, setNewAgentTimeoutMs] = useState<number>(60000);
  const [newAgentConcurrency, setNewAgentConcurrency] = useState<number>(5);
  const [newAgentAuthToken, setNewAgentAuthToken] = useState<string>('');
  const [inspectingAgent, setInspectingAgent] = useState<any | null>(null);
  const [simulatedTaskOutput, setSimulatedTaskOutput] = useState<string[]>([]);
  const [isSimulatingTask, setIsSimulatingTask] = useState<boolean>(false);

  // 4. Downstream Outbound Auth State
  const [downstreamAuthMethod, setDownstreamAuthMethod] = useState<string>(
    project.settings?.downstream_auth_method || 'dedicated_client_credentials'
  );
  const [downstreamClientId, setDownstreamClientId] = useState<string>(
    project.settings?.downstream_client_id || 'gateway-downstream-worker'
  );
  const [downstreamClientSecret, setDownstreamClientSecret] = useState<string>(
    project.settings?.downstream_client_secret || 'sec_live_99a8b7c6d5e4f3a2b1'
  );
  const [showDownstreamSecret, setShowDownstreamSecret] = useState(false);
  const [downstreamScopes, setDownstreamScopes] = useState<string>(
    project.settings?.downstream_scopes || 'tools:invoke, context:read'
  );
  const [tokenRefreshInterval, setTokenRefreshInterval] = useState<number>(
    project.settings?.token_refresh_interval || 300
  );

  // Associated Gateway
  const boundGatewayId = project.settings?.gateway_id || gatewaysList[0]?.id || 'gateway-default-01';
  const [selectedGatewayId, setSelectedGatewayId] = useState<string>(boundGatewayId);

  const ingressEndpoint = `${protocol}://localhost:8080/p/${project.slug}/mcp`;

  const copyIngressEndpoint = () => {
    navigator.clipboard.writeText(ingressEndpoint);
    setCopiedIngress(true);
    setTimeout(() => setCopiedIngress(false), 2000);
    showBanner('Ingress endpoint copied to clipboard!', 'info');
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      const updatedProject: Project = {
        ...project,
        settings: {
          ...project.settings,
          gateway_id: selectedGatewayId,
          inbound_auth_mode: inboundAuthMode,
          token_issuer: tokenIssuer,
          audience,
          required_scopes: requiredScopes,
          redirect_uris: redirectUris,
          jwks_uri: jwksUri,
          token_ttl_seconds: tokenTtlSeconds,
          tls: {
            protocol,
            min_version: tlsMinVersion,
            cert_mode: certMode,
            sans: sans.split(',').map(s => s.trim()).filter(Boolean),
            cert_pem: certPem,
            key_pem: keyPem,
          },
          downstream_auth_method: downstreamAuthMethod,
          downstream_client_id: downstreamClientId,
          downstream_client_secret: downstreamClientSecret,
          downstream_scopes: downstreamScopes,
          token_refresh_interval: tokenRefreshInterval,
        },
        servers: downstreams,
        server_count: downstreams.length,
        config_version: (project.config_version || 1) + 1,
      };

      await onUpdateProject(updatedProject);
      showBanner(`Project "${project.name}" configuration saved and synced!`, 'success');
    } catch (err: any) {
      showBanner(err.message || 'Failed to save project settings', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddDownstream = () => {
    if (!newDownstreamName || !newDownstreamUrl) {
      showBanner('Please provide Downstream name and URL', 'error');
      return;
    }
    const newEntry: any = {
      id: `downstream-${Date.now()}`,
      name: newDownstreamName,
      type: newDownstreamType,
      namespace_prefix: newDownstreamPrefix || newDownstreamName.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      transport: newDownstreamTransport,
      url: newDownstreamUrl,
      enabled: true,
      health_status: 'healthy',
      latency_ms: 15,
      ...(newDownstreamType === 'agent' ? {
        agent_card_url: newAgentCardUrl || `${newDownstreamUrl}/.well-known/agent.json`,
        capabilities: newAgentCapabilities.split(',').map(s => s.trim()).filter(Boolean),
        delegation_mode: newAgentDelegationMode,
        timeout_ms: newAgentTimeoutMs,
        concurrency_limit: newAgentConcurrency,
        auth_token: newAgentAuthToken ? '••••••••' : undefined,
      } : {})
    };
    setDownstreams([...downstreams, newEntry]);
    setShowAddDownstreamModal(false);
    setNewDownstreamName('');
    setNewDownstreamPrefix('');
    setNewDownstreamUrl('');
    setNewAgentCardUrl('');
    setNewAgentAuthToken('');
    showBanner(`Mapped ${newDownstreamType === 'mcp' ? 'MCP Server' : 'Autonomous AI Agent'} "${newEntry.name}"!`, 'success');
  };

  const handleSimulateTask = (agent: any) => {
    setIsSimulatingTask(true);
    setSimulatedTaskOutput([
      `[T+0ms] POST /a2a/v1/tasks -> Gateway dispatches task to ${agent.url}`,
      `[T+14ms] Handshake OK (Bearer token verified, traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01)`,
      `[T+38ms] Event: task.created { id: "task-${Date.now().toString().slice(-4)}", state: "RUNNING" }`,
      `[T+160ms] Stream Chunk: "Initializing autonomous agent reasoning loop for capability [${agent.capabilities?.[0] || 'research_synthesis'}]..."`,
      `[T+320ms] Stream Chunk: "Evaluating task context and querying internal memory vector stores..."`,
      `[T+490ms] Event: task.completed { status: "SUCCESS", latency_ms: 490, tokens_processed: 312 }`
    ]);
    setTimeout(() => {
      setIsSimulatingTask(false);
    }, 500);
  };

  const handleRemoveDownstream = (id: string, name: string) => {
    setDownstreams(downstreams.filter(d => d.id !== id));
    showBanner(`Unmapped downstream "${name}"`, 'info');
  };

  const handleToggleDownstream = (id: string) => {
    setDownstreams(downstreams.map(d => d.id === id ? { ...d, enabled: !d.enabled } : d));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Breadcrumb & Action Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px',
        borderBottom: '1px solid var(--border-subtle)',
        paddingBottom: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            onClick={onBack}
            className="btn-secondary"
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
          >
            ← Back to Dashboard
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
                {project.name}
              </h1>
              <span className="badge badge-indigo">v{project.config_version || 1}</span>
              <span className="badge badge-emerald">● {project.status || 'Active'}</span>
            </div>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Unique Project Slug: <strong className="font-mono" style={{ color: 'var(--primary-text)' }}>/{project.slug}</strong>
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Quick Ingress Copy Button */}
          <button
            onClick={copyIngressEndpoint}
            className="btn-secondary"
            style={{ fontSize: '0.82rem', height: '38px', gap: '6px' }}
          >
            <span>{copiedIngress ? '✓ Copied' : '📋 Ingress Endpoint'}</span>
          </button>

          <button
            onClick={handleSaveAll}
            disabled={isSaving}
            className="btn-primary"
            style={{ height: '38px', padding: '0 18px', fontWeight: 600 }}
          >
            {isSaving ? 'Syncing...' : '💾 Save & Enforce Settings'}
          </button>
        </div>
      </div>

      {/* Ingress URL Overview Card */}
      <div className="glass-panel" style={{
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        background: 'var(--bg-surface-subtle)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--primary)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700
          }}>
            ⚡
          </div>
          <div>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              Live Aggregated Ingress Endpoint
            </span>
            <div className="font-mono" style={{ fontSize: '0.9rem', color: 'var(--primary-text)', fontWeight: 600 }}>
              {ingressEndpoint}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 500 }}>
            Associated AI Gateway:
          </label>
          <select
            className="input-field"
            value={selectedGatewayId}
            onChange={(e) => setSelectedGatewayId(e.target.value)}
            style={{ width: '220px', height: '34px', fontSize: '0.82rem' }}
          >
            {gatewaysList.map(gw => (
              <option key={gw.id} value={gw.id}>
                {gw.name} ({gw.status})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Sub-tab Navigation */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-subtle)',
        gap: '8px'
      }}>
        {[
          { id: 'auth', label: '1. Inbound Authentication & Details', icon: '🔑' },
          { id: 'tls', label: '2. Endpoint TLS & Certificates', icon: '🔒' },
          { id: 'downstreams', label: `3. Map Downstream MCPs & AI Agents (${downstreams.length})`, icon: '🔌' },
          { id: 'downstream-auth', label: '4. Downstream Outbound Auth', icon: '🛡️' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id as any)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 18px',
              borderBottom: activeSubTab === tab.id ? '2px solid var(--primary)' : '2px solid transparent',
              background: 'transparent',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              color: activeSubTab === tab.id ? 'var(--primary-text)' : 'var(--text-muted)',
              fontWeight: activeSubTab === tab.id ? 700 : 500,
              cursor: 'pointer',
              fontSize: '0.88rem',
              transition: 'all 0.15s ease'
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* TAB 1: INBOUND AUTHENTICATION METHOD & DETAILS */}
      {activeSubTab === 'auth' && (
        <div className="glass-panel" style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
              Inbound Client Authentication Method
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Define how client applications, developers, and autonomous agents authenticate when connecting to this project's virtual MCP endpoint.
            </p>
          </div>

          {/* Auth Method Selector Tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            {[
              { id: 'oauth_jwt', name: 'OAuth 2.1 / OIDC (PKCE)', desc: 'Standard Authorization Code + S256 PKCE with JWT token verification', icon: '🛡️' },
              { id: 'oauth_cc', name: 'Client Credentials (M2M)', desc: 'Machine-to-machine service tokens for automated AI workflows', icon: '🤖' },
              { id: 'api_key', name: 'API Key (Bearer Header)', desc: 'High-performance shared secret or project access tokens', icon: '🔑' },
              { id: 'mtls', name: 'Mutual TLS (mTLS)', desc: 'Client X.509 certificate authentication for zero-trust environments', icon: '📜' },
            ].map(method => (
              <div
                key={method.id}
                onClick={() => setInboundAuthMode(method.id)}
                style={{
                  padding: '16px',
                  borderRadius: 'var(--radius-md)',
                  border: inboundAuthMode === method.id ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                  background: inboundAuthMode === method.id ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '1.2rem' }}>{method.icon}</span>
                  <strong style={{ fontSize: '0.9rem', color: inboundAuthMode === method.id ? 'var(--primary-text)' : 'var(--text-main)' }}>
                    {method.name}
                  </strong>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  {method.desc}
                </p>
              </div>
            ))}
          </div>

          {/* Auth Method Configuration Form Fields */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px', marginTop: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                Token Issuer URL (iss)
              </label>
              <input
                type="text"
                className="input-field"
                value={tokenIssuer}
                onChange={(e) => setTokenIssuer(e.target.value)}
                placeholder="https://auth.enterprise.com/oauth2/v1"
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Tokens must be signed by this trusted identity provider.
              </span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                Expected Audience (aud)
              </label>
              <input
                type="text"
                className="input-field"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="https://gateway.corp/p/production"
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Audience claim expected inside the client JWT token.
              </span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                Required Scopes
              </label>
              <input
                type="text"
                className="input-field"
                value={requiredScopes}
                onChange={(e) => setRequiredScopes(e.target.value)}
                placeholder="mcp:tools:read, mcp:tools:execute"
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Comma-separated list of scopes required for invocation.
              </span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                JWKS Public Key URI
              </label>
              <input
                type="text"
                className="input-field"
                value={jwksUri}
                onChange={(e) => setJwksUri(e.target.value)}
                placeholder="https://auth.corp/.well-known/jwks.json"
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Keys used to verify RS256/ES256 signature without calling IdP per request.
              </span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                Allowed OAuth Redirect URIs
              </label>
              <input
                type="text"
                className="input-field"
                value={redirectUris}
                onChange={(e) => setRedirectUris(e.target.value)}
                placeholder="http://localhost:3000/callback, https://ide.corp/oauth"
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Permitted callback endpoints for interactive PKCE flows.
              </span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                Token Expiration Grace Period (Seconds)
              </label>
              <input
                type="number"
                className="input-field"
                value={tokenTtlSeconds}
                onChange={(e) => setTokenTtlSeconds(Number(e.target.value))}
                min={60}
                max={86400}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Default JWT lifetime (3600 seconds = 1 hour).
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ENDPOINT TLS CONFIGURATION & CERTIFICATES */}
      {activeSubTab === 'tls' && (
        <div className="glass-panel" style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
              Endpoint TLS & Certificate Security
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Configure TLS encryption for client ingress traffic terminating on this project endpoint.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                Inbound Protocol
              </label>
              <select
                className="input-field"
                value={protocol}
                onChange={(e) => setProtocol(e.target.value as any)}
              >
                <option value="https">HTTPS (TLS Encrypted - Recommended)</option>
                <option value="http">HTTP (Plaintext - Development Only)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                Minimum TLS Version
              </label>
              <select
                className="input-field"
                value={tlsMinVersion}
                onChange={(e) => setTlsMinVersion(e.target.value as any)}
              >
                <option value="TLS 1.3">TLS 1.3 (Strict & Fast Handshake)</option>
                <option value="TLS 1.2">TLS 1.2 (Legacy Client Compatibility)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                Certificate Mode
              </label>
              <select
                className="input-field"
                value={certMode}
                onChange={(e) => setCertMode(e.target.value as any)}
              >
                <option value="auto_cert">Automatic ACME (Let's Encrypt / ZeroSSL)</option>
                <option value="custom_file">Custom PEM Certificate & Private Key</option>
                <option value="self_signed">Self-Signed Internal Ephemeral Cert</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                Subject Alternative Names (SANs)
              </label>
              <input
                type="text"
                className="input-field"
                value={sans}
                onChange={(e) => setSans(e.target.value)}
                placeholder="localhost, 127.0.0.1, project.internal"
              />
            </div>
          </div>

          {certMode === 'custom_file' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '18px', marginTop: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                  Certificate Chain (PEM format)
                </label>
                <textarea
                  className="input-field font-mono"
                  rows={6}
                  value={certPem}
                  onChange={(e) => setCertPem(e.target.value)}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;MIID...&#10;-----END CERTIFICATE-----"
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)' }}>
                    Private Key (PEM format)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPrivateKey(!showPrivateKey)}
                    style={{ background: 'none', border: 'none', color: 'var(--primary-text)', cursor: 'pointer', fontSize: '0.75rem' }}
                  >
                    {showPrivateKey ? 'Hide Key' : 'Reveal Key'}
                  </button>
                </div>
                <textarea
                  className="input-field font-mono"
                  rows={6}
                  value={showPrivateKey ? keyPem : (keyPem ? '••••••••••••••••••••••••••••••••••••••••' : '')}
                  onChange={(e) => setKeyPem(e.target.value)}
                  placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;MIIE...&#10;-----END RSA PRIVATE KEY-----"
                />
              </div>
            </div>
          )}

          <div style={{
            background: 'var(--bg-surface-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <span style={{ fontSize: '1.4rem' }}>🛡️</span>
            <div>
              <strong style={{ fontSize: '0.85rem', color: 'var(--text-main)', display: 'block' }}>
                HSTS (HTTP Strict Transport Security) & Perfect Forward Secrecy (PFS)
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Enforced cipher suites: TLS_AES_128_GCM_SHA256, TLS_AES_256_GCM_SHA384, TLS_CHACHA20_POLY1305_SHA256.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MAP DOWNSTREAM MCP SERVERS & AI AGENTS */}
      {activeSubTab === 'downstreams' && (
        <div className="glass-panel" style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
            <div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                Mapped Downstream MCP Servers & AI Agents
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                The AI Gateway transparently merges tools from these downstreams under unique namespaces into a single virtual MCP catalog.
              </p>
            </div>

            <button
              onClick={() => setShowAddDownstreamModal(true)}
              className="btn-primary"
              style={{ fontSize: '0.85rem', height: '36px' }}
            >
              + Map New Downstream
            </button>
          </div>

          {/* Downstreams Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '10px 14px' }}>Name & Type</th>
                  <th style={{ padding: '10px 14px' }}>Namespace Prefix</th>
                  <th style={{ padding: '10px 14px' }}>Transport</th>
                  <th style={{ padding: '10px 14px' }}>Downstream URL</th>
                  <th style={{ padding: '10px 14px' }}>Status</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {downstreams.map((downstream) => (
                  <tr key={downstream.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1.1rem' }}>
                          {downstream.type === 'agent' ? '🤖' : '🔌'}
                        </span>
                        <div>
                          <strong style={{ color: 'var(--text-main)', display: 'block' }}>
                            {downstream.name}
                          </strong>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {downstream.type === 'agent' ? 'Autonomous AI Agent' : 'MCP Downstream Server'}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td style={{ padding: '12px 14px' }}>
                      <code className="font-mono" style={{ background: 'var(--primary-subtle)', color: 'var(--primary-text)' }}>
                        {downstream.namespace_prefix}_*
                      </code>
                    </td>

                    <td style={{ padding: '12px 14px' }}>
                      <span className="badge badge-cyan">
                        {downstream.transport.toUpperCase()}
                      </span>
                    </td>

                    <td style={{ padding: '12px 14px' }}>
                      <span className="font-mono" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {downstream.url}
                      </span>
                    </td>

                    <td style={{ padding: '12px 14px' }}>
                      <span className={`badge ${downstream.enabled ? 'badge-emerald' : 'badge-rose'}`}>
                        {downstream.enabled ? '● Active' : '○ Disabled'}
                      </span>
                    </td>

                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                        {downstream.type === 'agent' && (
                          <button
                            type="button"
                            onClick={() => {
                              setInspectingAgent(downstream);
                              setSimulatedTaskOutput([]);
                            }}
                            className="btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '0.75rem', color: 'var(--primary-text)', borderColor: 'var(--border-strong)' }}
                          >
                            🤖 Agent Card
                          </button>
                        )}
                        <button
                          onClick={() => handleToggleDownstream(downstream.id)}
                          className="btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                        >
                          {downstream.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => handleRemoveDownstream(downstream.id, downstream.name)}
                          className="btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '0.75rem', color: 'var(--danger)' }}
                        >
                          Unmap
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: DOWNSTREAM OUTBOUND AUTH METHOD */}
      {activeSubTab === 'downstream-auth' && (
        <div className="glass-panel" style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
              Downstream Outbound Authentication Configuration
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Configure how the AI Gateway authenticates itself when dialing and executing tools on downstream MCP servers or autonomous AI agents.
            </p>
          </div>

          {/* Outbound Auth Modes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            {[
              { id: 'dedicated_client_credentials', name: 'Dedicated Client Credentials', desc: 'Gateway requests OAuth 2.0 machine token on behalf of this project', icon: '🏢' },
              { id: 'propagate_token', name: 'Propagate Inbound Token', desc: 'Forward incoming user Bearer token directly to downstreams', icon: '🔄' },
              { id: 'static_api_key', name: 'Static API Key / Secret', desc: 'Send predefined Bearer key or custom authentication header', icon: '🔑' },
              { id: 'none', name: 'No Authentication', desc: 'Downstreams reside in isolated VPC private network without auth', icon: '🌐' },
            ].map(m => (
              <div
                key={m.id}
                onClick={() => setDownstreamAuthMethod(m.id)}
                style={{
                  padding: '16px',
                  borderRadius: 'var(--radius-md)',
                  border: downstreamAuthMethod === m.id ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                  background: downstreamAuthMethod === m.id ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '1.2rem' }}>{m.icon}</span>
                  <strong style={{ fontSize: '0.9rem', color: downstreamAuthMethod === m.id ? 'var(--primary-text)' : 'var(--text-main)' }}>
                    {m.name}
                  </strong>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  {m.desc}
                </p>
              </div>
            ))}
          </div>

          {/* Outbound Credentials Inputs */}
          {downstreamAuthMethod !== 'none' && downstreamAuthMethod !== 'propagate_token' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '18px', marginTop: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                  Downstream Client ID / Key Name
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={downstreamClientId}
                  onChange={(e) => setDownstreamClientId(e.target.value)}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)' }}>
                    Client Secret / Key (Encrypted at Rest)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowDownstreamSecret(!showDownstreamSecret)}
                    style={{ background: 'none', border: 'none', color: 'var(--primary-text)', cursor: 'pointer', fontSize: '0.75rem' }}
                  >
                    {showDownstreamSecret ? 'Hide' : 'Reveal'}
                  </button>
                </div>
                <input
                  type={showDownstreamSecret ? 'text' : 'password'}
                  className="input-field font-mono"
                  value={downstreamClientSecret}
                  onChange={(e) => setDownstreamClientSecret(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                  Requested Downstream Scopes
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={downstreamScopes}
                  onChange={(e) => setDownstreamScopes(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                  Token Refresh Interval (Seconds)
                </label>
                <input
                  type="number"
                  className="input-field"
                  value={tokenRefreshInterval}
                  onChange={(e) => setTokenRefreshInterval(Number(e.target.value))}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: Map New Downstream */}
      {showAddDownstreamModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="glass-panel" style={{ width: '480px', padding: '26px', background: 'var(--bg-surface)' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '6px' }}>
              Map Downstream MCP Server or AI Agent
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '18px' }}>
              Connect a new upstream tool provider or autonomous agent to this project.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                  Downstream Type
                </label>
                <select
                  className="input-field"
                  value={newDownstreamType}
                  onChange={(e) => {
                    const t = e.target.value as any;
                    setNewDownstreamType(t);
                    if (t === 'agent') {
                      setNewDownstreamTransport('a2a_sse');
                    } else {
                      setNewDownstreamTransport('http');
                    }
                  }}
                >
                  <option value="mcp">Downstream MCP Server (Tools & Resources)</option>
                  <option value="agent">Autonomous AI Agent (A2A Task Delegation Protocol)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                  {newDownstreamType === 'agent' ? 'AI Agent Name' : 'Server Name'}
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder={newDownstreamType === 'agent' ? 'e.g. Financial Research Synthesizer' : 'e.g. Postgres MCP Service'}
                  value={newDownstreamName}
                  onChange={(e) => setNewDownstreamName(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                  Namespace Prefix (Prevents tool & skill collisions)
                </label>
                <input
                  type="text"
                  className="input-field font-mono"
                  placeholder={newDownstreamType === 'agent' ? 'e.g. agent_fin' : 'e.g. db'}
                  value={newDownstreamPrefix}
                  onChange={(e) => setNewDownstreamPrefix(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                  Downstream Endpoint URL
                </label>
                <input
                  type="text"
                  className="input-field font-mono"
                  placeholder={newDownstreamType === 'agent' ? 'http://127.0.0.1:8080/agents/agent-fin-01' : 'http://127.0.0.1:3000/api/mock/mcp-math'}
                  value={newDownstreamUrl}
                  onChange={(e) => setNewDownstreamUrl(e.target.value)}
                />
              </div>

              {/* Agent-Specific Fields */}
              {newDownstreamType === 'agent' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                      Agent Card Discovery URL (Metadata Schema)
                    </label>
                    <input
                      type="text"
                      className="input-field font-mono"
                      placeholder="http://127.0.0.1:8080/agents/agent-fin-01/.well-known/agent.json"
                      value={newAgentCardUrl}
                      onChange={(e) => setNewAgentCardUrl(e.target.value)}
                    />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      JSON Agent Card defining skills, input schemas, and state.
                    </span>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                      Declared Capabilities / Skills (Virtual Tools)
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. sec_filings_rag, math_statistics, markdown_report_gen"
                      value={newAgentCapabilities}
                      onChange={(e) => setNewAgentCapabilities(e.target.value)}
                    />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      These skills are exposed as callable virtual tools in the project MCP endpoint.
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                        Delegation Mode
                      </label>
                      <select
                        className="input-field"
                        value={newAgentDelegationMode}
                        onChange={(e) => setNewAgentDelegationMode(e.target.value as any)}
                      >
                        <option value="sync_sse">Synchronous (SSE Stream)</option>
                        <option value="async_queue">Asynchronous (Task Queue)</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                        Task Timeout (ms)
                      </label>
                      <input
                        type="number"
                        className="input-field"
                        value={newAgentTimeoutMs}
                        onChange={(e) => setNewAgentTimeoutMs(Number(e.target.value))}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                      Agent Secret / Bearer Token
                    </label>
                    <input
                      type="password"
                      className="input-field font-mono"
                      placeholder="ag_sec_••••••••••••"
                      value={newAgentAuthToken}
                      onChange={(e) => setNewAgentAuthToken(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                  Transport Protocol
                </label>
                <select
                  className="input-field"
                  value={newDownstreamTransport}
                  onChange={(e) => setNewDownstreamTransport(e.target.value)}
                >
                  {newDownstreamType === 'agent' ? (
                    <>
                      <option value="a2a_sse">A2A Task Protocol over SSE (Streaming)</option>
                      <option value="http">Streamable HTTP (JSON-RPC 2.0)</option>
                    </>
                  ) : (
                    <>
                      <option value="http">Streamable HTTP (JSON-RPC POST)</option>
                      <option value="sse">Server-Sent Events (SSE)</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '22px' }}>
              <button
                onClick={() => setShowAddDownstreamModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleAddDownstream}
                className="btn-primary"
              >
                Map Downstream
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Agent Card Inspector & Live Task Simulation */}
      {inspectingAgent && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="glass-panel" style={{ width: '600px', maxHeight: '85vh', overflowY: 'auto', padding: '28px', background: 'var(--bg-surface)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.6rem' }}>🤖</span>
                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                    {inspectingAgent.name}
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Autonomous Sub-Agent Profile • {inspectingAgent.url}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setInspectingAgent(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Agent Card JSON */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
                Agent Card Metadata Schema (.well-known/agent.json)
              </label>
              <pre style={{
                background: '#090d16',
                color: '#38bdf8',
                fontSize: '0.78rem',
                fontFamily: 'monospace',
                padding: '14px',
                borderRadius: 'var(--radius-sm)',
                overflowX: 'auto',
                lineHeight: 1.5,
                border: '1px solid #1e293b',
                margin: 0
              }}>
{JSON.stringify({
  id: inspectingAgent.id,
  name: inspectingAgent.name,
  protocol: inspectingAgent.transport === 'a2a_sse' ? 'A2A Task Protocol v1.0 (SSE)' : 'JSON-RPC Runnable',
  endpoint: inspectingAgent.url,
  namespace_prefix: inspectingAgent.namespace_prefix,
  capabilities: inspectingAgent.capabilities || ['sec_filings_rag', 'math_statistics', 'markdown_report_gen'],
  delegation_mode: inspectingAgent.delegation_mode || 'sync_sse',
  timeout_ms: inspectingAgent.timeout_ms || 60000,
  concurrency_limit: inspectingAgent.concurrency_limit || 5,
  trace_propagation: 'W3C Traceparent',
  status: inspectingAgent.health_status || 'healthy'
}, null, 2)}
              </pre>
            </div>

            {/* Test Task Delegation Console */}
            <div style={{ background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--text-main)', display: 'block' }}>
                    ⚡ Test Task Delegation over Gateway
                  </strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Simulate an A2A task delegation through the AI Gateway to this sub-agent
                  </span>
                </div>
                <button
                  type="button"
                  disabled={isSimulatingTask}
                  onClick={() => handleSimulateTask(inspectingAgent)}
                  className="btn-primary"
                  style={{ fontSize: '0.78rem', padding: '6px 14px' }}
                >
                  {isSimulatingTask ? 'Streaming...' : 'Run Test Task'}
                </button>
              </div>

              {simulatedTaskOutput.length > 0 && (
                <div style={{ background: '#090d16', padding: '10px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid #1e293b' }}>
                  {simulatedTaskOutput.map((line, idx) => (
                    <div key={idx} style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: line.includes('SUCCESS') ? '#10b981' : line.includes('Stream Chunk') ? '#38bdf8' : '#cbd5e1', lineHeight: '1.6' }}>
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setInspectingAgent(null)}
                className="btn-secondary"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
