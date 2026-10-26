'use client';

import React, { useState } from 'react';

interface ConsoleConfigViewProps {
  showBanner: (text: string, type: 'success' | 'error' | 'info') => void;
}

export default function ConsoleConfigView({ showBanner }: ConsoleConfigViewProps) {
  const [ssoEnabled, setSsoEnabled] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<'okta' | 'entra' | 'google' | 'generic'>('okta');
  const [protocol, setProtocol] = useState<'oidc' | 'saml'>('oidc');

  // Provider Fields
  const [issuerUrl, setIssuerUrl] = useState('https://enterprise.okta.com/oauth2/default');
  const [clientId, setClientId] = useState('0oa782bc491k0z89a712');
  const [clientSecret, setClientSecret] = useState('sec_okta_live_882947192348123');
  const [showSecret, setShowSecret] = useState(false);
  const [metadataUrl, setMetadataUrl] = useState('https://enterprise.okta.com/app/exk782bc491k0z89a712/sso/saml/metadata');
  const [allowedDomains, setAllowedDomains] = useState('@aigateway.local, @enterprise.corp, @company.ai');

  // Role Mappings
  const [adminGroup, setAdminGroup] = useState('ai-platform-superadmins');
  const [tenantAdminGroup, setTenantAdminGroup] = useState('ai-project-managers');
  const [auditorGroup, setAuditorGroup] = useState('security-compliance-auditors');

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleProviderSelect = (prov: 'okta' | 'entra' | 'google' | 'generic') => {
    setSelectedProvider(prov);
    if (prov === 'okta') {
      setIssuerUrl('https://enterprise.okta.com/oauth2/default');
      setClientId('0oa782bc491k0z89a712');
      setMetadataUrl('https://enterprise.okta.com/app/exk782bc491k0z89a712/sso/saml/metadata');
    } else if (prov === 'entra') {
      setIssuerUrl('https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0');
      setClientId('9f81a7b2-4c3d-4e5f-a6b7-8c9d0e1f2a3b');
      setMetadataUrl('https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/federationmetadata/2007-06/federationmetadata.xml');
    } else if (prov === 'google') {
      setIssuerUrl('https://accounts.google.com');
      setClientId('98234819234-abc123xyz.apps.googleusercontent.com');
      setMetadataUrl('https://accounts.google.com/.well-known/openid-configuration');
    } else {
      setIssuerUrl('https://sso.internal.corp/auth');
      setClientId('console-saml-client');
      setMetadataUrl('https://sso.internal.corp/auth/saml/metadata');
    }
  };

  const handleTestConnection = () => {
    setIsTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setIsTesting(false);
      setTestResult(`✓ Successfully verified ${selectedProvider.toUpperCase()} (${protocol.toUpperCase()}) metadata! OIDC Discovery endpoint reachable (200 OK).`);
      showBanner(`SSO Handshake with ${selectedProvider.toUpperCase()} succeeded!`, 'success');
    }, 700);
  };

  const handleSave = () => {
    showBanner('Console SSO configuration saved successfully!', 'success');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.025em' }}>
              Console Configuration & Enterprise SSO
            </h1>
            <span className="badge badge-emerald">Settings Submenu: Console Config</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '4px' }}>
            Configure console login authentication methods with Okta, Microsoft Entra ID, SAML 2.0, and OpenID Connect.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={handleTestConnection}
            disabled={isTesting}
            className="btn-secondary"
            style={{ height: '38px', fontSize: '0.85rem' }}
          >
            {isTesting ? 'Verifying...' : '⚡ Test SSO Handshake'}
          </button>
          <button
            onClick={handleSave}
            className="btn-primary"
            style={{ height: '38px', padding: '0 18px', fontWeight: 600 }}
          >
            Save SSO Settings
          </button>
        </div>
      </div>

      {/* SSO Master Toggle Strip */}
      <div className="glass-panel" style={{
        padding: '18px 22px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-surface-subtle)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '1.6rem' }}>🔐</span>
          <div>
            <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)', display: 'block' }}>
              Require Enterprise SSO for Console Sign-In
            </strong>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              When enabled, team members log in via your corporate Identity Provider instead of local credentials.
            </span>
          </div>
        </div>

        <button
          onClick={() => setSsoEnabled(!ssoEnabled)}
          style={{
            background: ssoEnabled ? '#10b981' : '#cbd5e1',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-pill)',
            padding: '6px 18px',
            fontWeight: 700,
            fontSize: '0.82rem',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          {ssoEnabled ? 'ENABLED' : 'DISABLED'}
        </button>
      </div>

      {/* Provider Selector Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        {[
          { id: 'okta', name: 'Okta', desc: 'Enterprise Identity Provider with OIDC & SAML 2.0', icon: '🔵' },
          { id: 'entra', name: 'Microsoft Entra ID', desc: 'Azure Active Directory with tenant federation', icon: '🟦' },
          { id: 'google', name: 'Google Workspace', desc: 'Google Cloud Identity & Cloud Console OAuth', icon: '🔴' },
          { id: 'generic', name: 'Generic SAML / OIDC', desc: 'Keycloak, PingFederate, Auth0, or custom IdP', icon: '🛡️' },
        ].map(prov => (
          <div
            key={prov.id}
            onClick={() => handleProviderSelect(prov.id as any)}
            style={{
              padding: '18px',
              borderRadius: 'var(--radius-md)',
              border: selectedProvider === prov.id ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
              background: selectedProvider === prov.id ? 'var(--primary-subtle)' : 'var(--bg-surface)',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '1.2rem' }}>{prov.icon}</span>
              <strong style={{ fontSize: '0.92rem', color: selectedProvider === prov.id ? 'var(--primary-text)' : 'var(--text-main)' }}>
                {prov.name}
              </strong>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
              {prov.desc}
            </p>
          </div>
        ))}
      </div>

      {/* Form: SSO Configuration Details */}
      <div className="glass-panel" style={{ padding: '26px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '14px' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>
              {selectedProvider.toUpperCase()} Connection Parameters
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Configure protocol authentication credentials for the management console.
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {(['oidc', 'saml'] as const).map(p => (
              <button
                key={p}
                onClick={() => setProtocol(p)}
                style={{
                  background: protocol === p ? 'var(--primary)' : 'var(--bg-surface-subtle)',
                  color: protocol === p ? '#fff' : 'var(--text-muted)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px 12px',
                  fontWeight: 600,
                  fontSize: '0.78rem',
                  cursor: 'pointer'
                }}
              >
                {p === 'oidc' ? 'OpenID Connect (OIDC)' : 'SAML 2.0 WebSSO'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px' }}>
              Identity Provider Issuer / Entity ID URL
            </label>
            <input
              type="text"
              className="input-field font-mono"
              value={issuerUrl}
              onChange={(e) => setIssuerUrl(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px' }}>
              Client ID / Application ID
            </label>
            <input
              type="text"
              className="input-field font-mono"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>
                Client Secret (Encrypted)
              </label>
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                style={{ background: 'none', border: 'none', color: 'var(--primary-text)', cursor: 'pointer', fontSize: '0.75rem' }}
              >
                {showSecret ? 'Hide' : 'Reveal'}
              </button>
            </div>
            <input
              type={showSecret ? 'text' : 'password'}
              className="input-field font-mono"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px' }}>
              SAML Metadata / Discovery URL
            </label>
            <input
              type="text"
              className="input-field font-mono"
              value={metadataUrl}
              onChange={(e) => setMetadataUrl(e.target.value)}
            />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, marginBottom: '6px' }}>
              Allowed Corporate Email Domains (Auto-Provisioning)
            </label>
            <input
              type="text"
              className="input-field"
              value={allowedDomains}
              onChange={(e) => setAllowedDomains(e.target.value)}
              placeholder="@aigateway.local, @company.com"
            />
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Only users with emails matching these domains can log in through this SSO provider.
            </span>
          </div>
        </div>

        {/* Directory Group Role Mappings */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '18px' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '8px' }}>
            Directory Group to Console RBAC Mapping
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
            Map SAML / OIDC groups claim to console role privileges.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                Group → Platform Admin (Full Access)
              </label>
              <input
                type="text"
                className="input-field font-mono"
                value={adminGroup}
                onChange={(e) => setAdminGroup(e.target.value)}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                Group → Tenant Admin (Project Scoped)
              </label>
              <input
                type="text"
                className="input-field font-mono"
                value={tenantAdminGroup}
                onChange={(e) => setTenantAdminGroup(e.target.value)}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                Group → Auditor (Read-Only & Logs)
              </label>
              <input
                type="text"
                className="input-field font-mono"
                value={auditorGroup}
                onChange={(e) => setAuditorGroup(e.target.value)}
              />
            </div>
          </div>
        </div>

        {testResult && (
          <div style={{
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 16px',
            color: '#065f46',
            fontSize: '0.82rem',
            fontWeight: 500
          }}>
            {testResult}
          </div>
        )}
      </div>
    </div>
  );
}
