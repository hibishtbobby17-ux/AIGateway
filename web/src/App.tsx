import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { LoginView } from './components/LoginView';
import { TopologyGraph } from './components/TopologyGraph';
import { MetricsDashboard } from './components/MetricsDashboard';
import { MCPServersView } from './components/MCPServersView';
import { AgentsView } from './components/AgentsView';
import { TraceWaterfall } from './components/TraceWaterfall';
import { LogSearch } from './components/LogSearch';
import { TasksView } from './components/TasksView';
import { PoliciesView } from './components/PoliciesView';
import { SSOConfigView } from './components/SSOConfigView';
import { AuditView } from './components/AuditView';
import { api } from './api/client';
import { UserProfile } from './types';
import './index.css';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('topology');
  const [tenantId, setTenantId] = useState<string>('tenant-1');
  const [targetTraceId, setTargetTraceId] = useState<string | null>(null);
  const [targetLogTraceId, setTargetLogTraceId] = useState<string | null>(null);

  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);

  // Verify stored session or attempt /me on mount
  useEffect(() => {
    const verifySession = async () => {
      const storedToken = localStorage.getItem('gateway_token');
      const storedUserStr = localStorage.getItem('gateway_user');

      if (storedToken) {
        api.setToken(storedToken);
      }

      if (storedUserStr) {
        try {
          const parsed = JSON.parse(storedUserStr) as UserProfile;
          setCurrentUser(parsed);
          if (parsed.tenant_id) {
            setTenantId(parsed.tenant_id);
            api.setTenantId(parsed.tenant_id);
          }
        } catch {
          // ignore corrupted local user
        }
      }

      try {
        // Query /api/v1/auth/me to validate token or session cookie
        const me = await api.getMe();
        setCurrentUser(me);
        setIsAuthenticated(true);
        if (me.tenant_id) {
          setTenantId(me.tenant_id);
          api.setTenantId(me.tenant_id);
        }
      } catch {
        // If /me fails and no valid stored token, user must sign in
        if (!storedToken) {
          setIsAuthenticated(false);
          setCurrentUser(null);
        } else {
          // If stored token failed /me, clear invalid credentials
          api.setToken('');
          localStorage.removeItem('gateway_token');
          localStorage.removeItem('gateway_user');
          setIsAuthenticated(false);
          setCurrentUser(null);
        }
      } finally {
        setIsCheckingAuth(false);
      }
    };

    verifySession();
  }, []);

  const handleLoginSuccess = (token: string, user: UserProfile) => {
    api.setToken(token);
    setCurrentUser(user);
    setIsAuthenticated(true);
    if (user.tenant_id) {
      setTenantId(user.tenant_id);
      api.setTenantId(user.tenant_id);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (err) {
      console.warn('Logout notification failed:', err);
    } finally {
      setIsAuthenticated(false);
      setCurrentUser(null);
    }
  };

  const handleTenantChange = (newTenant: string) => {
    setTenantId(newTenant);
    api.setTenantId(newTenant);
  };

  const handleDeepLinkTrace = (traceId: string) => {
    setTargetTraceId(traceId);
    setActiveTab('traces');
  };

  const handleDeepLinkLogs = (traceId: string) => {
    setTargetLogTraceId(traceId);
    setActiveTab('logs');
  };

  if (isCheckingAuth) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        color: 'var(--text-secondary)',
        gap: '1rem',
      }}>
        <div className="spinner" style={{ width: '32px', height: '32px' }} />
        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          Verifying security session...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginView api={api} onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app-container">
      <Navbar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          if (tab !== 'traces') setTargetTraceId(null);
          if (tab !== 'logs') setTargetLogTraceId(null);
        }}
        tenantId={tenantId}
        onTenantChange={handleTenantChange}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      <main className="main-wrapper">
        {activeTab === 'topology' && (
          <TopologyGraph
            onSelectTrace={handleDeepLinkTrace}
            onNavigateTab={setActiveTab}
          />
        )}
        {activeTab === 'metrics' && <MetricsDashboard />}
        {activeTab === 'mcp' && <MCPServersView />}
        {activeTab === 'agents' && <AgentsView />}
        {activeTab === 'traces' && (
          <TraceWaterfall
            initialTraceId={targetTraceId}
            onViewLogs={handleDeepLinkLogs}
          />
        )}
        {activeTab === 'logs' && (
          <LogSearch
            initialTraceId={targetLogTraceId}
            onSelectTrace={handleDeepLinkTrace}
          />
        )}
        {activeTab === 'tasks' && <TasksView onSelectTrace={handleDeepLinkTrace} />}
        {activeTab === 'policies' && <PoliciesView />}
        {activeTab === 'sso' && <SSOConfigView />}
        {activeTab === 'audit' && <AuditView />}
      </main>
    </div>
  );
};

export default App;
