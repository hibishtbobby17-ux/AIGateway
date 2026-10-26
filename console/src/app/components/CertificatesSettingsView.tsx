'use client';

import React, { useState, useEffect } from 'react';

interface CertificatesSettingsViewProps {
  gatewaysList: any[];
  selectedGatewayId?: string;
  onRefreshGateways: () => void;
  showBanner: (text: string, type: 'success' | 'error' | 'info') => void;
}

export default function CertificatesSettingsView({
  gatewaysList,
  selectedGatewayId,
  onRefreshGateways,
  showBanner,
}: CertificatesSettingsViewProps) {
  const [selectedTarget, setSelectedTarget] = useState<string>(selectedGatewayId || 'global');

  // Inbound TLS State
  const [inboundProtocol, setInboundProtocol] = useState<'https' | 'http'>('https');
  const [certMode, setCertMode] = useState<'auto_cert' | 'custom_file' | 'self_signed'>('auto_cert');
  const [minTlsVersion, setMinTlsVersion] = useState<'TLS 1.3' | 'TLS 1.2'>('TLS 1.3');
  const [sans, setSans] = useState<string>('localhost, 127.0.0.1, ::1, ai-gateway, gateway.internal');
  const [clientAuthMode, setClientAuthMode] = useState<'none' | 'request' | 'require'>('none');
  const [certPem, setCertPem] = useState<string>('');
  const [keyPem, setKeyPem] = useState<string>('');
  const [clientCaPem, setClientCaPem] = useState<string>('');
  const [showPrivateKey, setShowPrivateKey] = useState<boolean>(false);

  // Cipher Suites State
  const [selectedCiphers, setSelectedCiphers] = useState<string[]>([
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
  ]);

  // Downstream TLS State
  const [insecureSkipVerify, setInsecureSkipVerify] = useState<boolean>(false);
  const [downstreamMinTls, setDownstreamMinTls] = useState<'TLS 1.2' | 'TLS 1.3'>('TLS 1.2');
  const [downstreamCaPem, setDownstreamCaPem] = useState<string>('');
  const [downstreamClientCertPem, setDownstreamClientCertPem] = useState<string>('');
  const [downstreamClientKeyPem, setDownstreamClientKeyPem] = useState<string>('');

  // Gateway Runtime Parameters
  const [publicUrl, setPublicUrl] = useState<string>('http://localhost:8080');
  const [dialTimeoutMs, setDialTimeoutMs] = useState<number>(5000);
  const [callTimeoutMs, setCallTimeoutMs] = useState<number>(15000);
  const [failStaticCache, setFailStaticCache] = useState<boolean>(true);
  const [cacheTtlSeconds, setCacheTtlSeconds] = useState<number>(300);
  const [heartbeatIntervalSec, setHeartbeatIntervalSec] = useState<number>(15);

  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);

  // Load settings on mount or target change
  useEffect(() => {
    loadSettings();
  }, [selectedTarget]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      if (selectedTarget === 'global') {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          const s = data.settings || {};
          const tlsIn = s.tls?.inbound || {};
          const tlsDown = s.tls?.downstream || {};
          const gw = s.gateway || {};

          setInboundProtocol(tlsIn.protocol || 'https');
          setCertMode(tlsIn.cert_mode || 'auto_cert');
          setMinTlsVersion(tlsIn.min_version || 'TLS 1.3');
          setSans(Array.isArray(tlsIn.sans) ? tlsIn.sans.join(', ') : 'localhost, 127.0.0.1, ::1');
          setClientAuthMode(tlsIn.client_auth || 'none');
          setCertPem(tlsIn.cert_pem || '');
          setKeyPem(tlsIn.key_pem || '');
          setClientCaPem(tlsIn.client_ca_pem || '');
          if (Array.isArray(tlsIn.cipher_suites)) setSelectedCiphers(tlsIn.cipher_suites);

          setInsecureSkipVerify(!!tlsDown.insecure_skip_verify);
          setDownstreamMinTls(tlsDown.min_version || 'TLS 1.2');
          setDownstreamCaPem(tlsDown.custom_ca_pem || '');
          setDownstreamClientCertPem(tlsDown.client_cert_pem || '');
          setDownstreamClientKeyPem(tlsDown.client_key_pem || '');

          setPublicUrl(gw.public_url || 'http://localhost:8080');
          setDialTimeoutMs(gw.dial_timeout_ms || 5000);
          setCallTimeoutMs(gw.call_timeout_ms || 15000);
          setFailStaticCache(gw.fail_static_cache !== false);
          setCacheTtlSeconds(gw.cache_ttl_seconds || 300);
          setHeartbeatIntervalSec(gw.heartbeat_interval_sec || 15);
        }
      } else {
        // Load gateway-specific configuration
        const res = await fetch(`/api/gateways/${selectedTarget}`);
        if (res.ok) {
          const data = await res.json();
          const gw = data.gateway || {};
          const telemetry = gw.tls_telemetry || {};
          const inb = telemetry.inbound || {};
          const down = telemetry.downstream || {};

          setInboundProtocol(gw.protocol === 'https' || gw.tls_enabled ? 'https' : 'http');
          setCertMode(inb.cert_mode || 'auto_cert');
          setMinTlsVersion(inb.min_version || 'TLS 1.3');
          setSans(Array.isArray(inb.sans) ? inb.sans.join(', ') : 'localhost, 127.0.0.1, ::1');
          setClientAuthMode(inb.client_auth || 'none');

          setInsecureSkipVerify(!!down.insecure_skip_verify);
          setDownstreamMinTls(down.min_version || 'TLS 1.2');
          setPublicUrl(gw.base_url || 'http://localhost:8080');
        }
      }
      setHasUnsavedChanges(false);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const sansArray = sans.split(',').map((s) => s.trim()).filter(Boolean);

      const payload = {
        settings: {
          tls: {
            inbound: {
              protocol: inboundProtocol,
              cert_mode: certMode,
              min_version: minTlsVersion,
              sans: sansArray,
              client_auth: clientAuthMode,
              cert_pem: certPem,
              key_pem: keyPem,
              client_ca_pem: clientCaPem,
              cipher_suites: selectedCiphers,
            },
            downstream: {
              insecure_skip_verify: insecureSkipVerify,
              min_version: downstreamMinTls,
              custom_ca_pem: downstreamCaPem,
              client_cert_pem: downstreamClientCertPem,
              client_key_pem: downstreamClientKeyPem,
            },
          },
          gateway: {
            public_url: publicUrl.trim(),
            dial_timeout_ms: Number(dialTimeoutMs),
            call_timeout_ms: Number(callTimeoutMs),
            fail_static_cache: failStaticCache,
            cache_ttl_seconds: Number(cacheTtlSeconds),
            heartbeat_interval_sec: Number(heartbeatIntervalSec),
          },
        },
      };

      if (selectedTarget === 'global') {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to save global settings');
        }
      } else {
        // Save to specific gateway instance
        const gwPayload = {
          protocol: inboundProtocol,
          tls_enabled: inboundProtocol === 'https',
          tls_telemetry: {
            inbound: {
              enabled: inboundProtocol === 'https',
              cert_mode: certMode,
              min_version: minTlsVersion,
              sans: sansArray,
              client_auth: clientAuthMode,
              has_client_ca: !!clientCaPem.trim(),
            },
            downstream: {
              insecure_skip_verify: insecureSkipVerify,
              min_version: downstreamMinTls,
              has_custom_ca: !!downstreamCaPem.trim(),
              has_client_cert: !!downstreamClientCertPem.trim(),
            },
          },
        };
        const res = await fetch(`/api/gateways/${selectedTarget}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(gwPayload),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to save gateway settings');
        }
      }

      setHasUnsavedChanges(false);
      await onRefreshGateways();
      showBanner('TLS and Certificate settings successfully deployed to Gateway Fleet!', 'success');
    } catch (err: any) {
      showBanner(err.message || 'Error deploying settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleCipher = (cipher: string) => {
    setSelectedCiphers((prev) =>
      prev.includes(cipher) ? prev.filter((c) => c !== cipher) : [...prev, cipher]
    );
    setHasUnsavedChanges(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header Banner */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span style={{ fontSize: '1.8rem' }}>🔒</span>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              Certificates &amp; Gateway Security Hub
            </h2>
            <span className="badge badge-emerald" style={{ fontSize: '0.72rem' }}>
              TLS 1.3 Ready
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
            Configure Inbound HTTPS listeners, client mTLS authentication, upstream PKI trust bundles, and gateway resiliency.
          </p>
        </div>

        <button
          onClick={handleSaveSettings}
          disabled={saving}
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
          <span>{saving ? '⏳' : '💾'}</span>
          <span>{saving ? 'Deploying to Gateways...' : 'Save & Deploy TLS Configuration'}</span>
          {hasUnsavedChanges && (
            <span style={{ background: '#ffffff', color: 'var(--primary)', fontSize: '0.68rem', fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--radius-pill)' }}>
              Unsaved
            </span>
          )}
        </button>
      </div>

      {/* Target Gateway Selector */}
      <div className="glass-panel" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Configuration Scope:
          </span>
          <select
            value={selectedTarget}
            onChange={(e) => setSelectedTarget(e.target.value)}
            className="input-field"
            style={{ minWidth: '260px', padding: '8px 12px', fontSize: '0.9rem', fontWeight: 600 }}
          >
            <option value="global">🌐 Organization-Wide Platform Defaults</option>
            {gatewaysList.map((gw) => (
              <option key={gw.id} value={gw.id}>
                ⚡ Instance: {gw.name} (v{gw.version || '1.0.0'})
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.78rem' }}>
          <span className={`badge ${inboundProtocol === 'https' ? 'badge-emerald' : 'badge-amber'}`} style={{ fontSize: '0.7rem' }}>
            {inboundProtocol === 'https' ? '🔒 Inbound HTTPS Active' : '🌐 Plaintext HTTP Active'}
          </span>
          <span className="badge badge-cyan" style={{ fontSize: '0.7rem' }}>
            {minTlsVersion} Enforced
          </span>
        </div>
      </div>

      {/* Security Health Highlights */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <div className="glass-panel" style={{ padding: '16px 20px', borderLeft: '4px solid #10b981' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Certificate Mode
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '4px' }}>
            {certMode === 'auto_cert' ? 'Let\'s Encrypt ACME' : certMode === 'custom_file' ? 'Custom PEM Certificate' : 'Self-Signed Dev CA'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--accent-emerald)', marginTop: '4px' }}>
            Automated Handshake Verification
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '16px 20px', borderLeft: '4px solid #06b6d4' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Client mTLS Mode
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-cyan)', marginTop: '4px' }}>
            {clientAuthMode === 'none' ? 'Standard 1-Way TLS' : clientAuthMode === 'request' ? 'Optional Client Cert' : 'Strict Client mTLS'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '4px' }}>
            {clientCaPem ? 'Client Root CA Mounted' : 'No Client CA Required'}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '16px 20px', borderLeft: `4px solid ${insecureSkipVerify ? '#f43f5e' : '#10b981'}` }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Downstream Verification
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: insecureSkipVerify ? '#f43f5e' : '#10b981', marginTop: '4px' }}>
            {insecureSkipVerify ? '⚠️ InsecureSkipVerify' : '🔒 Strict Chain Verified'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '4px' }}>
            {downstreamCaPem ? 'Custom Enterprise CA Active' : 'System Web PKI Root'}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '16px 20px', borderLeft: '4px solid #6366f1' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Egress Resiliency
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-indigo)', marginTop: '4px' }}>
            {failStaticCache ? 'Fail-Static Enabled' : 'Strict Upstream-Only'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '4px' }}>
            Cache TTL: {cacheTtlSeconds}s
          </div>
        </div>
      </div>

      {/* Section 1: Inbound Listener TLS Settings */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
          <span style={{ fontSize: '1.3rem' }}>🛡️</span>
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              1. Inbound Gateway Listener Security (:8080)
            </h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Controls encryption and certificates for incoming MCP connections from clients and agents.
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '20px' }}>
          {/* Protocol Toggle */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>
              Listener Protocol
            </label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => {
                  setInboundProtocol('https');
                  setHasUnsavedChanges(true);
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: 'var(--radius-sm)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  border: inboundProtocol === 'https' ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                  background: inboundProtocol === 'https' ? 'var(--primary-subtle)' : 'var(--bg-surface-subtle)',
                  color: inboundProtocol === 'https' ? 'var(--primary-text)' : 'var(--text-muted)',
                }}
              >
                🔒 HTTPS (Encrypted)
              </button>
              <button
                onClick={() => {
                  setInboundProtocol('http');
                  setHasUnsavedChanges(true);
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: 'var(--radius-sm)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  border: inboundProtocol === 'http' ? '2px solid #f59e0b' : '1px solid var(--border-subtle)',
                  background: inboundProtocol === 'http' ? '#fef3c7' : 'var(--bg-surface-subtle)',
                  color: inboundProtocol === 'http' ? '#b45309' : 'var(--text-muted)',
                }}
              >
                🌐 HTTP (Plaintext)
              </button>
            </div>
          </div>

          {/* Certificate Mode */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>
              Certificate Source &amp; Management
            </label>
            <select
              value={certMode}
              onChange={(e) => {
                setCertMode(e.target.value as any);
                setHasUnsavedChanges(true);
              }}
              className="input-field"
              style={{ width: '100%', height: '42px', fontSize: '0.85rem' }}
            >
              <option value="auto_cert">Let's Encrypt / ACME Automated Issuance</option>
              <option value="custom_file">Custom PEM Certificate &amp; Private Key</option>
              <option value="self_signed">Self-Signed Ephemeral Developer Certificate</option>
            </select>
          </div>

          {/* Minimum TLS Version */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>
              Minimum TLS Protocol Version
            </label>
            <select
              value={minTlsVersion}
              onChange={(e) => {
                setMinTlsVersion(e.target.value as any);
                setHasUnsavedChanges(true);
              }}
              className="input-field"
              style={{ width: '100%', height: '42px', fontSize: '0.85rem' }}
            >
              <option value="TLS 1.3">TLS 1.3 (Strict Modern Security)</option>
              <option value="TLS 1.2">TLS 1.2 (Legacy Client Compatibility)</option>
            </select>
          </div>
        </div>

        {/* SANs Input */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
            Subject Alternative Names (SANs)
          </label>
          <input
            type="text"
            value={sans}
            onChange={(e) => {
              setSans(e.target.value);
              setHasUnsavedChanges(true);
            }}
            placeholder="localhost, 127.0.0.1, ::1, ai-gateway.corp.local, *.mcp.internal"
            className="input-field"
            style={{ width: '100%', fontSize: '0.82rem' }}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>
            DNS names and IP addresses allowed for TLS handshake validation.
          </span>
        </div>

        {/* Client mTLS Configuration */}
        <div style={{ background: 'var(--bg-surface-subtle)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', marginBottom: '20px' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px' }}>
            Mutual TLS (mTLS) Client Verification
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                Client Certificate Verification Mode
              </label>
              <select
                value={clientAuthMode}
                onChange={(e) => {
                  setClientAuthMode(e.target.value as any);
                  setHasUnsavedChanges(true);
                }}
                className="input-field"
                style={{ width: '100%', fontSize: '0.82rem' }}
              >
                <option value="none">None (Standard One-Way Server TLS)</option>
                <option value="request">Optional (Request Client Cert, Do Not Enforce)</option>
                <option value="require">Require &amp; Verify Client Cert (Strict mTLS)</option>
              </select>
            </div>

            {clientAuthMode !== 'none' && (
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Client CA Trust Bundle (PEM)
                </label>
                <textarea
                  rows={3}
                  value={clientCaPem}
                  onChange={(e) => {
                    setClientCaPem(e.target.value);
                    setHasUnsavedChanges(true);
                  }}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                  className="input-field"
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.72rem' }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Custom PEM Certificate & Key inputs (if custom_file mode) */}
        {certMode === 'custom_file' && (
          <div style={{ background: 'var(--bg-surface-subtle)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', marginBottom: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-cyan)', marginBottom: '6px' }}>
                Inbound TLS Certificate (tls.crt PEM)
              </label>
              <textarea
                rows={6}
                value={certPem}
                onChange={(e) => {
                  setCertPem(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                className="input-field"
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.72rem' }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f43f5e' }}>
                  Inbound Private Key (tls.key PEM)
                </label>
                <button
                  onClick={() => setShowPrivateKey(!showPrivateKey)}
                  className="btn-secondary"
                  style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                >
                  {showPrivateKey ? '🙈 Mask Key' : '👁️ Show Key'}
                </button>
              </div>
              <textarea
                rows={6}
                value={keyPem}
                onChange={(e) => {
                  setKeyPem(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                className="input-field"
                style={{
                  width: '100%',
                  fontFamily: 'monospace',
                  fontSize: '0.72rem',
                  filter: showPrivateKey ? 'none' : 'blur(4px)',
                  transition: 'filter 0.2s ease',
                }}
              />
            </div>
          </div>
        )}

        {/* Allowed Cipher Suites */}
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>
            Allowed TLS 1.3 / 1.2 Cipher Suites
          </label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              'TLS_AES_128_GCM_SHA256',
              'TLS_AES_256_GCM_SHA384',
              'TLS_CHACHA20_POLY1305_SHA256',
              'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
              'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
            ].map((cipher) => {
              const isSelected = selectedCiphers.includes(cipher);
              return (
                <button
                  key={cipher}
                  onClick={() => toggleCipher(cipher)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.74rem',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                    background: isSelected ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                    color: isSelected ? 'var(--primary-text)' : 'var(--text-muted)',
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  {isSelected ? '✓ ' : ''}{cipher}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Section 2: Outbound / Downstream TLS Security */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
          <span style={{ fontSize: '1.3rem' }}>🌐</span>
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              2. Outbound / Downstream MCP TLS Security
            </h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Controls verification when the gateway connects outbound to upstream MCP tool servers.
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '20px' }}>
          {/* InsecureSkipVerify Toggle */}
          <div style={{ background: 'var(--bg-surface-subtle)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <strong style={{ fontSize: '0.88rem', color: 'var(--text-main)' }}>TLS Certificate Chain Verification</strong>
              <span className={`badge ${insecureSkipVerify ? 'badge-rose' : 'badge-emerald'}`} style={{ fontSize: '0.68rem' }}>
                {insecureSkipVerify ? 'Disabled' : 'Strict Verification'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '8px 0' }}>
              <input
                type="checkbox"
                id="insecure-skip-verify"
                checked={insecureSkipVerify}
                onChange={(e) => {
                  setInsecureSkipVerify(e.target.checked);
                  setHasUnsavedChanges(true);
                }}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <label htmlFor="insecure-skip-verify" style={{ fontSize: '0.8rem', color: insecureSkipVerify ? '#fda4af' : 'var(--text-muted)', cursor: 'pointer' }}>
                Enable InsecureSkipVerify (Skip TLS cert verification)
              </label>
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
              {insecureSkipVerify
                ? '⚠️ WARNING: Disabling verification leaves traffic vulnerable to MitM attacks. Use only for dev/testing.'
                : 'Recommended for enterprise production to verify all upstream server identities.'}
            </span>
          </div>

          {/* Outbound Min TLS */}
          <div style={{ background: 'var(--bg-surface-subtle)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>
              Outbound Minimum TLS Version
            </label>
            <select
              value={downstreamMinTls}
              onChange={(e) => {
                setDownstreamMinTls(e.target.value as any);
                setHasUnsavedChanges(true);
              }}
              className="input-field"
              style={{ width: '100%', height: '42px', fontSize: '0.85rem' }}
            >
              <option value="TLS 1.2">TLS 1.2 (Standard Compatibility)</option>
              <option value="TLS 1.3">TLS 1.3 (Modern Strict Cipher Only)</option>
            </select>
          </div>
        </div>

        {/* Custom Downstream CA PEM */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
            Enterprise Downstream Root / Intermediate CA Bundle (PEM)
          </label>
          <textarea
            rows={3}
            value={downstreamCaPem}
            onChange={(e) => {
              setDownstreamCaPem(e.target.value);
              setHasUnsavedChanges(true);
            }}
            placeholder="-----BEGIN CERTIFICATE-----&#10;... (Enterprise Internal PKI Root CA)&#10;-----END CERTIFICATE-----"
            className="input-field"
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.72rem' }}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>
            Used by the safe outbound dialer to validate internal self-signed corporate MCP servers.
          </span>
        </div>
      </div>

      {/* Section 3: Gateway Network & Resiliency Settings */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
          <span style={{ fontSize: '1.3rem' }}>⚙️</span>
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              3. Gateway Network &amp; Resiliency Runtime Parameters
            </h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Controls edge listener timeouts, fail-static offline caching, and heartbeat cadence.
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '18px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              Public Gateway Base URL (GATEWAY_PUBLIC_URL)
            </label>
            <input
              type="text"
              value={publicUrl}
              onChange={(e) => {
                setPublicUrl(e.target.value);
                setHasUnsavedChanges(true);
              }}
              placeholder="http://localhost:8080 or https://gateway.corp.com:8080"
              className="input-field"
              style={{ width: '100%', fontSize: '0.82rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              Upstream Dial Timeout (ms)
            </label>
            <input
              type="number"
              value={dialTimeoutMs}
              onChange={(e) => {
                setDialTimeoutMs(Number(e.target.value));
                setHasUnsavedChanges(true);
              }}
              className="input-field"
              style={{ width: '100%', fontSize: '0.82rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              Request Call Timeout (ms)
            </label>
            <input
              type="number"
              value={callTimeoutMs}
              onChange={(e) => {
                setCallTimeoutMs(Number(e.target.value));
                setHasUnsavedChanges(true);
              }}
              className="input-field"
              style={{ width: '100%', fontSize: '0.82rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              Heartbeat Interval (Seconds)
            </label>
            <input
              type="number"
              value={heartbeatIntervalSec}
              onChange={(e) => {
                setHeartbeatIntervalSec(Number(e.target.value));
                setHasUnsavedChanges(true);
              }}
              className="input-field"
              style={{ width: '100%', fontSize: '0.82rem' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
