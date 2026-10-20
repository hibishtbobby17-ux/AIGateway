import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { MetricsSummary } from '../types';

export const MetricsDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [duration, setDuration] = useState<string>('24h');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMetricsSummary(duration);
      setMetrics(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, [duration, api.getTenantId()]);

  return (
    <div className="metrics-dashboard">
      {/* Header & Window Selector */}
      <div className="filter-bar">
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700 }}>
            Platform Operational Metrics
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Real-time traffic volume, latencies, tool execution rates, and agent task distributions.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <select
            className="form-select"
            style={{ width: 'auto' }}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          >
            <option value="1h">Last 1 hour</option>
            <option value="6h">Last 6 hours</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
          </select>
          <button className="btn btn-secondary btn-sm" onClick={loadMetrics}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="alert-banner alert-error">{error}</div>}

      {/* Top Stat Cards */}
      <div className="stats-grid" style={{ marginTop: '1.5rem' }}>
        <div className="glass-panel stat-card">
          <div className="stat-header">
            <span className="stat-label">Total Invocations</span>
            <span style={{ fontSize: '1.2rem' }}>⚡</span>
          </div>
          <div className="stat-value">{loading ? '...' : (metrics?.total_requests || 0).toLocaleString()}</div>
          <div className="stat-subtext" style={{ color: 'var(--cyan)' }}>
            In selected {duration} window
          </div>
        </div>

        <div className="glass-panel stat-card">
          <div className="stat-header">
            <span className="stat-label">Error Rate</span>
            <span style={{ fontSize: '1.2rem' }}>⚠️</span>
          </div>
          <div className="stat-value" style={{ color: (metrics?.error_rate_percent || 0) > 5 ? 'var(--danger)' : 'var(--text-primary)' }}>
            {loading ? '...' : `${(metrics?.error_rate_percent || 0).toFixed(2)}%`}
          </div>
          <div className="stat-subtext" style={{ color: (metrics?.total_errors || 0) > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {metrics?.total_errors || 0} failed requests
          </div>
        </div>

        <div className="glass-panel stat-card">
          <div className="stat-header">
            <span className="stat-label">Avg / p95 Latency</span>
            <span style={{ fontSize: '1.2rem' }}>⏱️</span>
          </div>
          <div className="stat-value">
            {loading ? '...' : `${(metrics?.avg_latency_ms || 0).toFixed(1)} ms`}
          </div>
          <div className="stat-subtext" style={{ color: 'var(--text-muted)' }}>
            p95: {(metrics?.p95_latency_ms || 0).toFixed(1)} ms
          </div>
        </div>

        <div className="glass-panel stat-card">
          <div className="stat-header">
            <span className="stat-label">Active Targets</span>
            <span style={{ fontSize: '1.2rem' }}>🤖</span>
          </div>
          <div className="stat-value">
            {loading ? '...' : `${(metrics?.active_mcp_servers || 0) + (metrics?.active_agents || 0)}`}
          </div>
          <div className="stat-subtext">
            <span>{metrics?.active_mcp_servers || 0} MCP servers</span> • <span>{metrics?.active_agents || 0} agents</span>
          </div>
        </div>
      </div>

      {/* Visual Distributions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
        {/* Top Tools Chart */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem' }}>
            Top Executed MCP Tools
          </h3>

          {!metrics?.top_tools || Object.keys(metrics.top_tools).length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No tool executions recorded in this window.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {Object.entries(metrics.top_tools).slice(0, 5).map(([tool, count]) => {
                const max = Math.max(...Object.values(metrics.top_tools));
                const pct = (count / (max || 1)) * 100;

                return (
                  <div key={tool}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                      <span className="code-pill">{tool}</span>
                      <span style={{ fontWeight: 600, color: 'var(--cyan)' }}>{count} calls</span>
                    </div>
                    <div style={{ height: '8px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: 'linear-gradient(90deg, #6366f1, #06b6d4)',
                          borderRadius: '4px',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Task Status Breakdown */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem' }}>
            A2A Autonomous Task Lifecycle Distribution
          </h3>

          {!metrics?.task_status_counts || Object.keys(metrics.task_status_counts).length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No autonomous tasks recorded in this window.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
              {Object.entries(metrics.task_status_counts).map(([status, count]) => (
                <div
                  key={status}
                  style={{
                    padding: '1rem',
                    background: 'rgba(0,0,0,0.25)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    {status}
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.2rem' }}>
                    {count}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
