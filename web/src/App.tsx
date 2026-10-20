import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { TopologyGraph } from './components/TopologyGraph';
import { MetricsDashboard } from './components/MetricsDashboard';
import { MCPServersView } from './components/MCPServersView';
import { AgentsView } from './components/AgentsView';
import { TraceWaterfall } from './components/TraceWaterfall';
import { LogSearch } from './components/LogSearch';
import { TasksView } from './components/TasksView';
import { PoliciesView } from './components/PoliciesView';
import { AuditView } from './components/AuditView';
import { api } from './api/client';
import './index.css';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('topology');
  const [tenantId, setTenantId] = useState<string>('tenant-1');
  const [targetTraceId, setTargetTraceId] = useState<string | null>(null);
  const [targetLogTraceId, setTargetLogTraceId] = useState<string | null>(null);

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
        {activeTab === 'audit' && <AuditView />}
      </main>
    </div>
  );
};

export default App;
