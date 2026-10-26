'use client';

import React, { useState } from 'react';

interface PolicyEditorViewProps {
  projects: any[];
  gatewaysList: any[];
  onNavigateToPoliciesList: () => void;
  showBanner: (text: string, type: 'success' | 'error' | 'info') => void;
}

export default function PolicyEditorView({
  projects,
  gatewaysList,
  onNavigateToPoliciesList,
  showBanner,
}: PolicyEditorViewProps) {
  const [policyName, setPolicyName] = useState('Enforce Production Tool Restrictions');
  const [description, setDescription] = useState('Restrict sensitive database mutations and enforce token bucket rate limits');
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || '');
  const [endpointPattern, setEndpointPattern] = useState('/p/production/mcp/tools/*');
  const [action, setAction] = useState<'ALLOW' | 'DENY' | 'RATE_LIMIT' | 'REDACT_PII'>('RATE_LIMIT');
  const [matchTarget, setMatchTarget] = useState('db_write_*, db_drop_*, math_*');
  const [selectedGatewayId, setSelectedGatewayId] = useState(gatewaysList[0]?.id || 'all');
  const [requiredRole, setRequiredRole] = useState('admin, agent-operator');
  const [rateLimitPerMin, setRateLimitPerMin] = useState(1200);
  const [burstCapacity, setBurstCapacity] = useState(150);

  // Dry Run Simulator State
  const [dryRunTool, setDryRunTool] = useState('db_write_record');
  const [dryRunRole, setDryRunRole] = useState('agent-operator');
  const [simResult, setSimResult] = useState<{ decision: 'ALLOW' | 'DENY'; reason: string; matchedRule: string } | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const handleSimulate = () => {
    setIsSimulating(true);
    setTimeout(() => {
      const isMatch = matchTarget.split(',').some(p => {
        const clean = p.trim().replace('*', '');
        return dryRunTool.includes(clean);
      });

      if (action === 'DENY' && isMatch) {
        setSimResult({
          decision: 'DENY',
          reason: `Tool '${dryRunTool}' explicitly matched deny pattern '${matchTarget}'`,
          matchedRule: policyName
        });
      } else if (action === 'RATE_LIMIT' && isMatch) {
        setSimResult({
          decision: 'ALLOW',
          reason: `Request permitted under token bucket rate limit (${rateLimitPerMin} req/min, burst ${burstCapacity})`,
          matchedRule: policyName
        });
      } else {
        setSimResult({
          decision: 'ALLOW',
          reason: `Default permissive evaluation (no deny rule triggered)`,
          matchedRule: 'default-fallback'
        });
      }
      setIsSimulating(false);
    }, 300);
  };

  const handleSavePolicy = () => {
    showBanner(`Policy "${policyName}" saved and associated with ${endpointPattern}!`, 'success');
    onNavigateToPoliciesList();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.025em' }}>
              Policy Editor & Endpoint Enforcement
            </h1>
            <span className="badge badge-indigo">Submenu: Policy</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '4px' }}>
            Configure fine-grained access policies, rate limits, and tool execution restrictions associated with specific project endpoints.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={onNavigateToPoliciesList} className="btn-secondary" style={{ height: '38px', fontSize: '0.85rem' }}>
            View All Policies →
          </button>
          <button onClick={handleSavePolicy} className="btn-primary" style={{ height: '38px', padding: '0 18px', fontWeight: 600 }}>
            Save & Enforce Policy
          </button>
        </div>
      </div>

      {/* Main Grid: Config Form + Dry Run Simulator */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '22px' }}>
        {/* Form: Policy Configuration */}
        <div className="glass-panel" style={{ padding: '26px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
              1. Policy Identification & Association
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Bind this rule to target project ingress routes and enforcement gateways.
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px' }}>
              Policy Rule Name
            </label>
            <input
              type="text"
              className="input-field"
              value={policyName}
              onChange={(e) => setPolicyName(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px' }}>
              Description
            </label>
            <textarea
              className="input-field"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px' }}>
                Associate with Project
              </label>
              <select
                className="input-field"
                value={selectedProjectId}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  const p = projects.find(proj => proj.id === e.target.value);
                  if (p) setEndpointPattern(`/p/${p.slug}/mcp/tools/*`);
                }}
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name} (/{p.slug})</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px' }}>
                Associated AI Gateway
              </label>
              <select
                className="input-field"
                value={selectedGatewayId}
                onChange={(e) => setSelectedGatewayId(e.target.value)}
              >
                <option value="all">All Active Gateways (Cluster-wide)</option>
                {gatewaysList.map(gw => (
                  <option key={gw.id} value={gw.id}>{gw.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px' }}>
              Specific Project Endpoint Route Pattern
            </label>
            <input
              type="text"
              className="input-field font-mono"
              value={endpointPattern}
              onChange={(e) => setEndpointPattern(e.target.value)}
            />
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Supports wildcards like <code>/p/{'{slug}'}/mcp/tools/*</code> or <code>/p/{'{slug}'}/sse</code>
            </span>
          </div>

          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '8px' }}>
              2. Rule Action & Rate Limiting
            </h3>

            {/* Action Selector */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px' }}>
              {(['ALLOW', 'DENY', 'RATE_LIMIT', 'REDACT_PII'] as const).map(act => (
                <button
                  key={act}
                  type="button"
                  onClick={() => setAction(act)}
                  style={{
                    padding: '8px 4px',
                    borderRadius: 'var(--radius-sm)',
                    border: action === act ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                    background: action === act ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                    color: action === act ? 'var(--primary-text)' : 'var(--text-main)',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    cursor: 'pointer'
                  }}
                >
                  {act}
                </button>
              ))}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px' }}>
                Tool Name or Action Match (Wildcards allowed)
              </label>
              <input
                type="text"
                className="input-field font-mono"
                value={matchTarget}
                onChange={(e) => setMatchTarget(e.target.value)}
                placeholder="e.g. math_*, db_write_*, *"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px' }}>
                  Rate Limit (Requests/Min)
                </label>
                <input
                  type="number"
                  className="input-field"
                  value={rateLimitPerMin}
                  onChange={(e) => setRateLimitPerMin(Number(e.target.value))}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px' }}>
                  Burst Capacity
                </label>
                <input
                  type="number"
                  className="input-field"
                  value={burstCapacity}
                  onChange={(e) => setBurstCapacity(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Panel 2: Interactive Dry-Run Policy Simulator */}
        <div className="glass-panel" style={{ padding: '26px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.2rem' }}>🧪</span>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                Dry-Run Policy Simulator
              </h3>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '4px' }}>
              Test how simulated requests against <code>{endpointPattern}</code> evaluate before rolling out live.
            </p>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px' }}>
              Simulated Tool Name
            </label>
            <input
              type="text"
              className="input-field font-mono"
              value={dryRunTool}
              onChange={(e) => setDryRunTool(e.target.value)}
              placeholder="e.g. db_write_record"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px' }}>
              Caller Role
            </label>
            <input
              type="text"
              className="input-field"
              value={dryRunRole}
              onChange={(e) => setDryRunRole(e.target.value)}
              placeholder="e.g. agent-operator"
            />
          </div>

          <button
            onClick={handleSimulate}
            disabled={isSimulating}
            className="btn-primary"
            style={{ width: '100%', height: '40px', fontWeight: 600 }}
          >
            {isSimulating ? 'Evaluating...' : '▶ Run Policy Evaluation Test'}
          </button>

          {simResult && (
            <div style={{
              background: simResult.decision === 'ALLOW' ? '#ecfdf5' : '#fef2f2',
              border: `1px solid ${simResult.decision === 'ALLOW' ? '#a7f3d0' : '#fecaca'}`,
              borderRadius: 'var(--radius-md)',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              marginTop: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{
                  color: simResult.decision === 'ALLOW' ? '#047857' : '#b91c1c',
                  fontSize: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  {simResult.decision === 'ALLOW' ? '✅ DECISION: ALLOW' : '🚫 DECISION: DENY'}
                </strong>
                <span className="badge badge-indigo">Rule: {simResult.matchedRule}</span>
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>
                {simResult.reason}
              </p>
            </div>
          )}

          <div style={{
            background: 'var(--bg-surface-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px',
            border: '1px solid var(--border-subtle)',
            fontSize: '0.78rem',
            color: 'var(--text-muted)'
          }}>
            <strong style={{ color: 'var(--text-main)', display: 'block', marginBottom: '4px' }}>
              Policy Audit Engine:
            </strong>
            All policy mutations create immutable audit logs queryable via the Audit Trail API. Denied invocations immediately alert OTel monitors.
          </div>
        </div>
      </div>
    </div>
  );
}
