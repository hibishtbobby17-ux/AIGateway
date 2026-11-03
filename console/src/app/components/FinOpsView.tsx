'use client';

import React, { useState, useEffect } from 'react';

interface TaskStep {
  id: string;
  step_number: number;
  step_name: string;
  provider: string;
  model: string;
  region: string;
  failover_triggered: boolean;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  prompt_cost_usd: number;
  completion_cost_usd: number;
  primary_baseline_cost_usd: number;
  latency_ms: number;
  created_at: string;
}

interface TaskRollup {
  task_id: string;
  task_title: string;
  consumer_id: string;
  consumer_name: string;
  auth_mode: string;
  gateway_slug: string;
  task_status: string;
  steps_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  prompt_cost_usd: number;
  completion_cost_usd: number;
  primary_baseline_cost_usd: number;
  failover_cost_delta_usd: number;
  failover_steps: number;
  total_latency_ms: number;
  is_high_cost: boolean;
  high_cost_threshold_usd: number;
  started_at: string;
  completed_at: string;
  models_used: string[];
  providers_used: string[];
  steps: TaskStep[];
}

interface ConsumerRollup {
  consumer_id: string;
  consumer_name: string;
  auth_mode: string;
  gateways: string[];
  models: string[];
  total_tasks: number;
  tasks_completed: number;
  tasks_in_progress: number;
  tasks_failed: number;
  high_cost_tasks: number;
  total_steps: number;
  avg_steps_per_task: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  avg_tokens_per_task: number;
  prompt_cost_usd: number;
  completion_cost_usd: number;
  total_cost_usd: number;
  avg_cost_per_task_usd: number;
  max_task_cost_usd: number;
  failover_steps: number;
  failover_cost_delta_usd: number;
  monthly_budget_usd: number;
  budget_utilization_pct: number;
  high_cost_task_threshold_usd: number;
  last_active_at: string;
}

interface ModelRateRow {
  id?: string;
  provider: string;
  model: string;
  input_rate_per_1m: number;
  output_rate_per_1m: number;
}

interface ConsumerBudgetRow {
  id?: string;
  consumer_id: string;
  consumer_name: string;
  monthly_budget_usd: number;
  high_cost_task_threshold_usd: number;
}

interface FinOpsKPIs {
  total_spend_usd: number;
  prompt_spend_usd: number;
  completion_spend_usd: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tasks: number;
  completed_tasks: number;
  total_steps: number;
  avg_cost_per_task_usd: number;
  avg_tokens_per_task: number;
  avg_steps_per_task: number;
  failover_cost_delta_usd: number;
  failover_steps_count: number;
  active_consumers_count: number;
}

interface FinOpsViewProps {
  showBanner: (text: string, type: 'success' | 'error' | 'info') => void;
}

