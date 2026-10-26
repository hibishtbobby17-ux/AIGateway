'use client';

import React, { useState } from 'react';

interface AIAgent {
  id: string;
  name: string;
  description: string;
  version: string;
  state: 'IDLE' | 'WORKING' | 'STREAMING' | 'PAUSED' | 'FAILED';
  capabilities: string[];
  protocol: string;
  associatedGateway: string;
  endpointUrl: string;
  latencyMs: number;
  tasksCompleted: number;
  lastActive: string;
}

interface AgentsRegistryViewProps {
  gatewaysList: any[];
  showBanner: (text: string, type: 'success' | 'error' | 'info') => void;
}

export default function AgentsRegistryView({
  gatewaysList,
  showBanner,
}: AgentsRegistryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AIAgent | null>(null);

  const [agents, setAgents] = useState<AIAgent[]>([
    {
      id: 'agent-fin-01',
      name: 'Financial Research Synthesizer',
      description: 'Autonomous financial agent that queries SEC filings, executes statistical calculations, and generates summarized quarterly reports.',
      version: 'v1.4.0',
      state: 'IDLE',
      capabilities: ['sec_filings_rag', 'math_statistics', 'markdown_report_gen'],
      protocol: 'A2A Task Protocol v1.0 (SSE)',
      associatedGateway: 'gateway-default-01',
      endpointUrl: 'http://127.0.0.1:8080/agents/agent-fin-01',
      latencyMs: 18,
      tasksCompleted: 1420,
      lastActive: '3 mins ago'
    },
    {
      id: 'agent-code-02',
      name: 'Code Reviewer & Security Auditor',
      description: 'Inspects pull request diffs, checks AST patterns against Sonar rules, and suggests verified security remediation patches.',
      version: 'v2.1.0',
      state: 'WORKING',
      capabilities: ['git_diff_eval', 'ast_pattern_match', 'secret_leak_detect'],
      protocol: 'A2A Task Protocol v1.0 (SSE)',
      associatedGateway: 'gateway-default-01',
      endpointUrl: 'http://127.0.0.1:8080/agents/agent-code-02',
      latencyMs: 24,
      tasksCompleted: 3890,
      lastActive: 'Just now'
    },
    {
      id: 'agent-sup-03',
      name: 'Customer Support Escalation Agent',
      description: 'Triage customer inquiries, checks PostgreSQL customer orders, and routes high-priority tickets to on-call engineers via Slack.',
      version: 'v1.1.2',
      state: 'STREAMING',
      capabilities: ['db_read_order', 'slack_notify', 'sentiment_analysis'],
      protocol: 'A2A Task Protocol v1.0 (SSE)',
      associatedGateway: 'gateway-us-east',
      endpointUrl: 'http://127.0.0.1:8080/agents/agent-sup-03',
      latencyMs: 14,
      tasksCompleted: 890,
      lastActive: 'Just now'
    },
    {
      id: 'agent-data-04',
      name: 'ETL Pipeline & Vector Ingestion Agent',
      description: 'Monitors raw S3 buckets, generates OpenAI embeddings, and bulk updates Qdrant vector collections.',
      version: 'v1.0.8',
      state: 'IDLE',
      capabilities: ['embedding_gen', 'qdrant_upsert', 's3_blob_read'],
      protocol: 'A2A Task Protocol v1.0 (SSE)',
      associatedGateway: 'gateway-eu-west',
      endpointUrl: 'http://127.0.0.1:8080/agents/agent-data-04',
      latencyMs: 32,
      tasksCompleted: 450,
      lastActive: '12 mins ago'
    }
  ]);

  // New Agent Form
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentUrl, setNewAgentUrl] = useState('');
  const [newAgentCapabilities, setNewAgentCapabilities] = useState('text_gen, search');
  const [newAgentGateway, setNewAgentGateway] = useState(gatewaysList[0]?.name || 'gateway-default-01');

  const filteredAgents = agents.filter(a =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.capabilities.some(c => c.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handlePing = (agentId: string, agentName: string) => {
    showBanner(`Pinged agent "${agentName}": Latency 16ms (HTTP 200 OK)`, 'success');
  };

  const handleRegister = () => {
    if (!newAgentName || !newAgentUrl) {
      showBanner('Please provide Agent name and URL', 'error');
      return;
    }
    const newAg: AIAgent = {
      id: `agent-custom-${Date.now().toString().slice(-4)}`,
      name: newAgentName,
      description: 'Custom autonomous agent registered via Agent Card',
      version: 'v1.0.0',
      state: 'IDLE',
      capabilities: newAgentCapabilities.split(',').map(s => s.trim()).filter(Boolean),
      protocol: 'A2A Task Protocol v1.0 (SSE)',
      associatedGateway: newAgentGateway,
      endpointUrl: newAgentUrl,
      latencyMs: 15,
      tasksCompleted: 0,
      lastActive: 'Just now'
    };
    setAgents([...agents, newAg]);
    setShowRegisterModal(false);
    setNewAgentName('');
    setNewAgentUrl('');
    showBanner(`Successfully registered Agent "${newAg.name}"!`, 'success');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.025em' }}>
              Autonomous AI Agent Registry
            </h1>
            <span className="badge badge-emerald">A2A Protocol Ready</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '4px' }}>
            All registered autonomous agents, capability declarations (Agent Cards), task states, and gateway routing.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => setShowRegisterModal(true)}
            className="btn-primary"
            style={{ height: '38px', padding: '0 16px' }}
          >
            + Register New Agent
          </button>
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <div className="glass-panel" style={{ padding: '16px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Registered Agents
          </span>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '2px' }}>
            {agents.length} Agents
          </div>
          <span style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 500 }}>
            ● 100% Verified Agent Cards
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '16px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Active Task Executions
          </span>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--primary-text)', marginTop: '2px' }}>
            38 Active Tasks
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Streaming via SSE
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '16px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Task Completion Rate
          </span>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#059669', marginTop: '2px' }}>
            99.4%
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            6,650 Total lifetime tasks
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '16px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Trace Context Propagation
          </span>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '2px' }}>
            W3C Trace
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            OTel native correlation
          </span>
        </div>
      </div>

      {/* Search Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ minWidth: '320px' }}>
          <input
            type="text"
            className="input-field"
            placeholder="Search agents by name, ID, or capabilities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ height: '36px', fontSize: '0.84rem' }}
          />
        </div>

        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Showing <strong>{filteredAgents.length}</strong> registered agents
        </span>
      </div>

      {/* Agents Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
        gap: '20px'
      }}>
        {filteredAgents.map((agent) => (
          <div
            key={agent.id}
            className="glass-panel"
            style={{
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              position: 'relative'
            }}
          >
            <div>
              {/* Top: Icon, Version, State */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--primary-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.3rem'
                  }}>
                    🤖
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                      {agent.name}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="font-mono" style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        {agent.id}
                      </span>
                      <span className="badge badge-indigo" style={{ fontSize: '0.62rem' }}>{agent.version}</span>
                    </div>
                  </div>
                </div>

                <span className={`badge ${
                  agent.state === 'WORKING' ? 'badge-amber' : agent.state === 'STREAMING' ? 'badge-cyan' : 'badge-emerald'
                }`} style={{ fontSize: '0.7rem', fontWeight: 600 }}>
                  ● {agent.state}
                </span>
              </div>

              {/* Description */}
              <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: '1.45', marginBottom: '14px' }}>
                {agent.description}
              </p>

              {/* Capabilities Pills */}
              <div style={{ marginBottom: '14px' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                  Declared Skills & Capabilities:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {agent.capabilities.map((cap, idx) => (
                    <code
                      key={idx}
                      className="font-mono"
                      style={{
                        background: 'var(--bg-surface-subtle)',
                        fontSize: '0.72rem',
                        color: 'var(--primary-text)',
                        padding: '2px 6px',
                        borderRadius: '4px'
                      }}
                    >
                      {cap}
                    </code>
                  ))}
                </div>
              </div>

              {/* Gateway & Endpoint Strip */}
              <div style={{
                background: 'var(--bg-surface-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginBottom: '16px'
              }}>
                <span>⚡ {agent.associatedGateway}</span>
                <span style={{ color: '#059669', fontWeight: 600 }}>{agent.latencyMs}ms ping</span>
                <span>{agent.tasksCompleted} tasks</span>
              </div>
            </div>

            {/* Actions */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: '14px'
            }}>
              <button
                onClick={() => setSelectedAgent(agent)}
                className="btn-secondary"
                style={{ flex: 1, fontSize: '0.8rem', height: '34px' }}
              >
                Inspect Agent Card
              </button>
              <button
                onClick={() => handlePing(agent.id, agent.name)}
                className="btn-secondary"
                style={{ fontSize: '0.8rem', height: '34px', padding: '0 12px' }}
              >
                Ping Health
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal: Register Agent */}
      {showRegisterModal && (
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
          <div className="glass-panel" style={{
            width: '500px',
            maxWidth: '92vw',
            background: 'var(--bg-surface)',
            padding: '26px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            borderRadius: 'var(--radius-lg)'
          }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>
              Register Autonomous AI Agent
            </h3>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
              Provide the Agent-to-Agent (A2A) protocol endpoint URL and declared capabilities.
            </p>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                Agent Name
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Sales Analysis Agent"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                A2A Endpoint URL
              </label>
              <input
                type="text"
                className="input-field font-mono"
                placeholder="http://agent-host:8080/agents/my-agent"
                value={newAgentUrl}
                onChange={(e) => setNewAgentUrl(e.target.value)}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                Declared Capabilities / Skills (comma-separated)
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. query_crm, generate_quote, check_inventory"
                value={newAgentCapabilities}
                onChange={(e) => setNewAgentCapabilities(e.target.value)}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                Routing AI Gateway
              </label>
              <select
                className="input-field"
                value={newAgentGateway}
                onChange={(e) => setNewAgentGateway(e.target.value)}
              >
                {gatewaysList.map(gw => (
                  <option key={gw.id} value={gw.name}>{gw.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
              <button onClick={() => setShowRegisterModal(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleRegister} className="btn-primary">
                Register Agent
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Inspect Agent Card JSON */}
      {selectedAgent && (
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
          <div className="glass-panel" style={{
            width: '600px',
            maxWidth: '92vw',
            background: 'var(--bg-surface)',
            padding: '26px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            borderRadius: 'var(--radius-lg)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.4rem' }}>🤖</span>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                  Agent Card: {selectedAgent.name}
                </h3>
              </div>
              <button onClick={() => setSelectedAgent(null)} className="btn-secondary" style={{ padding: '4px 8px' }}>
                ✕
              </button>
            </div>

            <pre style={{
              background: '#090d16',
              color: '#e2e8f0',
              padding: '16px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.78rem',
              overflowX: 'auto',
              maxHeight: '360px'
            }}>
              {JSON.stringify({
                schema_version: '1.0.0',
                agent_id: selectedAgent.id,
                name: selectedAgent.name,
                version: selectedAgent.version,
                protocol: selectedAgent.protocol,
                endpoint: selectedAgent.endpointUrl,
                status: selectedAgent.state,
                capabilities: selectedAgent.capabilities,
                trace_context: {
                  propagation: 'W3C TraceContext',
                  traceparent: true,
                },
                health_probe: {
                  endpoint: '/healthz',
                  interval_seconds: 10,
                  timeout_ms: 2000
                }
              }, null, 2)}
            </pre>

            <button onClick={() => setSelectedAgent(null)} className="btn-primary" style={{ width: '100%' }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
