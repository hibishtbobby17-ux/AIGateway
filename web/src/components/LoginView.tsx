import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client';
import { UserProfile } from '../types';

interface LoginViewProps {
  api: ApiClient;
  onLoginSuccess: (token: string, user: UserProfile) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ api, onLoginSuccess }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [tenantId, setTenantId] = useState('tenant-1');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicProviders, setPublicProviders] = useState<Array<{ id: string; name: string; issuer_url: string }>>([]);

  useEffect(() => {
    api.listPublicSSOProviders(tenantId)
      .then(setPublicProviders)
      .catch(() => {});
  }, [tenantId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await api.login(username, password, tenantId.trim() || undefined);
      onLoginSuccess(res.token, res.user);
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleSSOClick = async (providerId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.simulateSSOLogin(providerId, 'sso-user@enterprise.local', tenantId);
      onLoginSuccess(res.token, res.user);
    } catch (err: any) {
      setError(err.message || 'SSO authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at 50% 20%, rgba(99, 102, 241, 0.15), transparent 70%), var(--bg-base)',
      padding: '1.5rem',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '440px',
        background: 'var(--bg-glass)',
        backdropFilter: 'blur(16px)',
        border: '1px solid var(--border-glow)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 20px 40px -15px rgba(0,0,0,0.7), 0 0 30px -5px var(--primary-glow)',
        padding: '2.5rem',
      }}>
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, var(--primary), var(--cyan))',
            color: '#fff',
            fontSize: '1.75rem',
            marginBottom: '1rem',
            boxShadow: '0 0 20px rgba(99, 102, 241, 0.5)',
          }}>
            ⚡
          </div>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.6rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            margin: '0 0 0.5rem 0',
          }}>
            AI Gateway Console
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>
            Unified Management & Observability Platform
          </p>
        </div>

        {/* Development Seed Notification Banner */}
        <div style={{
          background: 'rgba(99, 102, 241, 0.1)',
          border: '1px solid rgba(99, 102, 241, 0.25)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.75rem 1rem',
          marginBottom: '1.5rem',
          fontSize: '0.8125rem',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}>
          <span style={{ fontSize: '1rem' }}>💡</span>
          <div>
            Default credentials: <code style={{ color: 'var(--cyan)' }}>admin</code> / <code style={{ color: 'var(--cyan)' }}>admin123</code>
          </div>
        </div>

        {error && (
          <div style={{
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.75rem 1rem',
            marginBottom: '1.5rem',
            color: '#fecdd3',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}>
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Username
            </label>
            <input
              type="text"
              required
              className="form-input"
              style={{ width: '100%' }}
              placeholder="e.g. admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Password
            </label>
            <input
              type="password"
              required
              className="form-input"
              style={{ width: '100%' }}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '0.8125rem',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <span>{showAdvanced ? '▾' : '▸'}</span>
              <span>Tenant Scope Options</span>
            </button>

            {showAdvanced && (
              <div style={{ marginTop: '0.75rem' }}>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  Tenant ID (Optional)
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={{ width: '100%', fontSize: '0.85rem' }}
                  placeholder="tenant-1"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  disabled={loading}
                />
              </div>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{
              width: '100%',
              padding: '0.75rem',
              fontSize: '0.95rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              marginTop: '0.5rem',
            }}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner" style={{ width: '16px', height: '16px' }}></span>
                <span>Authenticating...</span>
              </>
            ) : (
              <span>Sign In to Console</span>
            )}
          </button>
        </form>

        {/* Dynamic External Identity Providers (SSO) */}
        {publicProviders.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', margin: '1rem 0', gap: '0.75rem' }}>
              <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Or Single Sign-On (SSO)
              </span>
              <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {publicProviders.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSSOClick(p.id)}
                  disabled={loading}
                  className="btn btn-secondary"
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    fontSize: '0.875rem',
                    padding: '0.6rem',
                  }}
                >
                  <span>🔑</span>
                  <span>Sign in with {p.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{
          marginTop: '2rem',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: '1rem',
        }}>
          Protected by Enterprise Zero-Trust IAM &bull; TLS 1.3
        </div>
      </div>
    </div>
  );
};

export default LoginView;
