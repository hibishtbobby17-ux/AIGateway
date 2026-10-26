'use client';

import React, { useState, useEffect } from 'react';

interface ProjectPoliciesViewProps {
  projects: any[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  onRefreshProjects: () => void;
  showBanner: (text: string, type: 'success' | 'error' | 'info') => void;
}

export default function ProjectPoliciesView({
  projects,
  selectedProjectId,
  onSelectProject,
  onRefreshProjects,
  showBanner,
}: ProjectPoliciesViewProps) {
  const currentProject = projects.find((p) => p.id === selectedProjectId) || projects[0];

  // Local Form State based on current project settings
  const [authMode, setAuthMode] = useState<string>('none');
  const [requiredScopes, setRequiredScopes] = useState<string>('mcp:tools, mcp:read');
  const [issuerUrl, setIssuerUrl] = useState<string>('');
  const [audience, setAudience] = useState<string>('ai-gateway');
  const [jwksUri, setJwksUri] = useState<string>('');

  // Traffic & Rate Limits State
  const [rpm, setRpm] = useState<number>(600);
  const [burst, setBurst] = useState<number>(50);
  const [keyStrategy, setKeyStrategy] = useState<string>('client_ip');
  const [failStaticCache, setFailStaticCache] = useState<boolean>(true);

  // Circuit Breaker State
  const [maxFailures, setMaxFailures] = useState<number>(5);
  const [recoverySeconds, setRecoverySeconds] = useState<number>(30);
  const [dialTimeoutMs, setDialTimeoutMs] = useState<number>(5000);
  const [callTimeoutMs, setCallTimeoutMs] = useState<number>(15000);

  // Tool Policies State
  const [toolsList, setToolsList] = useState<any[]>([]);
  const [loadingTools, setLoadingTools] = useState<boolean>(false);
  const [savingPolicies, setSavingPolicies] = useState<boolean>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);

  // Sync state when currentProject changes
  useEffect(() => {
    if (currentProject) {
      const s = currentProject.settings || {};
      const auth = s.inbound_auth || {};
      setAuthMode(auth.mode || 'none');
      setRequiredScopes(Array.isArray(auth.required_scopes) ? auth.required_scopes.join(', ') : 'mcp:tools, mcp:read');
      setIssuerUrl(auth.issuer || '');
      setAudience(auth.audience || 'ai-gateway');
      setJwksUri(auth.jwks_uri || '');

      const rl = s.rate_limits || s.rate_limit || {};
      setRpm(typeof rl === 'number' ? rl : rl.requests_per_minute || 600);
      setBurst(rl.burst || 50);
      setKeyStrategy(rl.key_strategy || 'client_ip');
      setFailStaticCache(s.fail_static_cache !== false);

      const cb = s.circuit_breaker || {};
      setMaxFailures(cb.max_failures || 5);
      setRecoverySeconds(cb.recovery_seconds || 30);
      setDialTimeoutMs(cb.dial_timeout_ms || 5000);
      setCallTimeoutMs(cb.call_timeout_ms || 15000);

      loadProjectTools(currentProject.id);
      setHasUnsavedChanges(false);
    }
  }, [currentProject?.id]);