export default function FinOpsView({ showBanner }: FinOpsViewProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [kpis, setKpis] = useState<FinOpsKPIs | null>(null);
  const [consumers, setConsumers] = useState<ConsumerRollup[]>([]);
  const [tasks, setTasks] = useState<TaskRollup[]>([]);
  const [rates, setRates] = useState<ModelRateRow[]>([]);
  const [budgets, setBudgets] = useState<ConsumerBudgetRow[]>([]);
  const [gateways, setGateways] = useState<any[]>([]);

  // Filters & Selection
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [gatewayFilter, setGatewayFilter] = useState<string>('');
  const [authFilter, setAuthFilter] = useState<string>('');
  const [selectedConsumerId, setSelectedConsumerId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Modals
  const [showRatesModal, setShowRatesModal] = useState<boolean>(false);
  const [editableRates, setEditableRates] = useState<ModelRateRow[]>([]);
  const [editableBudgets, setEditableBudgets] = useState<ConsumerBudgetRow[]>([]);
  const [savingRates, setSavingRates] = useState<boolean>(false);

  // Simulate Multi-Step Task Modal
  const [showSimulateModal, setShowSimulateModal] = useState<boolean>(false);
  const [simConsumerId, setSimConsumerId] = useState<string>('agent-fin-01');
  const [simGatewaySlug, setSimGatewaySlug] = useState<string>('enterprise-chat');
  const [simTaskTitle, setSimTaskTitle] = useState<string>('Q4 Earnings Guidance & Cash Flow Stress Test');
  const [simStepsCount, setSimStepsCount] = useState<number>(3);
  const [simFailover, setSimFailover] = useState<boolean>(true);
  const [simRunning, setSimRunning] = useState<boolean>(false);

  const loadFinOpsData = async (preserveSelection = true) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (gatewayFilter) params.set('gateway', gatewayFilter);
      const res = await fetch(`/api/finops?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setKpis(data.kpis || null);
        const loadedConsumers: ConsumerRollup[] = data.consumers || [];
        const loadedTasks: TaskRollup[] = data.tasks || [];
        setConsumers(loadedConsumers);
        setTasks(loadedTasks);
        setRates(data.rates || []);
        setBudgets(data.budgets || []);
        setGateways(data.gateways || []);

        if (!preserveSelection || !selectedTaskId) {
          if (loadedTasks.length > 0) {
            setSelectedTaskId(loadedTasks[0].task_id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load FinOps analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFinOpsData();
  }, [gatewayFilter]);

  const formatUsd = (val: number, decimals = 4) => {
    if (val === 0) return '$0.0000';
    if (val >= 1) return `$${val.toFixed(2)}`;
    return `$${val.toFixed(decimals)}`;
  };

  const formatProviderBadge = (provider: string) => {
    const p = (provider || '').toLowerCase();
    if (p.includes('azure')) return { icon: '🔷', label: 'Azure OpenAI' };
    if (p.includes('bedrock') || p.includes('aws')) return { icon: '🟧', label: 'AWS Bedrock' };
    if (p.includes('anthropic')) return { icon: '🟤', label: 'Anthropic Direct' };
    if (p.includes('openai')) return { icon: '🟢', label: 'OpenAI Direct' };
    return { icon: '☁️', label: provider };
  };

  const formatAuthBadge = (mode: string) => {
    if (mode === 'oauth_pkce') {
      return <span className="badge badge-indigo" style={{ fontSize: '0.68rem' }}>🔑 OAuth 2.1 PKCE</span>;
    }
    if (mode === 'client_credentials') {
      return <span className="badge badge-cyan" style={{ fontSize: '0.68rem' }}>🏢 Client Credentials</span>;
    }
    return <span className="badge badge-emerald" style={{ fontSize: '0.68rem' }}>🔒 Virtual API Key</span>;
  };

  // Filtered Consumers
  const filteredConsumers = consumers.filter((c) => {
    if (authFilter && c.auth_mode !== authFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.consumer_id.toLowerCase().includes(q) ||
      c.consumer_name.toLowerCase().includes(q) ||
      c.models.some((m) => m.toLowerCase().includes(q)) ||
      c.gateways.some((g) => g.toLowerCase().includes(q))
    );
  });

  // Filtered Tasks for the Task Explorer
  const filteredTasks = tasks.filter((t) => {
    if (selectedConsumerId && t.consumer_id !== selectedConsumerId) return false;
    if (authFilter && t.auth_mode !== authFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.task_id.toLowerCase().includes(q) ||
      t.task_title.toLowerCase().includes(q) ||
      t.consumer_id.toLowerCase().includes(q) ||
      t.consumer_name.toLowerCase().includes(q) ||
      t.models_used.some((m) => m.toLowerCase().includes(q))
    );
  });

  const activeTask =
    filteredTasks.find((t) => t.task_id === selectedTaskId) ||
    filteredTasks[0] ||
    null;

  // Open Rate Card & Budgets Modal
  const handleOpenRatesModal = () => {
    setEditableRates(rates.map((r) => ({ ...r })));
    // Ensure every active consumer has a budget row
    const existingBudgetMap = new Map(budgets.map((b) => [b.consumer_id, b]));
    const mergedBudgets: ConsumerBudgetRow[] = consumers.map((c) => {
      const found = existingBudgetMap.get(c.consumer_id);
      return {
        consumer_id: c.consumer_id,
        consumer_name: c.consumer_name,
        monthly_budget_usd: found ? Number(found.monthly_budget_usd) : c.monthly_budget_usd,
        high_cost_task_threshold_usd: found
          ? Number(found.high_cost_task_threshold_usd)
          : c.high_cost_task_threshold_usd,
      };
    });
    setEditableBudgets(mergedBudgets);
    setShowRatesModal(true);
  };

  const handleSaveRatesAndBudgets = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRates(true);
    try {
      const res = await fetch('/api/finops', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rates: editableRates,
          budgets: editableBudgets,
        }),
      });
      if (res.ok) {
        showBanner('Model Rate Card & Consumer Budgets updated and applied to ledger!', 'success');
        setShowRatesModal(false);
        await loadFinOpsData(true);
      } else {
        const data = await res.json();
        showBanner(data.error || 'Failed to update FinOps settings', 'error');
      }
    } catch (err: any) {
      showBanner(err.message || 'Network error saving FinOps settings', 'error');
    } finally {
      setSavingRates(false);
    }
  };

  // Run Multi-Step Task Simulation
  const handleSimulateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimRunning(true);
    try {
      const res = await fetch('/api/finops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consumer_id: simConsumerId,
          gateway_slug: simGatewaySlug,
          task_title: simTaskTitle,
          steps_count: simStepsCount,
          simulate_failover_on_last_step: simFailover,
        }),
      });
      const data = await res.json();
      if (res.ok && data.simulated_task) {
        const st = data.simulated_task;
        showBanner(
          `Task "${st.task_id}" completed (${st.steps_executed} LLM calls, ${st.total_tokens.toLocaleString()} tokens, Cost: $${st.total_cost_usd.toFixed(5)})`,
          'success'
        );
        setShowSimulateModal(false);
        setSelectedConsumerId(st.consumer_id);
        setSelectedTaskId(st.task_id);
        await loadFinOpsData(true);
        setSelectedTaskId(st.task_id);
      } else {
        showBanner(data.error || 'Failed to simulate task', 'error');
      }
    } catch (err: any) {
      showBanner(err.message || 'Simulation request failed', 'error');
    } finally {
      setSimRunning(false);
    }
  };

  // Export CSV Chargeback Report
  const handleExportCsv = () => {
    const headers = [
      'Consumer ID',
      'Consumer Name',
      'Auth Mode',
      'Gateways Used',
      'Models Used',
      'Tasks Completed',
      'Avg LLM Calls per Task',
      'Prompt Tokens',
      'Completion Tokens',
      'Total Tokens',
      'Avg Tokens per Task',
      'Avg Cost per Task (USD)',
      'Total Chargeback Cost (USD)',
      'Monthly Budget (USD)',
      'Budget Utilization (%)',
    ];

    const rowsCsv = filteredConsumers.map((c) => [
      `"${c.consumer_id}"`,
      `"${c.consumer_name.replace(/"/g, '""')}"`,
      `"${c.auth_mode}"`,
      `"${c.gateways.join('; ')}"`,
      `"${c.models.join('; ')}"`,
      c.tasks_completed,
      c.avg_steps_per_task,
      c.prompt_tokens,
      c.completion_tokens,
      c.total_tokens,
      c.avg_tokens_per_task,
      c.avg_cost_per_task_usd.toFixed(6),
      c.total_cost_usd.toFixed(6),
      c.monthly_budget_usd.toFixed(2),
      c.budget_utilization_pct,
    ]);

    const csvContent = [headers.join(','), ...rowsCsv.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `llm-finops-chargeback-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showBanner('Exported Consumer FinOps Chargeback CSV report!', 'success');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.025em' }}>
              LLM FinOps & Task Cost Analytics
            </h1>
            <span className="badge badge-emerald" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
              💰 Consumer Chargeback & Unit Economics
            </span>
            <span className="badge badge-indigo" style={{ fontSize: '0.75rem' }}>
              X-Task-ID Multi-Turn Rollup
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '4px' }}>
            Track per-consumer token consumption, multi-step task completion costs, model rate cards, and failover cost impact across all LLM Gateway endpoints.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleExportCsv}
            className="btn-secondary"
            style={{ height: '38px', padding: '0 14px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}
          >
            <span>📥</span>
            <span>Export Chargeback CSV</span>
          </button>
          <button
            type="button"
            onClick={handleOpenRatesModal}
            className="btn-secondary"
            style={{ height: '38px', padding: '0 14px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}
          >
            <span>🏷️</span>
            <span>Rate Card & Budgets</span>
          </button>
          <button
            type="button"
            onClick={() => setShowSimulateModal(true)}
            className="btn-primary"
            style={{ height: '38px', padding: '0 16px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.84rem' }}
          >
            <span>⚡</span>
            <span>Simulate Multi-Step Task</span>
          </button>
        </div>
      </div>

      {/* Executive FinOps KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px' }}>
        <div className="glass-panel" style={{ padding: '16px', borderLeft: '3px solid #10b981' }}>
          <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Total Attributed LLM Spend
          </span>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#10b981', marginTop: '4px' }}>
            {kpis ? formatUsd(kpis.total_spend_usd, 4) : '...'}
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Prompt: <strong>{kpis ? formatUsd(kpis.prompt_spend_usd, 4) : '$0'}</strong> • Output: <strong>{kpis ? formatUsd(kpis.completion_spend_usd, 4) : '$0'}</strong>
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '16px', borderLeft: '3px solid #6366f1' }}>
          <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Avg Cost to Complete 1 Task
          </span>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--primary-text)', marginTop: '4px' }}>
            {kpis ? `${formatUsd(kpis.avg_cost_per_task_usd, 4)}` : '...'}
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)' }}> / task</span>
          </div>
          <span style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 600 }}>
            Across {kpis?.completed_tasks || 0} completed consumer tasks
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '16px', borderLeft: '3px solid #38bdf8' }}>
          <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Avg Tokens & Steps / Task
          </span>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px' }}>
            {kpis ? kpis.avg_tokens_per_task.toLocaleString() : '...'} <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>tok</span>
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Avg <strong>{kpis?.avg_steps_per_task || 0} LLM calls</strong> per completed task
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '16px', borderLeft: '3px solid #f59e0b' }}>
          <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Failover Cost Impact
          </span>
          <div style={{
            fontSize: '1.65rem',
            fontWeight: 800,
            color: (kpis?.failover_cost_delta_usd || 0) > 0 ? '#f59e0b' : '#10b981',
            marginTop: '4px'
          }}>
            {kpis
              ? `${kpis.failover_cost_delta_usd >= 0 ? '+' : ''}${formatUsd(kpis.failover_cost_delta_usd, 4)}`
              : '...'}
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {kpis?.failover_steps_count || 0} failover call(s) vs. primary baseline
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '16px', borderLeft: '3px solid #a855f7' }}>
          <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Active LLM Consumers
          </span>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px' }}>
            {kpis?.active_consumers_count || 0} Consumers
          </div>
          <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600 }}>
            ● {kpis ? (kpis.total_tokens / 1000).toFixed(1) : 0}K total task tokens
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="glass-panel" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', flex: 1 }}>
          <div style={{ minWidth: '280px', flex: 1, maxWidth: '380px' }}>
            <input
              type="text"
              className="input-field"
              placeholder="Search consumer ID, task ID, task title, or model..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ height: '36px', fontSize: '0.83rem' }}
            />
          </div>

          <select
            className="input-field"
            value={gatewayFilter}
            onChange={(e) => setGatewayFilter(e.target.value)}
            style={{ width: 'auto', minWidth: '190px', height: '36px', fontSize: '0.82rem' }}
          >
            <option value="">All LLM Gateways</option>
            {gateways.map((g) => (
              <option key={g.id} value={g.slug}>
                Gateway: {g.name} ({g.slug})
              </option>
            ))}
          </select>

          <select
            className="input-field"
            value={authFilter}
            onChange={(e) => setAuthFilter(e.target.value)}
            style={{ width: 'auto', minWidth: '180px', height: '36px', fontSize: '0.82rem' }}
          >
            <option value="">All Consumer Auth Modes</option>
            <option value="oauth_pkce">OAuth 2.1 PKCE (Okta)</option>
            <option value="client_credentials">Client Credentials (Okta)</option>
            <option value="api_key">Virtual API Key</option>
          </select>

          {selectedConsumerId && (
            <button
              type="button"
              onClick={() => setSelectedConsumerId(null)}
              className="btn-secondary"
              style={{ height: '34px', padding: '0 12px', fontSize: '0.78rem', color: 'var(--accent-cyan)' }}
            >
              ✕ Clear Consumer Filter ({selectedConsumerId})
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => loadFinOpsData(true)}
          className="btn-secondary"
          style={{ height: '34px', padding: '0 12px', fontSize: '0.78rem' }}
        >
          ↻ Refresh Ledger
        </button>
      </div>

      {/* SECTION 1: CONSUMER CHARGEBACK & UNIT ECONOMICS TABLE */}
      <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px'
        }}>
          <div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)' }}>
              1. Consumer Chargeback & Unit Economics (Cost per Completed Task)
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Click any consumer row to filter the Task Explorer below and inspect its individual tasks and multi-step LLM calls.
            </p>
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Showing <strong>{filteredConsumers.length}</strong> attributed LLM Gateway consumers
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.83rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface-subtle)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 16px' }}>Consumer Identity & Auth</th>
                <th style={{ padding: '12px 16px' }}>Tasks Completed</th>
                <th style={{ padding: '12px 16px' }}>Token Consumption (In / Out)</th>
                <th style={{ padding: '12px 16px' }}>Avg Tokens / Task</th>
                <th style={{ padding: '12px 16px' }}>Avg Cost / 1 Task</th>
                <th style={{ padding: '12px 16px' }}>Total Spend (USD)</th>
                <th style={{ padding: '12px 16px', minWidth: '170px' }}>Monthly Budget</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Drill-Down</th>
              </tr>
            </thead>
            <tbody>
              {filteredConsumers.map((c) => {
                const isSelected = selectedConsumerId === c.consumer_id;
                const promptPct = c.total_tokens > 0 ? Math.round((c.prompt_tokens / c.total_tokens) * 100) : 50;
                const completionPct = 100 - promptPct;
                const orgSharePct =
                  kpis && kpis.total_spend_usd > 0
                    ? Math.round((c.total_cost_usd / kpis.total_spend_usd) * 100)
                    : 0;
                const budgetColor =
                  c.budget_utilization_pct >= 90
                    ? '#f43f5e'
                    : c.budget_utilization_pct >= 70
                    ? '#f59e0b'
                    : '#10b981';

                return (
                  <tr
                    key={c.consumer_id}
                    onClick={() => {
                      const nextConsumer = isSelected ? null : c.consumer_id;
                      setSelectedConsumerId(nextConsumer);
                      if (nextConsumer) {
                        const firstConsumerTask = tasks.find((t) => t.consumer_id === nextConsumer);
                        if (firstConsumerTask) setSelectedTaskId(firstConsumerTask.task_id);
                      }
                    }}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      background: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    {/* Consumer Identity */}
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong style={{ color: 'var(--text-main)', fontSize: '0.88rem' }}>
                            {c.consumer_name}
                          </strong>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <code className="font-mono" style={{ fontSize: '0.73rem', color: 'var(--accent-cyan)' }}>
                            {c.consumer_id}
                          </code>
                          {formatAuthBadge(c.auth_mode)}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Gateways: {c.gateways.join(', ')} • Models: {c.models.join(', ')}
                        </div>
                      </div>
                    </td>

                    {/* Tasks Completed */}
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>
                            {c.tasks_completed}
                          </strong>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>tasks</span>
                          {c.high_cost_tasks > 0 && (
                            <span
                              className="badge badge-amber"
                              style={{ fontSize: '0.65rem' }}
                              title={`${c.high_cost_tasks} task(s) exceeded $${c.high_cost_task_threshold_usd} threshold`}
                            >
                              ⚠️ {c.high_cost_tasks} High-Cost
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {c.total_steps} LLM calls ({c.avg_steps_per_task} calls/task)
                        </span>
                      </div>
                    </td>

                    {/* Token Consumption */}
                    <td style={{ padding: '14px 16px', minWidth: '185px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                          <strong style={{ color: 'var(--text-main)' }}>
                            {c.total_tokens.toLocaleString()} tok
                          </strong>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {promptPct}% in / {completionPct}% out
                          </span>
                        </div>
                        <div style={{
                          height: '6px',
                          width: '100%',
                          background: 'var(--bg-surface-subtle)',
                          borderRadius: '999px',
                          overflow: 'hidden',
                          display: 'flex'
                        }}>
                          <div style={{ width: `${promptPct}%`, background: '#38bdf8' }} title={`Prompt: ${c.prompt_tokens.toLocaleString()}`} />
                          <div style={{ width: `${completionPct}%`, background: '#818cf8' }} title={`Completion: ${c.completion_tokens.toLocaleString()}`} />
                        </div>
                        <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)' }}>
                          In: {c.prompt_tokens.toLocaleString()} • Out: {c.completion_tokens.toLocaleString()}
                        </div>
                      </div>
                    </td>

                    {/* Avg Tokens / Task */}
                    <td style={{ padding: '14px 16px' }}>
                      <strong style={{ color: 'var(--text-main)', fontSize: '0.86rem' }}>
                        {c.avg_tokens_per_task.toLocaleString()}
                      </strong>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        tokens / task
                      </div>
                    </td>

                    {/* Avg Cost / 1 Task */}
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{
                        display: 'inline-block',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        background: 'rgba(99, 102, 241, 0.14)',
                        border: '1px solid rgba(99, 102, 241, 0.35)',
                        color: 'var(--primary-text)',
                        fontWeight: 800,
                        fontSize: '0.88rem'
                      }}>
                        {formatUsd(c.avg_cost_per_task_usd, 4)}
                      </div>
                      <div style={{ fontSize: '0.69rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                        Max task: {formatUsd(c.max_task_cost_usd, 4)}
                      </div>
                    </td>

                    {/* Total Spend */}
                    <td style={{ padding: '14px 16px' }}>
                      <strong style={{ color: '#10b981', fontSize: '0.94rem' }}>
                        {formatUsd(c.total_cost_usd, 4)}
                      </strong>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {orgSharePct}% of total spend
                      </div>
                    </td>

                    {/* Monthly Budget Bar */}
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem' }}>
                          <span style={{ fontWeight: 700, color: budgetColor }}>
                            {c.budget_utilization_pct}%
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>
                            of ${c.monthly_budget_usd.toFixed(2)}/mo
                          </span>
                        </div>
                        <div style={{
                          height: '6px',
                          width: '100%',
                          background: 'var(--bg-surface-subtle)',
                          borderRadius: '999px',
                          overflow: 'hidden'
                        }}>
                          <div
                            style={{
                              width: `${Math.min(100, c.budget_utilization_pct)}%`,
                              height: '100%',
                              background: budgetColor,
                              transition: 'width 0.25s ease'
                            }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Drill-Down Button */}
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const nextConsumer = isSelected ? null : c.consumer_id;
                          setSelectedConsumerId(nextConsumer);
                          if (nextConsumer) {
                            const firstTask = tasks.find((t) => t.consumer_id === nextConsumer);
                            if (firstTask) setSelectedTaskId(firstTask.task_id);
                          }
                        }}
                        className="btn-secondary"
                        style={{
                          padding: '5px 10px',
                          fontSize: '0.75rem',
                          borderColor: isSelected ? 'var(--primary)' : undefined,
                          color: isSelected ? 'var(--primary-text)' : undefined,
                        }}
                      >
                        {isSelected ? '✓ Filtering Tasks' : `🔍 View Tasks (${c.total_tasks})`}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2: CONSUMER TASKS EXPLORER & STEP-BY-STEP COST WATERFALL */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1fr) minmax(420px, 1.35fr)', gap: '20px' }}>
        {/* Left Column: Tasks List */}
        <div className="glass-panel" style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{
            padding: '16px 18px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-main)' }}>
                2. Completed Tasks Ledger {selectedConsumerId ? `(${selectedConsumerId})` : '(All Consumers)'}
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Select a task to inspect every LLM completion step and its token cost.
              </p>
            </div>
            <span className="badge badge-indigo" style={{ fontSize: '0.7rem' }}>
              {filteredTasks.length} Tasks
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '560px', overflowY: 'auto' }}>
            {filteredTasks.map((t) => {
              const isSelected = activeTask?.task_id === t.task_id;
              return (
                <div
                  key={t.task_id}
                  onClick={() => setSelectedTaskId(t.task_id)}
                  style={{
                    padding: '14px 18px',
                    borderBottom: '1px solid var(--border-subtle)',
                    borderLeft: isSelected ? '4px solid var(--primary)' : '4px solid transparent',
                    background: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                    <strong style={{ fontSize: '0.86rem', color: 'var(--text-main)', lineHeight: 1.35 }}>
                      {t.task_title}
                    </strong>
                    <span style={{
                      fontWeight: 800,
                      fontSize: '0.9rem',
                      color: t.is_high_cost ? '#f59e0b' : '#10b981',
                      whiteSpace: 'nowrap'
                    }}>
                      {formatUsd(t.total_cost_usd, 4)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <code className="font-mono" style={{ fontSize: '0.71rem', color: 'var(--accent-cyan)' }}>
                      {t.task_id}
                    </code>
                    <span className="badge badge-emerald" style={{ fontSize: '0.64rem' }}>
                      {t.steps_count} {t.steps_count === 1 ? 'LLM Step' : 'LLM Steps'}
                    </span>
                    {t.is_high_cost && (
                      <span className="badge badge-amber" style={{ fontSize: '0.64rem' }}>
                        ⚠️ High-Cost Task
                      </span>
                    )}
                    {t.failover_steps > 0 && (
                      <span className="badge badge-amber" style={{ fontSize: '0.64rem' }}>
                        ⚡ Failover ({t.failover_steps})
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                    <span>
                      Consumer: <strong style={{ color: 'var(--text-main)' }}>{t.consumer_id}</strong> • <code>/llm/{t.gateway_slug}</code>
                    </span>
                    <span>
                      {t.total_tokens.toLocaleString()} tok • {t.total_latency_ms}ms
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Step-by-Step Task Execution Cost Waterfall */}
        <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {activeTask ? (
            <>
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '12px',
                borderBottom: '1px solid var(--border-subtle)',
                paddingBottom: '14px',
                flexWrap: 'wrap'
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span className="badge badge-indigo" style={{ fontSize: '0.7rem' }}>
                      Task Cost Waterfall
                    </span>
                    <code className="font-mono" style={{ fontSize: '0.76rem', color: 'var(--accent-cyan)' }}>
                      X-Task-ID: {activeTask.task_id}
                    </code>
                    <span className="badge badge-emerald" style={{ fontSize: '0.68rem', textTransform: 'uppercase' }}>
                      ● {activeTask.task_status}
                    </span>
                  </div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '6px' }}>
                    {activeTask.task_title}
                  </h3>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                    Consumer: <strong style={{ color: 'var(--text-main)' }}>{activeTask.consumer_name}</strong> (<code>{activeTask.consumer_id}</code>) • Gateway: <code>/api/llm/{activeTask.gateway_slug}/v1/chat/completions</code>
                  </div>
                </div>

                <div style={{
                  background: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  textAlign: 'right'
                }}>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Cost to Complete Task
                  </span>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#10b981' }}>
                    {formatUsd(activeTask.total_cost_usd, 5)}
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {activeTask.total_tokens.toLocaleString()} tokens across {activeTask.steps_count} LLM call(s)
                  </span>
                </div>
              </div>

              {/* Step-by-Step Waterfall Timeline */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {activeTask.steps.map((step) => {
                  const pctOfTaskCost =
                    activeTask.total_cost_usd > 0
                      ? Math.round((step.cost_usd / activeTask.total_cost_usd) * 100)
                      : 100;
                  const prov = formatProviderBadge(step.provider);
                  const stepDelta = Number((step.cost_usd - step.primary_baseline_cost_usd).toFixed(6));

                  return (
                    <div
                      key={step.id}
                      style={{
                        background: 'var(--bg-surface-subtle)',
                        border: step.failover_triggered
                          ? '1px solid rgba(245, 158, 11, 0.45)'
                          : '1px solid var(--border-subtle)',
                        borderRadius: '10px',
                        padding: '14px 16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            background: 'var(--primary)',
                            color: '#fff',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            {step.step_number}
                          </span>
                          <strong style={{ fontSize: '0.88rem', color: 'var(--text-main)' }}>
                            {step.step_name}
                          </strong>
                          {step.failover_triggered && (
                            <span className="badge badge-amber" style={{ fontSize: '0.66rem' }}>
                              ⚠️ Failover Route ({stepDelta >= 0 ? `+${formatUsd(stepDelta, 5)}` : formatUsd(stepDelta, 5)} vs primary)
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            {pctOfTaskCost}% of task cost
                          </span>
                          <strong style={{ fontSize: '0.92rem', color: '#10b981' }}>
                            {formatUsd(step.cost_usd, 5)}
                          </strong>
                        </div>
                      </div>

                      {/* Step Cost Proportion Bar */}
                      <div style={{
                        height: '5px',
                        width: '100%',
                        background: 'rgba(255,255,255,0.06)',
                        borderRadius: '999px',
                        overflow: 'hidden'
                      }}>
                        <div
                          style={{
                            width: `${pctOfTaskCost}%`,
                            height: '100%',
                            background: step.failover_triggered
                              ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                              : 'linear-gradient(90deg, #6366f1, #38bdf8)'
                          }}
                        />
                      </div>

                      {/* Step Telemetry Metadata */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '8px',
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span>
                            {prov.icon} <strong style={{ color: 'var(--text-main)' }}>{step.model}</strong> ({prov.label} • {step.region})
                          </span>
                          <span>•</span>
                          <span>⏱️ {step.latency_ms}ms</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                          <span>
                            Prompt: <strong style={{ color: '#38bdf8' }}>{step.prompt_tokens.toLocaleString()} tok</strong> ({formatUsd(step.prompt_cost_usd, 5)})
                          </span>
                          <span>•</span>
                          <span>
                            Completion: <strong style={{ color: '#818cf8' }}>{step.completion_tokens.toLocaleString()} tok</strong> ({formatUsd(step.completion_cost_usd, 5)})
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Summary Rollup Box + Consumer SDK Snippet */}
              <div style={{
                marginTop: 'auto',
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.28)',
                borderRadius: '10px',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px'
              }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
                  <strong>Task Unit Economics Summary:</strong> {activeTask.steps_count} LLM calls • Prompt: <strong>{activeTask.prompt_tokens.toLocaleString()}</strong> tok ({formatUsd(activeTask.prompt_cost_usd, 5)}) + Completion: <strong>{activeTask.completion_tokens.toLocaleString()}</strong> tok ({formatUsd(activeTask.completion_cost_usd, 5)})
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#10b981' }}>
                  Total Task Cost: {formatUsd(activeTask.total_cost_usd, 5)}
                </div>
              </div>

              {/* How Consumer Passed Task Header */}
              <div style={{
                background: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '10px 14px',
                fontSize: '0.74rem',
                color: 'var(--text-muted)'
              }}>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  🔗 Consumer Task Correlation Headers Used:
                </div>
                <code className="font-mono" style={{ color: 'var(--accent-cyan)', display: 'block', whiteSpace: 'pre-wrap' }}>
                  {`POST /api/llm/${activeTask.gateway_slug}/v1/chat/completions\nX-Consumer-ID: ${activeTask.consumer_id}  |  X-Task-ID: ${activeTask.task_id}  |  X-Task-Status: ${activeTask.task_status}`}
                </code>
              </div>
            </>
          ) : (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Select a task from the ledger to inspect its step-by-step LLM calls and token cost breakdown.
            </div>
          )}
        </div>
      </div>

      {/* MODAL 1: SIMULATE MULTI-STEP CONSUMER TASK */}
      {showSimulateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.72)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setShowSimulateModal(false)}
        >
          <div
            className="glass-panel"
            style={{ width: '100%', maxWidth: '560px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  ⚡ Simulate Multi-Step Consumer Task
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Executes a multi-turn LLM task sharing a single <code>X-Task-ID</code> and attributes token consumption & cost to the selected consumer.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSimulateModal(false)}
                className="btn-secondary"
                style={{ padding: '4px 10px' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSimulateTask} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                  Consumer Identity (X-Consumer-ID)
                </label>
                <select
                  className="input-field"
                  value={simConsumerId}
                  onChange={(e) => setSimConsumerId(e.target.value)}
                >
                  <option value="agent-fin-01">agent-fin-01 — Financial Research Synthesizer (A2A Agent)</option>
                  <option value="agent-code-02">agent-code-02 — Code Reviewer & Security Auditor (A2A Agent)</option>
                  <option value="okta-marketing-copilot">okta-marketing-copilot — Marketing Campaign Copilot (Okta PKCE)</option>
                  <option value="agent-sup-03">agent-sup-03 — Customer Support Escalation Agent</option>
                  <option value="agent-data-04">agent-data-04 — ETL Pipeline & Vector Ingestion Agent</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                  Target LLM Gateway Endpoint
                </label>
                <select
                  className="input-field"
                  value={simGatewaySlug}
                  onChange={(e) => setSimGatewaySlug(e.target.value)}
                >
                  {gateways.map((g) => (
                    <option key={g.id} value={g.slug}>
                      {g.name} (/api/llm/{g.slug}/v1/chat/completions)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                  Task Description / Title (X-Task-Title)
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={simTaskTitle}
                  onChange={(e) => setSimTaskTitle(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                  Number of Sequential LLM Calls in Task
                </label>
                <select
                  className="input-field"
                  value={simStepsCount}
                  onChange={(e) => setSimStepsCount(Number(e.target.value))}
                >
                  <option value={1}>1 LLM Call (Single-Turn Task)</option>
                  <option value={2}>2 LLM Calls (Retrieve + Synthesize)</option>
                  <option value={3}>3 LLM Calls (Plan + Tool RAG + Report Generation)</option>
                  <option value={4}>4 LLM Calls (Deep Multi-Agent Verification Loop)</option>
                </select>
              </div>

              <div style={{
                background: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div>
                  <strong style={{ fontSize: '0.82rem', color: 'var(--text-main)', display: 'block' }}>
                    Simulate Cloud Failover on Final Step
                  </strong>
                  <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                    Routes the final LLM step to the gateway&apos;s fallback model to measure failover cost delta.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={simFailover}
                  onChange={(e) => setSimFailover(e.target.checked)}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--primary)', cursor: 'pointer' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setShowSimulateModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={simRunning}
                  className="btn-primary"
                >
                  {simRunning ? 'Executing Multi-Step Task...' : `⚡ Execute ${simStepsCount}-Step Task`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: MODEL RATE CARD & CONSUMER BUDGETS */}
      {showRatesModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.72)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setShowRatesModal(false)}
        >
          <div
            className="glass-panel"
            style={{
              width: '100%',
              maxWidth: '720px',
              maxHeight: '88vh',
              overflowY: 'auto',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  🏷️ Model Pricing Rate Card & Consumer Monthly Budgets
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Customize $/1M input and output token rates and per-consumer monthly spend budgets. Saving recalculates the FinOps ledger immediately.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRatesModal(false)}
                className="btn-secondary"
                style={{ padding: '4px 10px' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRatesAndBudgets} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Model Rates Table */}
              <div>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '8px' }}>
                  Cloud Provider & Model Token Pricing (USD per 1M Tokens)
                </h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-surface-subtle)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Provider</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Model</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Input ($ / 1M tok)</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Output ($ / 1M tok)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editableRates.map((r, idx) => (
                      <tr key={`${r.provider}-${r.model}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600 }}>{r.provider}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <code className="font-mono" style={{ color: 'var(--accent-cyan)' }}>{r.model}</code>
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="input-field"
                            style={{ height: '32px', width: '120px' }}
                            value={r.input_rate_per_1m}
                            onChange={(e) => {
                              const next = [...editableRates];
                              next[idx] = { ...next[idx], input_rate_per_1m: parseFloat(e.target.value) || 0 };
                              setEditableRates(next);
                            }}
                          />
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="input-field"
                            style={{ height: '32px', width: '120px' }}
                            value={r.output_rate_per_1m}
                            onChange={(e) => {
                              const next = [...editableRates];
                              next[idx] = { ...next[idx], output_rate_per_1m: parseFloat(e.target.value) || 0 };
                              setEditableRates(next);
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Consumer Budgets Table */}
              <div>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '8px' }}>
                  Consumer Monthly Budgets & High-Cost Task Thresholds
                </h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-surface-subtle)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Consumer</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Monthly Budget (USD)</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>High-Cost Task Alert ($ / task)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editableBudgets.map((b, idx) => (
                      <tr key={b.consumer_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '8px 12px' }}>
                          <strong style={{ display: 'block', color: 'var(--text-main)' }}>{b.consumer_name}</strong>
                          <code className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--accent-cyan)' }}>{b.consumer_id}</code>
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <input
                            type="number"
                            step="0.05"
                            min="0.01"
                            className="input-field"
                            style={{ height: '32px', width: '130px' }}
                            value={b.monthly_budget_usd}
                            onChange={(e) => {
                              const next = [...editableBudgets];
                              next[idx] = { ...next[idx], monthly_budget_usd: parseFloat(e.target.value) || 0.1 };
                              setEditableBudgets(next);
                            }}
                          />
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <input
                            type="number"
                            step="0.005"
                            min="0.001"
                            className="input-field"
                            style={{ height: '32px', width: '130px' }}
                            value={b.high_cost_task_threshold_usd}
                            onChange={(e) => {
                              const next = [...editableBudgets];
                              next[idx] = { ...next[idx], high_cost_task_threshold_usd: parseFloat(e.target.value) || 0.01 };
                              setEditableBudgets(next);
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowRatesModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRates}
                  className="btn-primary"
                >
                  {savingRates ? 'Recalculating Ledger...' : '💾 Save Rates & Recalculate Costs'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

