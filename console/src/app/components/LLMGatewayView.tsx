'use client';

import React, { useState, useEffect } from 'react';

export interface LLMBackend {
  provider: 'azure_openai' | 'aws_bedrock' | 'openai_direct' | 'anthropic_direct' | 'google_vertex' | 'ollama_vllm';
  endpoint?: string;
  deployment_name?: string;
  api_version?: string;
  region?: string;
  model_id?: string;
  model_alias?: string;
  api_key?: string;
  access_key_id?: string;
  secret_access_key?: string;
  organization_id?: string;
  weight?: number;
  priority?: number;
  trigger_on_status?: number[];
}

export interface InboundAuth {
  mode: 'oauth_pkce' | 'client_credentials' | 'api_key';
  issuer?: string;
  client_id?: string;
  audience?: string;
  scopes?: string[];
  jwks_uri?: string;
  allow_client_credentials?: boolean;
  allow_api_key?: boolean;
  api_key?: string;
}

export interface LLMGateway {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'degraded' | 'paused';
  inbound_auth: InboundAuth;
  primary_backend: LLMBackend;
  fallback_backends: LLMBackend[];
  routing_strategy: 'priority_fallback' | 'lowest_latency' | 'weighted_round_robin';
  guardrails: {
    rate_limits?: { requests_per_minute: number; tokens_per_minute: number };
    pii_masking?: boolean;
    prompt_injection_detection?: boolean;
    max_tokens_ceiling?: number;
  };
  metrics?: {
    tokens_processed: number;
    requests_total: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    fallback_events?: number;
    avg_latency_ms?: number;
  };
  created_at?: string;
  updated_at?: string;
}

interface LLMGatewayViewProps {
  showBanner: (text: string, type: 'success' | 'error' | 'info') => void;
}