  const loadProjectTools = async (projectId: string) => {
    setLoadingTools(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/servers`);
      if (res.ok) {
        const data = await res.json();
        const servers = data.servers || [];
        const aggregatedTools: any[] = [];

        for (const s of servers) {
          // If server already has tool policies attached
          const policies = s.tool_policies || [];
          if (policies.length > 0) {
            for (const tp of policies) {
              aggregatedTools.push({
                serverId: s.id,
                serverName: s.name,
                prefix: s.namespace_prefix,
                toolName: tp.tool_name,
                enabled: tp.enabled !== false,
                rename: tp.rename || '',
                isDirty: false,
              });
            }
          } else {
            // Default synthesized tools
            aggregatedTools.push(
              { serverId: s.id, serverName: s.name, prefix: s.namespace_prefix, toolName: 'query', enabled: true, rename: '', isDirty: false },
              { serverId: s.id, serverName: s.name, prefix: s.namespace_prefix, toolName: 'execute', enabled: true, rename: '', isDirty: false },
              { serverId: s.id, serverName: s.name, prefix: s.namespace_prefix, toolName: 'describe', enabled: true, rename: '', isDirty: false }
            );
          }
        }
        setToolsList(aggregatedTools);
      }
    } catch (err) {
      console.error('Failed to load project tools:', err);
    } finally {
      setLoadingTools(false);
    }
  };

  const handleToolToggle = (index: number) => {
    setToolsList((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], enabled: !next[index].enabled, isDirty: true };
      return next;
    });
    setHasUnsavedChanges(true);
  };

  const handleToolRenameChange = (index: number, newRename: string) => {
    setToolsList((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], rename: newRename, isDirty: true };
      return next;
    });
    setHasUnsavedChanges(true);
  };

  const handleApplyPolicies = async () => {
    if (!currentProject) return;
    setSavingPolicies(true);
    try {
      const scopesArray = requiredScopes.split(',').map((s) => s.trim()).filter(Boolean);

      const updatedSettings = {
        ...(currentProject.settings || {}),
        inbound_auth: {
          mode: authMode,
          required_scopes: scopesArray,
          issuer: issuerUrl.trim() || undefined,
          audience: audience.trim() || undefined,
          jwks_uri: jwksUri.trim() || undefined,
        },
        rate_limits: {
          requests_per_minute: Number(rpm),
          burst: Number(burst),
          key_strategy: keyStrategy,
        },
        circuit_breaker: {
          max_failures: Number(maxFailures),
          recovery_seconds: Number(recoverySeconds),
          dial_timeout_ms: Number(dialTimeoutMs),
          call_timeout_ms: Number(callTimeoutMs),
        },
        fail_static_cache: failStaticCache,
      };

      // 1. Update project settings (bumps config_version automatically)
      const projRes = await fetch(`/api/projects/${currentProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: updatedSettings }),
      });

      if (!projRes.ok) {
        const errData = await projRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to update project settings');
      }

      // 2. Persist modified tool policies
      const dirtyTools = toolsList.filter((t) => t.isDirty);
      for (const t of dirtyTools) {
        await fetch(`/api/servers/${t.serverId}/tools/${encodeURIComponent(t.toolName)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: t.enabled,
            rename: t.rename.trim() || null,
          }),
        }).catch((err) => console.warn(`Failed to update tool policy for ${t.toolName}:`, err));
      }

      setHasUnsavedChanges(false);
      await onRefreshProjects();
      showBanner(`Policies successfully enforced for "${currentProject.name}"! Version bumped and synced to gateway.`, 'success');
    } catch (err: any) {
      showBanner(err.message || 'Error enforcing policies', 'error');
    } finally {
      setSavingPolicies(false);
    }
  };

  if (!currentProject) {
    return (
      <div className="glass-panel" style={{ padding: '60px 20px', textAlign: 'center' }}>
        <h3>No Project Selected</h3>
        <p style={{ color: 'var(--text-muted)' }}>Create a project first to configure access policies.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span style={{ fontSize: '1.8rem' }}>🛡️</span>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              Project Policy Enforcement &amp; Governance
            </h2>
            <span className="badge badge-emerald" style={{ fontSize: '0.72rem' }}>
              Enforced at Trust Boundary
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
            Configure and push zero-trust inbound authentication, rate limits, circuit breaker thresholds, and tool transforms.
          </p>
        </div>

        {/* Global Save Button */}
        <button
          onClick={handleApplyPolicies}
          disabled={savingPolicies}
          className="btn-primary"
          style={{
            fontSize: '0.9rem',
            padding: '10px 20px',
            background: hasUnsavedChanges
              ? 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)'
              : 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
            boxShadow: hasUnsavedChanges ? '0 0 16px rgba(16, 185, 129, 0.4)' : undefined,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>{savingPolicies ? '⏳' : '🚀'}</span>
          <span>{savingPolicies ? 'Applying to Fleet...' : 'Enforce & Apply Policies'}</span>
          {hasUnsavedChanges && (
            <span style={{ background: '#ffffff', color: 'var(--primary)', fontSize: '0.68rem', fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--radius-pill)' }}>
              Unsaved
            </span>
          )}
        </button>
      </div>

      {/* Project Selector Bar */}
      <div className="glass-panel" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Target Project:
          </span>
          <select
            value={currentProject.id}
            onChange={(e) => onSelectProject(e.target.value)}
            className="input-field"
            style={{ minWidth: '240px', padding: '8px 12px', fontSize: '0.9rem', fontWeight: 600 }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (/p/{p.slug})
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.78rem' }}>
          <span style={{ color: 'var(--text-dim)' }}>
            Config Version: <strong style={{ color: 'var(--text-main)' }}>v{currentProject.config_version || 1}</strong>
          </span>
          <span className="badge badge-cyan" style={{ fontSize: '0.7rem' }}>
            Endpoint: /p/{currentProject.slug}/mcp
          </span>
        </div>
      </div>

      {/* Section 1: Inbound Authentication Policy */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <span style={{ fontSize: '1.25rem' }}>🔑</span>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              1. Inbound Authentication &amp; Access Control
            </h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Evaluated on the headless gateway listener before passing calls to virtual MCP tools.
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px', marginBottom: '20px' }}>
          {/* Auth Mode Radio Cards */}
          {[
            { id: 'none', title: 'Open / Public Access', desc: 'No client authentication. Suitable for local sandbox or internal mesh.', badge: 'Open' },
            { id: 'api_key', title: 'API Key Validation', desc: 'Requires X-API-Key or Bearer API key registered in console.', badge: 'Standard' },
            { id: 'oauth_jwt', title: 'OAuth 2.1 / OIDC JWT', desc: 'Strict JWT signature verification with JWKS & scope enforcement.', badge: 'Zero-Trust' },
          ].map((mode) => (
            <div
              key={mode.id}
              onClick={() => {
                setAuthMode(mode.id);
                setHasUnsavedChanges(true);
              }}
              style={{
                background: authMode === mode.id ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                border: authMode === mode.id ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: authMode === mode.id ? 'var(--card-hover-shadow)' : 'var(--card-shadow)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <strong style={{ fontSize: '0.92rem', color: authMode === mode.id ? 'var(--primary-text)' : 'var(--text-main)' }}>
                  {mode.title}
                </strong>
                <span className={`badge ${authMode === mode.id ? 'badge-indigo' : 'badge-cyan'}`} style={{ fontSize: '0.65rem' }}>
                  {mode.badge}
                </span>
              </div>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
                {mode.desc}
              </p>
            </div>
          ))}
        </div>

        {/* OAuth JWT Parameters (Visible if oauth_jwt selected) */}
        {authMode === 'oauth_jwt' && (
          <div style={{ background: 'var(--bg-surface-subtle)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                Expected Issuer URL (iss)
              </label>
              <input
                type="text"
                placeholder="https://auth.enterprise.com or /api/mock/idp"
                value={issuerUrl}
                onChange={(e) => {
                  setIssuerUrl(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                className="input-field"
                style={{ width: '100%', fontSize: '0.82rem' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                JWKS Keyset URI (.well-known/jwks.json)
              </label>
              <input
                type="text"
                placeholder="https://auth.enterprise.com/.well-known/jwks.json"
                value={jwksUri}
                onChange={(e) => {
                  setJwksUri(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                className="input-field"
                style={{ width: '100%', fontSize: '0.82rem' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                Expected Audience (aud)
              </label>
              <input
                type="text"
                placeholder="ai-gateway"
                value={audience}
                onChange={(e) => {
                  setAudience(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                className="input-field"
                style={{ width: '100%', fontSize: '0.82rem' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                Required OAuth Scopes (Comma-separated)
              </label>
              <input
                type="text"
                placeholder="mcp:tools, mcp:read, mcp:execute"
                value={requiredScopes}
                onChange={(e) => {
                  setRequiredScopes(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                className="input-field"
                style={{ width: '100%', fontSize: '0.82rem' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Section 2: Traffic & Rate Limiting Guardrails */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <span style={{ fontSize: '1.25rem' }}>⚡</span>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              2. Traffic &amp; Rate Limiting Guardrails
            </h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Token bucket algorithm enforced at gateway edge to protect downstreams from thundering herds.
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '18px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              Requests Per Minute (RPM)
            </label>
            <input
              type="number"
              min="10"
              max="100000"
              value={rpm}
              onChange={(e) => {
                setRpm(Number(e.target.value));
                setHasUnsavedChanges(true);
              }}
              className="input-field"
              style={{ width: '100%', fontSize: '0.85rem' }}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>
              Base sustained throughput budget
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              Burst Token Capacity
            </label>
            <input
              type="number"
              min="1"
              max="10000"
              value={burst}
              onChange={(e) => {
                setBurst(Number(e.target.value));
                setHasUnsavedChanges(true);
              }}
              className="input-field"
              style={{ width: '100%', fontSize: '0.85rem' }}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>
              Max simultaneous burst calls allowed
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              Rate Limit Keying Strategy
            </label>
            <select
              value={keyStrategy}
              onChange={(e) => {
                setKeyStrategy(e.target.value);
                setHasUnsavedChanges(true);
              }}
              className="input-field"
              style={{ width: '100%', fontSize: '0.85rem' }}
            >
              <option value="client_ip">Client IP Address</option>
              <option value="jwt_subject">OAuth JWT Subject (sub)</option>
              <option value="api_key">API Key Identifier</option>
              <option value="project_global">Global Project Bucket</option>
            </select>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>
              Dimensions used to aggregate token consumption
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              Fail-Static Local Fallback Mode
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', height: '40px' }}>
              <input
                type="checkbox"
                id="fail-static-toggle"
                checked={failStaticCache}
                onChange={(e) => {
                  setFailStaticCache(e.target.checked);
                  setHasUnsavedChanges(true);
                }}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <label htmlFor="fail-static-toggle" style={{ fontSize: '0.82rem', color: 'var(--text-main)', cursor: 'pointer' }}>
                Enable Cached Offline Serving
              </label>
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
              Serve tools from local RAM if control plane is partitioned
            </span>
          </div>
        </div>
      </div>

      {/* Section 3: Circuit Breaker & Outbound Resilience */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <span style={{ fontSize: '1.25rem' }}>🛑</span>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              3. Circuit Breaker &amp; Outbound Resilience
            </h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Automatic circuit trips prevent hung connections when upstream MCP instances fail.
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              Max Consecutive Failures
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={maxFailures}
              onChange={(e) => {
                setMaxFailures(Number(e.target.value));
                setHasUnsavedChanges(true);
              }}
              className="input-field"
              style={{ width: '100%', fontSize: '0.85rem' }}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>
              Trips circuit to OPEN state
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              Recovery Cooldown (Seconds)
            </label>
            <input
              type="number"
              min="5"
              max="600"
              value={recoverySeconds}
              onChange={(e) => {
                setRecoverySeconds(Number(e.target.value));
                setHasUnsavedChanges(true);
              }}
              className="input-field"
              style={{ width: '100%', fontSize: '0.85rem' }}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>
              HALF-OPEN probe duration
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              Upstream Dial Timeout (ms)
            </label>
            <input
              type="number"
              min="500"
              max="60000"
              value={dialTimeoutMs}
              onChange={(e) => {
                setDialTimeoutMs(Number(e.target.value));
                setHasUnsavedChanges(true);
              }}
              className="input-field"
              style={{ width: '100%', fontSize: '0.85rem' }}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>
              TCP / TLS handshake limit
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              Tool Execution Timeout (ms)
            </label>
            <input
              type="number"
              min="1000"
              max="120000"
              value={callTimeoutMs}
              onChange={(e) => {
                setCallTimeoutMs(Number(e.target.value));
                setHasUnsavedChanges(true);
              }}
              className="input-field"
              style={{ width: '100%', fontSize: '0.85rem' }}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>
              Maximum tool execution time
            </span>
          </div>
        </div>
      </div>

      {/* Section 4: Tool Governance & Transformation Matrix */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.25rem' }}>🔧</span>
            <div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                4. Tool Governance, Whitelist &amp; Renaming Transforms
              </h3>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Selectively allow, block, or alias individual upstream tools exposed on this project endpoint.
              </span>
            </div>
          </div>

          <div style={{ fontSize: '0.78rem', color: 'var(--accent-cyan)' }}>
            {toolsList.length} Tool Policies Managed
          </div>
        </div>

        {loadingTools ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            Querying tool policies...
          </div>
        ) : toolsList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-dim)', fontStyle: 'italic', background: 'var(--bg-surface-subtle)', borderRadius: 'var(--radius-md)' }}>
            No tools found for this project. Attach downstream MCP servers in the "Downstream MCPs" tab.
          </div>
        ) : (
          <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border-subtle)', boxShadow: 'var(--card-shadow)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface-subtle)', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                  <th style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>Server &amp; Namespace</th>
                  <th style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>Original Tool Name</th>
                  <th style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>Enforcement Status</th>
                  <th style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>Virtual Alias / Rename Override</th>
                </tr>
              </thead>
              <tbody>
                {toolsList.map((t, idx) => (
                  <tr key={`${t.serverId}-${t.toolName}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{t.serverName}</div>
                      <code style={{ fontSize: '0.72rem', color: 'var(--primary-text)', fontWeight: 600 }}>{t.prefix || 'root'}::</code>
                    </td>

                    <td style={{ padding: '10px 14px' }}>
                      <code style={{ fontSize: '0.82rem', color: 'var(--text-main)', fontWeight: 600, background: 'var(--bg-surface-subtle)', padding: '2px 6px', borderRadius: '4px' }}>{t.toolName}</code>
                    </td>

                    <td style={{ padding: '10px 14px' }}>
                      <button
                        onClick={() => handleToolToggle(idx)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          border: t.enabled ? '1px solid #10b981' : '1px solid var(--danger)',
                          background: t.enabled ? '#ecfdf5' : '#fef2f2',
                          color: t.enabled ? '#047857' : 'var(--danger-hover)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>{t.enabled ? '✓' : '✕'}</span>
                        <span>{t.enabled ? 'ALLOWED' : 'BLOCKED'}</span>
                      </button>
                    </td>

                    <td style={{ padding: '10px 14px' }}>
                      <input
                        type="text"
                        placeholder={`Leave blank or override e.g. safe_${t.toolName}`}
                        value={t.rename}
                        onChange={(e) => handleToolRenameChange(idx, e.target.value)}
                        className="input-field"
                        style={{ width: '100%', maxWidth: '280px', padding: '4px 8px', fontSize: '0.76rem' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bottom Sticky Action Bar */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--card-hover-shadow)',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        position: 'sticky',
        bottom: '20px',
        zIndex: 100,
      }}>
        <div>
          <strong style={{ color: 'var(--text-main)', fontSize: '0.88rem' }}>
            Ready to push policy changes to Gateway Fleet?
          </strong>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>
            Data plane instances will pull and apply the configuration version within 3 seconds.
          </div>
        </div>

        <button
          onClick={handleApplyPolicies}
          disabled={savingPolicies}
          className="btn-primary"
          style={{
            fontSize: '0.9rem',
            padding: '10px 24px',
            background: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>{savingPolicies ? '⏳' : '🚀'}</span>
          <span>{savingPolicies ? 'Applying Changes...' : 'Enforce & Deploy Policies'}</span>
        </button>
      </div>
    </div>
  );
}