export default function LLMGatewayView({ showBanner }: LLMGatewayViewProps) {
  const [gateways, setGateways] = useState<LLMGateway[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeSubTab, setActiveSubTab] = useState<'endpoints' | 'playground' | 'providers'>('endpoints');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  // Modal / Edit State
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [editingGateway, setEditingGateway] = useState<LLMGateway | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Form Fields
  const [formName, setFormName] = useState<string>('');
  const [formSlug, setFormSlug] = useState<string>('');
  const [formAuthMode, setFormAuthMode] = useState<'oauth_pkce' | 'client_credentials' | 'api_key'>('oauth_pkce');
  const [formIssuer, setFormIssuer] = useState<string>('https://auth.enterprise.okta.com/oauth2/default');
  const [formClientId, setFormClientId] = useState<string>('0oa9k18lq2AbCdEf0h7');
  const [formAudience, setFormAudience] = useState<string>('https://gateway.corp/llm');
  const [formScopes, setFormScopes] = useState<string>('llm:chat, llm:stream');
  const [formJwksUri, setFormJwksUri] = useState<string>('https://auth.enterprise.okta.com/oauth2/default/v1/keys');
  const [formAllowCC, setFormAllowCC] = useState<boolean>(true);
  const [formAllowApiKey, setFormAllowApiKey] = useState<boolean>(true);
  const [formApiKey, setFormApiKey] = useState<string>('sec_llm_live_' + Math.random().toString(36).substring(2, 10));

  // Primary Provider Fields
  const [formPrimaryProvider, setFormPrimaryProvider] = useState<LLMBackend['provider']>('azure_openai');
  const [formPrimaryEndpoint, setFormPrimaryEndpoint] = useState<string>('https://corp-ai-eastus2.openai.azure.com');
  const [formPrimaryDeployment, setFormPrimaryDeployment] = useState<string>('gpt-4o-prod');
  const [formPrimaryModelAlias, setFormPrimaryModelAlias] = useState<string>('gpt-4o');
  const [formPrimaryApiKey, setFormPrimaryApiKey] = useState<string>('••••••••••••••••••••••••••••••••');
  const [formPrimaryRegion, setFormPrimaryRegion] = useState<string>('eastus2');
  const [formPrimaryBedrockModelId, setFormPrimaryBedrockModelId] = useState<string>('anthropic.claude-3-5-sonnet-20240620-v1:0');

  // Fallback Fields
  const [formRoutingStrategy, setFormRoutingStrategy] = useState<'priority_fallback' | 'lowest_latency' | 'weighted_round_robin'>('priority_fallback');
  const [formEnableFallback, setFormEnableFallback] = useState<boolean>(true);
  const [formFallbackProvider, setFormFallbackProvider] = useState<LLMBackend['provider']>('aws_bedrock');
  const [formFallbackModelAlias, setFormFallbackModelAlias] = useState<string>('claude-3-5-sonnet');
  const [formFallbackRegion, setFormFallbackRegion] = useState<string>('us-east-1');

  // Guardrails
  const [formRpm, setFormRpm] = useState<number>(1200);
  const [formTpm, setFormTpm] = useState<number>(350000);
  const [formPiiMasking, setFormPiiMasking] = useState<boolean>(true);
  const [formPromptInjection, setFormPromptInjection] = useState<boolean>(true);

  // Playground State
  const [playgroundSelectedSlug, setPlaygroundSelectedSlug] = useState<string>('');
  const [playgroundAuthMode, setPlaygroundAuthMode] = useState<'okta_oauth' | 'okta_cc' | 'api_key'>('okta_oauth');
  const [playgroundPrompt, setPlaygroundPrompt] = useState<string>('Summarize the quarterly financial earnings report highlighting key EBITDA metrics and growth vectors.');
  const [playgroundSimulateFallback, setPlaygroundSimulateFallback] = useState<boolean>(false);
  const [playgroundRunning, setPlaygroundRunning] = useState<boolean>(false);
  const [playgroundResult, setPlaygroundResult] = useState<any | null>(null);

  // Load Gateways
  const loadGateways = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/llm-gateways');
      if (res.ok) {
        const data = await res.json();
        setGateways(data.gateways || []);
        if (data.gateways?.length > 0 && !playgroundSelectedSlug) {
          setPlaygroundSelectedSlug(data.gateways[0].slug);
        }
      }
    } catch (err) {
      console.error('Failed to load LLM gateways:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGateways();
  }, []);

  // Open Create Modal
  const handleOpenCreateModal = () => {
    setEditingGateway(null);
    setFormName('');
    setFormSlug('');
    setFormAuthMode('oauth_pkce');
    setFormApiKey('sec_llm_live_' + Math.random().toString(36).substring(2, 10));
    setShowCreateModal(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (gw: LLMGateway) => {
    setEditingGateway(gw);
    setFormName(gw.name);
    setFormSlug(gw.slug);
    setFormAuthMode(gw.inbound_auth?.mode || 'oauth_pkce');
    setFormIssuer(gw.inbound_auth?.issuer || 'https://auth.enterprise.okta.com/oauth2/default');
    setFormClientId(gw.inbound_auth?.client_id || '0oa9k18lq2AbCdEf0h7');
    setFormAudience(gw.inbound_auth?.audience || `https://gateway.corp/llm/${gw.slug}`);
    setFormScopes(gw.inbound_auth?.scopes?.join(', ') || 'llm:chat, llm:stream');
    setFormJwksUri(gw.inbound_auth?.jwks_uri || 'https://auth.enterprise.okta.com/oauth2/default/v1/keys');
    setFormAllowCC(gw.inbound_auth?.allow_client_credentials ?? true);
    setFormAllowApiKey(gw.inbound_auth?.allow_api_key ?? true);
    setFormApiKey(gw.inbound_auth?.api_key || 'sec_llm_live_' + Math.random().toString(36).substring(2, 10));

    // Primary
    setFormPrimaryProvider(gw.primary_backend?.provider || 'azure_openai');
    setFormPrimaryEndpoint(gw.primary_backend?.endpoint || 'https://corp-ai-eastus2.openai.azure.com');
    setFormPrimaryDeployment(gw.primary_backend?.deployment_name || 'gpt-4o-prod');
    setFormPrimaryModelAlias(gw.primary_backend?.model_alias || 'gpt-4o');
    setFormPrimaryRegion(gw.primary_backend?.region || 'eastus2');

    // Fallback
    setFormRoutingStrategy(gw.routing_strategy || 'priority_fallback');
    setFormEnableFallback(gw.fallback_backends?.length > 0);
    if (gw.fallback_backends?.length > 0) {
      setFormFallbackProvider(gw.fallback_backends[0]?.provider || 'aws_bedrock');
      setFormFallbackModelAlias(gw.fallback_backends[0]?.model_alias || 'claude-3-5-sonnet');
      setFormFallbackRegion(gw.fallback_backends[0]?.region || 'us-east-1');
    }

    // Guardrails
    setFormRpm(gw.guardrails?.rate_limits?.requests_per_minute || 1200);
    setFormTpm(gw.guardrails?.rate_limits?.tokens_per_minute || 350000);
    setFormPiiMasking(gw.guardrails?.pii_masking ?? true);
    setFormPromptInjection(gw.guardrails?.prompt_injection_detection ?? true);

    setShowCreateModal(true);
  };

  // Submit Gateway Form
  const handleSubmitGateway = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || (!editingGateway && !formSlug.trim())) {
      showBanner('Name and Slug are required', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        name: formName.trim(),
        slug: formSlug.trim() || undefined,
        inbound_auth: {
          mode: formAuthMode,
          issuer: formIssuer.trim(),
          client_id: formClientId.trim(),
          audience: formAudience.trim(),
          scopes: formScopes.split(',').map(s => s.trim()).filter(Boolean),
          jwks_uri: formJwksUri.trim(),
          allow_client_credentials: formAllowCC,
          allow_api_key: formAllowApiKey,
          api_key: formApiKey.trim()
        },
        primary_backend: {
          provider: formPrimaryProvider,
          endpoint: formPrimaryEndpoint.trim(),
          deployment_name: formPrimaryDeployment.trim(),
          model_alias: formPrimaryModelAlias.trim(),
          region: formPrimaryRegion.trim(),
          model_id: formPrimaryBedrockModelId.trim(),
          weight: 100
        },
        fallback_backends: formEnableFallback ? [
          {
            provider: formFallbackProvider,
            model_alias: formFallbackModelAlias.trim(),
            region: formFallbackRegion.trim(),
            priority: 1,
            trigger_on_status: [429, 500, 502, 503]
          }
        ] : [],
        routing_strategy: formRoutingStrategy,
        guardrails: {
          rate_limits: { requests_per_minute: formRpm, tokens_per_minute: formTpm },
          pii_masking: formPiiMasking,
          prompt_injection_detection: formPromptInjection,
          max_tokens_ceiling: 4096
        }
      };

      const url = editingGateway ? `/api/llm-gateways/${editingGateway.id}` : '/api/llm-gateways';
      const method = editingGateway ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        showBanner(`LLM Gateway "${formName}" ${editingGateway ? 'updated' : 'created'} successfully!`, 'success');
        setShowCreateModal(false);
        await loadGateways();
      } else {
        showBanner(data.error || 'Failed to save LLM gateway', 'error');
      }
    } catch (err: any) {
      showBanner(err.message || 'Network error saving gateway', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Gateway
  const handleDeleteGateway = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete LLM Gateway "${name}"? Consumers connected to this endpoint will be disconnected.`)) return;
    try {
      const res = await fetch(`/api/llm-gateways/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showBanner(`LLM Gateway "${name}" deleted`, 'info');
        await loadGateways();
      } else {
        showBanner('Failed to delete LLM gateway', 'error');
      }
    } catch (err: any) {
      showBanner(err.message, 'error');
    }
  };

  // Run Test in Playground
  const handleRunPlayground = async () => {
    if (!playgroundSelectedSlug) {
      showBanner('Please select an LLM Gateway endpoint to test', 'error');
      return;
    }

    setPlaygroundRunning(true);
    setPlaygroundResult(null);

    try {
      const targetGw = gateways.find(g => g.slug === playgroundSelectedSlug) || gateways[0];
      const res = await fetch(`/api/llm-gateways/${targetGw.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: playgroundPrompt,
          simulate_fallback: playgroundSimulateFallback,
          auth_token: playgroundAuthMode === 'api_key' ? targetGw.inbound_auth?.api_key : 'mock_okta_jwt_token'
        })
      });

      const data = await res.json();
      if (res.ok && data.result) {
        setPlaygroundResult(data.result);
        showBanner(`Response received in ${data.result.latency_ms}ms via ${data.result.provider.toUpperCase()}`, 'success');
        // Refresh metrics
        await loadGateways();
      } else {
        showBanner(data.error || 'Playground execution failed', 'error');
      }
    } catch (err: any) {
      showBanner(err.message || 'Playground request error', 'error');
    } finally {
      setPlaygroundRunning(false);
    }
  };

  // Copy Ingress URL
  const copyIngressUrl = (slug: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    const fullUrl = `${origin}/api/llm/${slug}/v1/chat/completions`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2500);
    showBanner('Standard OpenAI endpoint copied to clipboard!', 'success');
  };

  // Totals
  const totalTokens = gateways.reduce((acc, g) => acc + (g.metrics?.tokens_processed || 0), 0);
  const totalRequests = gateways.reduce((acc, g) => acc + (g.metrics?.requests_total || 0), 0);
  const totalFallbacks = gateways.reduce((acc, g) => acc + (g.metrics?.fallback_events || 0), 0);

  const filteredGateways = gateways.filter(g =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    g.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
    g.primary_backend?.provider?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    g.primary_backend?.model_alias?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.025em' }}>
              LLM Gateway Core
            </h1>
            <span className="badge badge-indigo" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
              🔮 Universal Multi-Cloud AI Proxy
            </span>
            <span className="badge badge-emerald" style={{ fontSize: '0.75rem' }}>
              OpenAI Standard Compatible
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '4px' }}>
            Unified endpoint proxying Azure OpenAI, AWS Bedrock, OpenAI Direct, and Anthropic with per-endpoint Okta OAuth 2.1 PKCE, Client Credentials, and Virtual API Keys.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => setActiveSubTab('playground')}
            className="btn-secondary"
            style={{ height: '38px', padding: '0 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span>⚡</span>
            <span>Interactive Playground</span>
          </button>
          <button
            onClick={handleOpenCreateModal}
            className="btn-primary"
            style={{ height: '38px', padding: '0 18px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span>+</span>
            <span>Create LLM Gateway</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <div className="glass-panel" style={{ padding: '16px' }}>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Active LLM Gateways
          </span>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px' }}>
            {gateways.length} Endpoints
          </div>
          <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600 }}>
            ● 100% Operational Ingress
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '16px' }}>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Total Tokens Processed
          </span>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--primary-text)', marginTop: '4px' }}>
            {(totalTokens / 1000000).toFixed(2)}M Tokens
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Prompt & Completion Combined
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '16px' }}>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Supported Cloud Backends
          </span>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px' }}>
            4 Clouds
          </div>
          <span style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 600 }}>
            Azure • AWS • OpenAI • Anthropic
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '16px' }}>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Automated Failovers
          </span>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#f59e0b', marginTop: '4px' }}>
            {totalFallbacks} Handled
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Zero Consumer Downtime
          </span>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
        {[
          { id: 'endpoints', label: '1. Gateway Endpoints Inventory', icon: '🌐' },
          { id: 'playground', label: '2. Interactive Model Playground', icon: '⚡' },
          { id: 'providers', label: '3. Cloud Provider Matrix', icon: '☁️' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id as any)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: activeSubTab === tab.id ? 'var(--primary)' : 'transparent',
              color: activeSubTab === tab.id ? '#ffffff' : 'var(--text-muted)',
              fontWeight: activeSubTab === tab.id ? 700 : 500,
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* SUB-TAB 1: ENDPOINTS INVENTORY */}
      {activeSubTab === 'endpoints' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Search Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ minWidth: '320px' }}>
              <input
                type="text"
                className="input-field"
                placeholder="Search endpoints by name, slug, provider, or model..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ height: '36px', fontSize: '0.84rem' }}
              />
            </div>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Showing <strong>{filteredGateways.length}</strong> configured LLM gateways
            </span>
          </div>

          {/* Endpoints Table */}
          <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-surface-subtle)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 16px' }}>Endpoint Name & Ingress Path</th>
                    <th style={{ padding: '12px 16px' }}>Inbound Consumer Auth</th>
                    <th style={{ padding: '12px 16px' }}>Primary Cloud Backend</th>
                    <th style={{ padding: '12px 16px' }}>Failover Chain</th>
                    <th style={{ padding: '12px 16px' }}>Tokens & Traffic</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGateways.map((gw) => {
                    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
                    const endpointUrl = `${origin}/api/llm/${gw.slug}/v1/chat/completions`;

                    return (
                      <tr key={gw.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        {/* Name & Ingress Path */}
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{
                              width: '34px',
                              height: '34px',
                              borderRadius: '8px',
                              background: 'linear-gradient(135deg, #6366f1, #38bdf8)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '1rem',
                              color: '#fff'
                            }}>
                              🔮
                            </div>
                            <div>
                              <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)', display: 'block' }}>
                                {gw.name}
                              </strong>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                <code className="font-mono" style={{ fontSize: '0.74rem', color: 'var(--accent-cyan)' }}>
                                  /api/llm/{gw.slug}/v1/chat/completions
                                </code>
                                <button
                                  type="button"
                                  onClick={() => copyIngressUrl(gw.slug)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: '0.72rem',
                                    color: copiedSlug === gw.slug ? '#10b981' : 'var(--text-muted)'
                                  }}
                                  title="Copy standard endpoint"
                                >
                                  {copiedSlug === gw.slug ? '✓ Copied' : '📋'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Inbound Consumer Auth */}
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {gw.inbound_auth?.mode === 'oauth_pkce' && (
                              <span className="badge badge-indigo" style={{ fontSize: '0.7rem' }}>
                                🔑 OAuth 2.1 PKCE (Okta)
                              </span>
                            )}
                            {gw.inbound_auth?.allow_client_credentials && (
                              <span className="badge badge-cyan" style={{ fontSize: '0.68rem' }}>
                                🏢 Client Credentials (Okta)
                              </span>
                            )}
                            {gw.inbound_auth?.allow_api_key && (
                              <span className="badge badge-emerald" style={{ fontSize: '0.68rem' }}>
                                🔒 Virtual API Key
                              </span>
                            )}
                            {gw.inbound_auth?.issuer && (
                              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                IdP: {gw.inbound_auth.issuer.replace('https://', '').split('/')[0]}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Primary Cloud Backend */}
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '1.2rem' }}>
                              {gw.primary_backend?.provider === 'azure_openai' ? '🔷' :
                               gw.primary_backend?.provider === 'aws_bedrock' ? '🟧' :
                               gw.primary_backend?.provider === 'anthropic_direct' ? '🟤' : '🟢'}
                            </span>
                            <div>
                              <strong style={{ color: 'var(--text-main)', fontSize: '0.84rem', display: 'block' }}>
                                {gw.primary_backend?.model_alias || 'gpt-4o'}
                              </strong>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                {gw.primary_backend?.provider?.replace('_', ' ')} • {gw.primary_backend?.region || 'global'}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Failover Chain */}
                        <td style={{ padding: '14px 16px' }}>
                          {gw.fallback_backends && gw.fallback_backends.length > 0 ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span className="badge badge-emerald" style={{ fontSize: '0.68rem' }}>Primary</span>
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>➔</span>
                              {gw.fallback_backends.map((fb, idx) => (
                                <span key={idx} className="badge badge-amber" style={{ fontSize: '0.68rem' }}>
                                  {fb.provider === 'aws_bedrock' ? 'AWS Bedrock' : fb.provider === 'anthropic_direct' ? 'Anthropic' : 'OpenAI'} ({fb.model_alias})
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No fallback configured</span>
                          )}
                        </td>

                        {/* Traffic & Tokens */}
                        <td style={{ padding: '14px 16px' }}>
                          <div>
                            <strong style={{ color: 'var(--text-main)', fontSize: '0.85rem' }}>
                              {gw.metrics?.tokens_processed?.toLocaleString() || '0'} tokens
                            </strong>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {gw.metrics?.requests_total?.toLocaleString() || '0'} calls • {gw.metrics?.avg_latency_ms || 240}ms avg
                            </div>
                          </div>
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setPlaygroundSelectedSlug(gw.slug);
                                setActiveSubTab('playground');
                              }}
                              className="btn-secondary"
                              style={{ padding: '4px 10px', fontSize: '0.76rem', color: 'var(--primary-text)', borderColor: 'var(--border-strong)' }}
                            >
                              ⚡ Playground
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(gw)}
                              className="btn-secondary"
                              style={{ padding: '4px 10px', fontSize: '0.76rem' }}
                            >
                              ⚙️ Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteGateway(gw.id, gw.name)}
                              className="btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '0.76rem', color: 'var(--danger)' }}
                            >
                              ✕
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
        </div>
      )}

      {/* SUB-TAB 2: INTERACTIVE PLAYGROUND */}
      {activeSubTab === 'playground' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(360px, 1.2fr)', gap: '24px' }}>
          {/* Left: Input Console */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                Universal LLM Request Sandbox
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                Test any LLM Gateway endpoint using standard OpenAI chat completion payloads.
              </p>
            </div>

            {/* Target Endpoint Selector */}
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                Target LLM Gateway Endpoint
              </label>
              <select
                className="input-field"
                value={playgroundSelectedSlug}
                onChange={(e) => setPlaygroundSelectedSlug(e.target.value)}
              >
                {gateways.map(g => (
                  <option key={g.id} value={g.slug}>
                    {g.name} (/api/llm/{g.slug}/v1/chat/completions)
                  </option>
                ))}
              </select>
            </div>

            {/* Inbound Consumer Authentication Mode */}
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                Simulate Inbound Consumer Authentication
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                {[
                  { id: 'okta_oauth', label: 'Okta OAuth 2.1 PKCE', desc: 'User JWT' },
                  { id: 'okta_cc', label: 'Okta Client Credentials', desc: 'Machine Token' },
                  { id: 'api_key', label: 'Virtual API Key', desc: 'Bearer Token' }
                ].map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPlaygroundAuthMode(item.id as any)}
                    style={{
                      padding: '10px 8px',
                      borderRadius: 'var(--radius-sm)',
                      border: playgroundAuthMode === item.id ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                      background: playgroundAuthMode === item.id ? 'var(--primary-subtle)' : 'var(--bg-surface-subtle)',
                      color: playgroundAuthMode === item.id ? 'var(--primary-text)' : 'var(--text-main)',
                      fontWeight: 600,
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <div>{item.label}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt Input */}
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                User Prompt Payload (messages array)
              </label>
              <textarea
                className="input-field"
                rows={5}
                value={playgroundPrompt}
                onChange={(e) => setPlaygroundPrompt(e.target.value)}
                placeholder="Enter prompt to execute..."
              />
            </div>

            {/* Failover Simulation Toggle */}
            <div style={{
              background: 'var(--bg-surface-subtle)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <strong style={{ fontSize: '0.84rem', color: 'var(--text-main)', display: 'block' }}>
                  Simulate Primary Outage (429/500 Failover)
                </strong>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  Forces the gateway to trigger automatic fallback to AWS Bedrock or Anthropic.
                </span>
              </div>
              <input
                type="checkbox"
                checked={playgroundSimulateFallback}
                onChange={(e) => setPlaygroundSimulateFallback(e.target.checked)}
                style={{ width: '18px', height: '18px', accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
            </div>

            <button
              type="button"
              disabled={playgroundRunning}
              onClick={handleRunPlayground}
              className="btn-primary"
              style={{ height: '42px', fontSize: '0.9rem', fontWeight: 700 }}
            >
              {playgroundRunning ? 'Proxying Request Across Multi-Cloud...' : '⚡ Send Universal Completion Request'}
            </button>
          </div>

          {/* Right: Output & Telemetry Console */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)' }}>
                Response & OpenTelemetry Diagnostics
              </h3>
              {playgroundResult && (
                <span className={`badge ${playgroundResult.failover_triggered ? 'badge-amber' : 'badge-emerald'}`}>
                  {playgroundResult.failover_triggered ? '⚠️ Failover Triggered' : '● Primary Route OK'}
                </span>
              )}
            </div>

            {playgroundResult ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* Meta Pills */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span className="badge badge-indigo">
                    Backend: {playgroundResult.provider?.toUpperCase()}
                  </span>
                  <span className="badge badge-cyan">
                    Model: {playgroundResult.model}
                  </span>
                  <span className="badge badge-emerald">
                    Latency: {playgroundResult.latency_ms}ms
                  </span>
                  <span className="badge badge-amber">
                    Tokens: {playgroundResult.usage?.total_tokens} ({playgroundResult.usage?.prompt_tokens} prompt / {playgroundResult.usage?.completion_tokens} completion)
                  </span>
                </div>

                {/* Response Text Box */}
                <div style={{
                  background: '#090d16',
                  color: '#e2e8f0',
                  padding: '16px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.84rem',
                  lineHeight: 1.6,
                  border: '1px solid #1e293b',
                  minHeight: '120px'
                }}>
                  {playgroundResult.response_text}
                </div>

                {/* Standardized Response JSON */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
                    OpenAI Standard Response Wire JSON
                  </label>
                  <pre style={{
                    background: '#090d16',
                    color: '#38bdf8',
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.74rem',
                    fontFamily: 'monospace',
                    overflowX: 'auto',
                    border: '1px solid #1e293b',
                    margin: 0
                  }}>
{JSON.stringify(playgroundResult, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div style={{
                flex: 1,
                minHeight: '260px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px dashed var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-muted)',
                textAlign: 'center',
                padding: '24px'
              }}>
                <span style={{ fontSize: '2.4rem', marginBottom: '10px' }}>🔮</span>
                <strong style={{ color: 'var(--text-main)', fontSize: '0.95rem' }}>Awaiting Request Execution</strong>
                <p style={{ fontSize: '0.8rem', maxWidth: '360px', marginTop: '6px' }}>
                  Select an endpoint, choose your simulated Okta or API Key authentication, and execute a chat request to inspect real-time routing.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: CLOUD PROVIDER MATRIX */}
      {activeSubTab === 'providers' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
          {[
            {
              provider: 'Azure OpenAI Service',
              icon: '🔷',
              status: 'Connected & Verified',
              region: 'East US 2 / West US',
              deployments: ['gpt-4o-prod', 'gpt-4o-mini-prod', 'text-embedding-3-large'],
              quota: '2,000,000 TPM',
              protocol: 'OpenAI REST v2024-08-01-preview'
            },
            {
              provider: 'AWS Bedrock',
              icon: '🟧',
              status: 'Connected & Verified',
              region: 'us-east-1 / us-west-2',
              deployments: ['anthropic.claude-3-5-sonnet', 'meta.llama3-70b-instruct'],
              quota: '1,500,000 TPM',
              protocol: 'Bedrock Runtime InvokeModel API'
            },
            {
              provider: 'OpenAI Direct',
              icon: '🟢',
              status: 'Connected & Verified',
              region: 'Global Anycast',
              deployments: ['gpt-4o', 'gpt-4o-mini', 'o1-preview'],
              quota: '3,000,000 TPM',
              protocol: 'Standard OpenAI REST v1'
            },
            {
              provider: 'Anthropic Direct',
              icon: '🟤',
              status: 'Connected & Verified',
              region: 'Global Anycast',
              deployments: ['claude-3-5-sonnet-latest', 'claude-3-opus-20240229'],
              quota: '2,500,000 TPM',
              protocol: 'Anthropic Messages API v2023-06-01'
            }
          ].map((item, idx) => (
            <div key={idx} className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.6rem' }}>{item.icon}</span>
                  <div>
                    <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)', display: 'block' }}>
                      {item.provider}
                    </strong>
                    <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600 }}>
                      ● {item.status}
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.78rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Target Region:</span>
                  <strong style={{ color: 'var(--text-main)' }}>{item.region}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Provisioned Quota:</span>
                  <strong style={{ color: 'var(--primary-text)' }}>{item.quota}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Protocol:</span>
                  <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.protocol}</span>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                  Mapped Model Deployments:
                </span>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {item.deployments.map((d, i) => (
                    <span key={i} className="badge badge-indigo" style={{ fontSize: '0.65rem' }}>
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CREATE / EDIT LLM GATEWAY MODAL */}
      {showCreateModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="glass-panel" style={{ width: '740px', maxHeight: '90vh', overflowY: 'auto', padding: '30px', background: 'var(--bg-surface)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.6rem' }}>🔮</span>
                <div>
                  <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                    {editingGateway ? `Configure LLM Gateway: ${editingGateway.name}` : 'Create New LLM Gateway Endpoint'}
                  </h3>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Standard OpenAI-compatible endpoint with Okta OAuth PKCE, CC, and multi-cloud routing.
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.3rem', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitGateway} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* SECTION 1: IDENTITY */}
              <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary-text)', marginBottom: '10px', textTransform: 'uppercase' }}>
                  1. Gateway Ingress Identity
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                      Gateway Name
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. Enterprise Multi-Cloud Chat Gateway"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                      Endpoint Slug (/api/llm/[slug]/v1)
                    </label>
                    <input
                      type="text"
                      className="input-field font-mono"
                      placeholder="e.g. enterprise-chat"
                      value={formSlug}
                      onChange={(e) => setFormSlug(e.target.value)}
                      disabled={!!editingGateway}
                      required
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 2: INBOUND CONSUMER AUTHENTICATION (OKTA, PKCE, CC, API KEY) */}
              <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary-text)', marginBottom: '10px', textTransform: 'uppercase' }}>
                  2. Inbound Consumer Authentication (Per Endpoint)
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginBottom: '14px' }}>
                  {[
                    { id: 'oauth_pkce', label: 'OAuth 2.1 PKCE (Okta)', desc: 'Interactive browser/app authorization code with PKCE' },
                    { id: 'client_credentials', label: 'Client Credentials (Okta)', desc: 'Direct machine-to-machine OAuth 2.0 grant flow' },
                    { id: 'api_key', label: 'Virtual API Key', desc: 'Secure hashed Bearer API key per gateway endpoint' }
                  ].map(mode => (
                    <div
                      key={mode.id}
                      onClick={() => setFormAuthMode(mode.id as any)}
                      style={{
                        padding: '12px',
                        borderRadius: 'var(--radius-sm)',
                        border: formAuthMode === mode.id ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                        background: formAuthMode === mode.id ? 'var(--primary-subtle)' : 'var(--bg-surface-subtle)',
                        cursor: 'pointer'
                      }}
                    >
                      <strong style={{ fontSize: '0.82rem', color: formAuthMode === mode.id ? 'var(--primary-text)' : 'var(--text-main)', display: 'block' }}>
                        {mode.label}
                      </strong>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{mode.desc}</span>
                    </div>
                  ))}
                </div>

                {/* Okta OAuth PKCE / CC Fields */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                      External IdP Token Issuer (Okta)
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="https://auth.enterprise.okta.com/oauth2/default"
                      value={formIssuer}
                      onChange={(e) => setFormIssuer(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                      Client ID (Okta App)
                    </label>
                    <input
                      type="text"
                      className="input-field font-mono"
                      placeholder="0oa9k18lq2AbCdEf0h7"
                      value={formClientId}
                      onChange={(e) => setFormClientId(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                      Required Audiences (aud)
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="https://gateway.corp/llm"
                      value={formAudience}
                      onChange={(e) => setFormAudience(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                      JWKS Public Keys URI
                    </label>
                    <input
                      type="text"
                      className="input-field font-mono"
                      placeholder="https://.../v1/keys"
                      value={formJwksUri}
                      onChange={(e) => setFormJwksUri(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginTop: '12px', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-main)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={formAllowCC}
                      onChange={(e) => setFormAllowCC(e.target.checked)}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    <span>Allow Client Credentials (CC) Flow</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-main)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={formAllowApiKey}
                      onChange={(e) => setFormAllowApiKey(e.target.checked)}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    <span>Allow Virtual API Key (Authorization: Bearer)</span>
                  </label>
                </div>
              </div>

              {/* SECTION 3: PRIMARY BACKEND PROVIDER */}
              <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary-text)', marginBottom: '10px', textTransform: 'uppercase' }}>
                  3. Primary Cloud Model Backend
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                      Backend Provider
                    </label>
                    <select
                      className="input-field"
                      value={formPrimaryProvider}
                      onChange={(e) => setFormPrimaryProvider(e.target.value as any)}
                    >
                      <option value="azure_openai">Azure OpenAI Service</option>
                      <option value="aws_bedrock">AWS Bedrock (Claude / Llama)</option>
                      <option value="openai_direct">OpenAI Direct</option>
                      <option value="anthropic_direct">Anthropic Direct (Claude 3.5)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                      Standard Model Alias (What consumer calls)
                    </label>
                    <input
                      type="text"
                      className="input-field font-mono"
                      placeholder="e.g. gpt-4o or claude-3-5-sonnet"
                      value={formPrimaryModelAlias}
                      onChange={(e) => setFormPrimaryModelAlias(e.target.value)}
                    />
                  </div>

                  {formPrimaryProvider === 'azure_openai' && (
                    <>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                          Azure Resource Endpoint
                        </label>
                        <input
                          type="text"
                          className="input-field font-mono"
                          placeholder="https://corp.openai.azure.com"
                          value={formPrimaryEndpoint}
                          onChange={(e) => setFormPrimaryEndpoint(e.target.value)}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                          Azure Deployment Name
                        </label>
                        <input
                          type="text"
                          className="input-field font-mono"
                          placeholder="gpt-4o-prod"
                          value={formPrimaryDeployment}
                          onChange={(e) => setFormPrimaryDeployment(e.target.value)}
                        />
                      </div>
                    </>
                  )}

                  {formPrimaryProvider === 'aws_bedrock' && (
                    <>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                          AWS Region
                        </label>
                        <input
                          type="text"
                          className="input-field font-mono"
                          placeholder="us-east-1"
                          value={formPrimaryRegion}
                          onChange={(e) => setFormPrimaryRegion(e.target.value)}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                          Bedrock Model ID
                        </label>
                        <input
                          type="text"
                          className="input-field font-mono"
                          placeholder="anthropic.claude-3-5-sonnet-20240620-v1:0"
                          value={formPrimaryBedrockModelId}
                          onChange={(e) => setFormPrimaryBedrockModelId(e.target.value)}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* SECTION 4: AUTOMATIC FALLBACK & ROUTING STRATEGY */}
              <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary-text)', textTransform: 'uppercase', margin: 0 }}>
                    4. Failover Chain & Routing Strategy
                  </h4>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-main)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={formEnableFallback}
                      onChange={(e) => setFormEnableFallback(e.target.checked)}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    <span>Enable Multi-Cloud Automatic Fallback</span>
                  </label>
                </div>

                {formEnableFallback && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                        Fallback Cloud Provider
                      </label>
                      <select
                        className="input-field"
                        value={formFallbackProvider}
                        onChange={(e) => setFormFallbackProvider(e.target.value as any)}
                      >
                        <option value="aws_bedrock">AWS Bedrock (Claude 3.5 Sonnet)</option>
                        <option value="anthropic_direct">Anthropic Direct</option>
                        <option value="azure_openai">Azure OpenAI</option>
                        <option value="openai_direct">OpenAI Direct</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                        Fallback Model Alias
                      </label>
                      <input
                        type="text"
                        className="input-field font-mono"
                        value={formFallbackModelAlias}
                        onChange={(e) => setFormFallbackModelAlias(e.target.value)}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                        Routing Strategy
                      </label>
                      <select
                        className="input-field"
                        value={formRoutingStrategy}
                        onChange={(e) => setFormRoutingStrategy(e.target.value as any)}
                      >
                        <option value="priority_fallback">Priority Fallback on 429/500</option>
                        <option value="lowest_latency">Lowest Latency Dynamic</option>
                        <option value="weighted_round_robin">Weighted Round-Robin</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 5: GUARDRAILS & RATE LIMITS */}
              <div>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary-text)', marginBottom: '10px', textTransform: 'uppercase' }}>
                  5. Guardrails & Token Rate Limits
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                      Requests Per Minute (RPM)
                    </label>
                    <input
                      type="number"
                      className="input-field"
                      value={formRpm}
                      onChange={(e) => setFormRpm(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                      Tokens Per Minute (TPM)
                    </label>
                    <input
                      type="number"
                      className="input-field"
                      value={formTpm}
                      onChange={(e) => setFormTpm(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-main)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={formPiiMasking}
                      onChange={(e) => setFormPiiMasking(e.target.checked)}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    <span>PII Masking (Redact SSN, credit cards, emails)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-main)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={formPromptInjection}
                      onChange={(e) => setFormPromptInjection(e.target.checked)}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    <span>Prompt Injection & Jailbreak Defense</span>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn-secondary"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving Gateway...' : editingGateway ? 'Update LLM Gateway' : 'Deploy LLM Gateway'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
